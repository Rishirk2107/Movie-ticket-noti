# app/main.py
import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, HttpUrl

from app.bms_client import extract_url_info, fetch_venues_direct, replace_url_date
from app.db import init_db, record_venues_and_get_new
from app.logger import get_logs
from app.notifier import send_watch_registration_email
from app.poller import get_watch_date_codes, poll_loop

INDEX_HTML_PATH = Path(__file__).parent / "templates" / "index.html"


class WatchCreateRequest(BaseModel):
    url: HttpUrl
    interval_minutes: int = 10
    label: str
    emails: list[str] = []
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None    # YYYY-MM-DD


@asynccontextmanager
async def lifespan(app: FastAPI):
    client, watches_col, seen_col = await init_db()
    app.state.watches_col = watches_col
    app.state.seen_col = seen_col

    poll_task = asyncio.create_task(poll_loop(watches_col, seen_col))
    try:
        yield
    finally:
        poll_task.cancel()
        try:
            await poll_task
        except asyncio.CancelledError:
            pass
        await client.close()


app = FastAPI(title="BookMyShow Theatre Watcher", lifespan=lifespan)


@app.get("/health")
async def health_check(response: Response):
    try:
        await app.state.watches_col.database.client.admin.command("ping")
        active_watches = await app.state.watches_col.count_documents({"active": True})
        return {"status": "ok", "db": "connected", "active_watches": active_watches}
    except Exception as exc:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "db": "disconnected", "detail": str(exc)}


@app.get("/", response_class=HTMLResponse)
def home() -> HTMLResponse:
    if INDEX_HTML_PATH.exists():
        return HTMLResponse(content=INDEX_HTML_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h2>Template index.html not found</h2>", status_code=500)


@app.post("/watches", status_code=201)
async def create_watch(payload: WatchCreateRequest):
    if payload.interval_minutes < 1:
        raise HTTPException(status_code=400, detail="interval_minutes must be at least 1.")

    url_str = str(payload.url)
    info = extract_url_info(url_str)
    
    # Determine start and end dates
    start_date = payload.start_date
    if not start_date and info["date_code"] and len(info["date_code"]) == 8:
        dc = info["date_code"]
        start_date = f"{dc[:4]}-{dc[4:6]}-{dc[6:]}"

    end_date = payload.end_date or start_date

    # Validate range <= 14 days
    if start_date and end_date:
        try:
            s_dt = datetime.strptime(start_date, "%Y-%m-%d")
            e_dt = datetime.strptime(end_date, "%Y-%m-%d")
            if e_dt < s_dt:
                raise ValueError("end_date cannot be earlier than start_date")
            if (e_dt - s_dt).days > 14:
                raise ValueError("Date range cannot exceed 14 days (2 weeks).")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    watch_id = str(uuid.uuid4())[:8]
    now_iso = datetime.now(timezone.utc).isoformat()
    cleaned_emails = [e.strip() for e in payload.emails if e and e.strip()]

    doc = {
        "_id": watch_id,
        "url": url_str,
        "label": payload.label,
        "interval_minutes": payload.interval_minutes,
        "start_date": start_date,
        "end_date": end_date,
        "emails": cleaned_emails,
        "active": True,
        "created_at": now_iso,
        "last_checked_at": now_iso,
        "last_error": None,
    }

    # Record initial venues for each date in the range so existing venues don't trigger alerts
    total_initial_venues = 0
    date_codes = get_watch_date_codes(doc)
    for i, d_code in enumerate(date_codes):
        if i > 0:
            await asyncio.sleep(1.0)
        try:
            initial_venues = await fetch_venues_direct(url_str, date_code=d_code or None, max_retries=2)
            await record_venues_and_get_new(
                app.state.seen_col,
                watch_id,
                initial_venues,
                date_code=d_code,
                mark_notified=False,
            )
            total_initial_venues += len(initial_venues)
        except Exception as e:
            print(f"[WARN] Initial fetch for date {d_code} encountered error: {e}")

    await app.state.watches_col.insert_one(doc)

    # Send registration confirmation email to all recipient emails (excludes interval details)
    if cleaned_emails:
        asyncio.create_task(
            send_watch_registration_email(
                emails=cleaned_emails,
                label=payload.label,
                movie_name=info.get("movie_name", ""),
                city=info.get("city", ""),
                start_date=start_date,
                end_date=end_date,
                url=url_str,
                initial_theatres_count=total_initial_venues,
            )
        )

    return {**doc, "known_venue_count": total_initial_venues}


@app.get("/watches")
async def list_watches():
    watches = []
    async for doc in app.state.watches_col.find({}):
        count = await app.state.seen_col.count_documents({"watch_id": doc["_id"]})
        watches.append({**doc, "known_venue_count": count})
    return watches


@app.get("/watches/{watch_id}/venues")
async def list_watch_venues(watch_id: str):
    return [
        v async for v in app.state.seen_col.find({"watch_id": watch_id}, {"_id": 0})
    ]


@app.delete("/watches/{watch_id}")
async def delete_watch(watch_id: str):
    res = await app.state.watches_col.delete_one({"_id": watch_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Watch not found.")
    await app.state.seen_col.delete_many({"watch_id": watch_id})
    return {"deleted": watch_id}


@app.get("/logs")
async def fetch_realtime_logs(limit: int = 50):
    return {"logs": get_logs(limit=limit)}
