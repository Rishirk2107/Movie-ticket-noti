import asyncio
import random
from datetime import datetime, timezone

from app.bms_client import fetch_venues_direct
from app.db import record_venues_and_get_new
from app.notifier import notify_new_venues


async def run_single_watch_check(watches_col, seen_col, job: dict) -> list[tuple[str, str]]:
    watch_id = job["_id"]
    try:
        current = await fetch_venues_direct(job["url"])
        added = await record_venues_and_get_new(
            seen_col, watch_id, current, mark_notified=True
        )
        if added:
            await notify_new_venues(
                job.get("label"), job["url"], job.get("emails", []), added
            )
        await watches_col.update_one(
            {"_id": watch_id},
            {
                "$set": {
                    "last_checked_at": datetime.now(timezone.utc).isoformat(),
                    "last_error": None,
                }
            },
        )
        return added
    except Exception as exc:
        await watches_col.update_one(
            {"_id": watch_id},
            {
                "$set": {
                    "last_checked_at": datetime.now(timezone.utc).isoformat(),
                    "last_error": str(exc),
                }
            },
        )
        print(f"[ERROR] Job {watch_id} failed: {exc}")
        return []


async def poll_loop(watches_col, seen_col) -> None:
    while True:
        now = datetime.now(timezone.utc)
        async for job in watches_col.find({"active": True}):
            last_checked_str = job.get("last_checked_at")
            interval_sec = int(job.get("interval_minutes", 7)) * 60

            if last_checked_str:
                elapsed = (now - datetime.fromisoformat(last_checked_str)).total_seconds()
                if elapsed < interval_sec:
                    continue

            await run_single_watch_check(watches_col, seen_col, job)

        await asyncio.sleep(30 + random.randint(0, 15))