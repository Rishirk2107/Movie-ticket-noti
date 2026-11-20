from datetime import datetime, timezone
from pymongo import ASCENDING, AsyncMongoClient, IndexModel
from app.config import MONGO_DB, MONGO_URI


async def init_db() -> tuple[AsyncMongoClient, object, object]:
    client = AsyncMongoClient(MONGO_URI)
    db = client[MONGO_DB]
    watches_col = db["watches"]
    seen_col = db["seen_venues"]

    await seen_col.create_indexes(
        [IndexModel([("watch_id", ASCENDING), ("venue_code", ASCENDING)], unique=True)]
    )
    return client, watches_col, seen_col


async def record_venues_and_get_new(
    seen_col,
    watch_id: str,
    venues: dict[str, str],
    *,
    mark_notified: bool,
) -> list[tuple[str, str]]:
    now_iso = datetime.now(timezone.utc).isoformat()
    newly_added: list[tuple[str, str]] = []

    for code, name in venues.items():
        res = await seen_col.update_one(
            {"watch_id": watch_id, "venue_code": code},
            {
                "$setOnInsert": {
                    "watch_id": watch_id,
                    "venue_code": code,
                    "venue_name": name,
                    "first_seen_at": now_iso,
                    "notified": mark_notified,
                }
            },
            upsert=True,
        )
        if res.upserted_id is not None:
            newly_added.append((code, name))

    return newly_added