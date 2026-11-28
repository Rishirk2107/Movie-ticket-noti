import asyncio
import random
from datetime import datetime, timedelta, timezone

from curl_cffi.requests import AsyncSession

from app.bms_client import (
    BMSBlockedError,
    fetch_venues_direct,
    get_bms_session,
    replace_url_date,
)
from app.config import IST_TZ
from app.db import record_venues_and_get_new, update_watch_available_dates
from app.logger import add_log
from app.notifier import notify_new_venues

_COOLDOWN_SCHEDULE_SEC = (60, 180, 600)
# Per-watch circuit-breaker state: {watch_id: {"consecutive_403": int, "cooldown_until": datetime | None}}
_circuit_state: dict[str, dict] = {}


def _compute_403_cooldown_seconds(consecutive_403: int) -> float:
    idx = min(max(consecutive_403 - 1, 0), len(_COOLDOWN_SCHEDULE_SEC) - 1)
    return float(_COOLDOWN_SCHEDULE_SEC[idx]) + random.uniform(2.0, 12.0)


def get_poll_date_codes(job: dict) -> list[str]:
    """
    Build the full set of date codes to poll for a watch:
      1. Stored available_dates (discovered from BMS date strip)
      2. Explicit start_date -> end_date range (capped at 14 days)
      3. Optional releaseDate - 1 early-preview date (only if still >= today IST)
    Returns a deduplicated sorted list.
    """
    date_set: set[str] = set()

    # 1. Stored available dates
    for dc in job.get("available_dates", []):
        if dc and len(dc) == 8:
            date_set.add(dc)

    # 2. Explicit range from start_date / end_date
    start = job.get("start_date")
    end = job.get("end_date")
    if start:
        if not end or end < start:
            end = start
        try:
            start_dt = datetime.strptime(start, "%Y-%m-%d")
            end_dt = datetime.strptime(end, "%Y-%m-%d")
            if (end_dt - start_dt).days > 14:
                end_dt = start_dt + timedelta(days=14)
            curr = start_dt
            while curr <= end_dt:
                date_set.add(curr.strftime("%Y%m%d"))
                curr += timedelta(days=1)
        except ValueError:
            pass
    elif not date_set:
        # Fallback: single date_code on the job
        dc = job.get("date_code", "")
        if dc:
            date_set.add(dc)

    # 3. releaseDate - 1 early-preview (only while still relevant)
    release_8digit = job.get("release_date_8digit", "")
    if release_8digit and len(release_8digit) == 8:
        try:
            release_dt = datetime.strptime(release_8digit, "%Y%m%d").date()
            preview_dt = release_dt - timedelta(days=1)
            today_ist = datetime.now(IST_TZ).date()
            preview_code = preview_dt.strftime("%Y%m%d")
            if preview_dt >= today_ist and preview_code not in date_set:
                date_set.add(preview_code)
        except ValueError:
            pass

    return sorted(date_set)


# Keep old name as alias for use in main.py (backward compat)
def get_watch_date_codes(job: dict) -> list[str]:
    return get_poll_date_codes(job)


def is_watch_expired(job: dict) -> bool:
    end = job.get("end_date") or job.get("start_date")
    if not end:
        return False
    try:
        end_dt = datetime.strptime(end, "%Y-%m-%d").date()
        today = datetime.now(IST_TZ).date()
        return today > end_dt
    except Exception:
        return False


async def run_single_watch_check(watches_col, seen_col, job: dict) -> list[tuple[str, str]]:
    watch_id = job["_id"]
    date_codes = get_poll_date_codes(job)
    all_added: list[tuple[str, str]] = []
    errors: list[str] = []
    region_code = job.get("region_code") or "CHEN"
    city = job.get("city") or "Chennai"

    session = await get_bms_session()
    for i, d_code in enumerate(date_codes):
        if i > 0:
            await asyncio.sleep(random.uniform(1.0, 2.5))

        try:
            venues, discovered_dates = await fetch_venues_direct(
                job["url"],
                date_code=d_code or None,
                session=session,
                max_retries=2,
                region_code=region_code,
                city=city,
            )

            # Reset 403 circuit-breaker on first HTTP 200
            if watch_id in _circuit_state:
                _circuit_state[watch_id] = {"consecutive_403": 0, "cooldown_until": None}

            # Merge newly discovered dates back into the watch document
            if discovered_dates:
                await update_watch_available_dates(watches_col, watch_id, discovered_dates)

            added = await record_venues_and_get_new(
                seen_col, watch_id, venues, date_code=d_code, mark_notified=True
            )
            if added:
                target_url = replace_url_date(job["url"], d_code) if d_code else job["url"]
                await notify_new_venues(
                    job.get("label"),
                    target_url,
                    job.get("emails", []),
                    added,
                    date_code=d_code,
                    movie_name=job.get("movie_name"),
                    alarm_enabled=job.get("alarm_enabled", False),
                    device_tokens=job.get("device_tokens", []),
                    watch_id=watch_id,
                    job=job,
                )
                all_added.extend(added)
        except BMSBlockedError as exc:
            state = _circuit_state.setdefault(
                watch_id, {"consecutive_403": 0, "cooldown_until": None}
            )
            state["consecutive_403"] += 1
            cooldown_sec = _compute_403_cooldown_seconds(state["consecutive_403"])
            state["cooldown_until"] = datetime.now(timezone.utc) + timedelta(seconds=cooldown_sec)

            err_msg = f"Date {d_code or 'default'}: {exc}"
            add_log(
                "WARN",
                f"HTTP 403 on watch {job.get('label') or watch_id}; aborting remaining dates and entering {cooldown_sec:.0f}s cooldown (streak={state['consecutive_403']}).",
            )
            errors.append(err_msg)
            break
        except Exception as exc:
            err_msg = f"Date {d_code or 'default'}: {exc}"
            print(f"[WARN] Job {watch_id} date check failed: {err_msg}")
            errors.append(err_msg)

    last_error = "; ".join(errors) if errors else None
    await watches_col.update_one(
        {"_id": watch_id},
        {
            "$set": {
                "last_checked_at": datetime.now(timezone.utc).isoformat(),
                "last_error": last_error,
            }
        },
    )
    return all_added


async def poll_loop(watches_col, seen_col) -> None:
    while True:
        now = datetime.now(timezone.utc)
        async for job in watches_col.find({"active": True}):
            watch_id = job["_id"]

            if is_watch_expired(job):
                add_log("INFO", f"Watch {job.get('label')} expired on {job.get('end_date')}. Auto-deleted.")
                _circuit_state.pop(watch_id, None)
                await watches_col.delete_one({"_id": watch_id})
                await seen_col.delete_many({"watch_id": watch_id})
                continue

            cb = _circuit_state.get(watch_id)
            if cb and cb.get("cooldown_until") and now < cb["cooldown_until"]:
                continue

            last_checked_str = job.get("last_checked_at")
            interval_sec = int(job.get("interval_minutes", 10)) * 60

            if last_checked_str:
                elapsed = (now - datetime.fromisoformat(last_checked_str)).total_seconds()
                if elapsed < interval_sec:
                    continue

            await run_single_watch_check(watches_col, seen_col, job)

        await asyncio.sleep(30 + random.randint(0, 15))
