import asyncio
import random
from datetime import datetime, timedelta, timezone

from curl_cffi.requests import AsyncSession

from app.bms_client import fetch_venues_direct, replace_url_date
from app.db import record_venues_and_get_new
from app.notifier import notify_new_venues


def get_watch_date_codes(job: dict) -> list[str]:
    start = job.get("start_date")
    end = job.get("end_date")
    if not start:
        return [job.get("date_code", "")]

    if not end or end < start:
        end = start

    start_dt = datetime.strptime(start, "%Y-%m-%d")
    end_dt = datetime.strptime(end, "%Y-%m-%d")
    
    # Cap at 14 days
    if (end_dt - start_dt).days > 14:
        end_dt = start_dt + timedelta(days=14)

    dates = []
    curr = start_dt
    while curr <= end_dt:
        dates.append(curr.strftime("%Y%m%d"))
        curr += timedelta(days=1)
    return dates


async def run_single_watch_check(watches_col, seen_col, job: dict) -> list[tuple[str, str]]:
    watch_id = job["_id"]
    date_codes = get_watch_date_codes(job)
    all_added: list[tuple[str, str]] = []
    errors: list[str] = []

    async with AsyncSession(impersonate="chrome", timeout=15.0) as session:
        for i, d_code in enumerate(date_codes):
            if i > 0:
                # Polite delay between multiple dates to prevent getting blocked / rate-limited
                await asyncio.sleep(1.5)

            try:
                current = await fetch_venues_direct(
                    job["url"], date_code=d_code or None, session=session, max_retries=2
                )
                added = await record_venues_and_get_new(
                    seen_col, watch_id, current, date_code=d_code, mark_notified=True
                )
                if added:
                    target_url = replace_url_date(job["url"], d_code) if d_code else job["url"]
                    await notify_new_venues(
                        job.get("label"), target_url, job.get("emails", []), added, date_code=d_code
                    )
                    all_added.extend(added)
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


def is_watch_expired(job: dict) -> bool:
    end = job.get("end_date") or job.get("start_date")
    if not end:
        return False
    try:
        # End date in format YYYY-MM-DD
        end_dt = datetime.strptime(end, "%Y-%m-%d").date()
        today = datetime.now(timezone.utc).date()
        # Expired if the end date has already passed
        return today > end_dt
    except Exception:
        return False


async def poll_loop(watches_col, seen_col) -> None:
    while True:
        now = datetime.now(timezone.utc)
        async for job in watches_col.find({"active": True}):
            watch_id = job["_id"]

            # Automatically delete watch and its seen records once date range is over
            if is_watch_expired(job):
                print(f"[CLEANUP] Watch {watch_id} ({job.get('label')}) expired on {job.get('end_date')}. Deleting...")
                await watches_col.delete_one({"_id": watch_id})
                await seen_col.delete_many({"watch_id": watch_id})
                continue

            last_checked_str = job.get("last_checked_at")
            interval_sec = int(job.get("interval_minutes", 10)) * 60

            if last_checked_str:
                elapsed = (now - datetime.fromisoformat(last_checked_str)).total_seconds()
                if elapsed < interval_sec:
                    continue

            await run_single_watch_check(watches_col, seen_col, job)

        await asyncio.sleep(30 + random.randint(0, 15))