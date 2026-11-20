# app/main.py
import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, HttpUrl

from app.bms_client import fetch_venues_direct
from app.db import init_db, record_venues_and_get_new
from app.poller import poll_loop


class WatchCreateRequest(BaseModel):
    url: HttpUrl
    interval_minutes: int = 7
    label: Optional[str] = None
    emails: list[str] = []


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
def home() -> str:
    return """
    <!doctype html>
    <html>
    <head><title>BookMyShow Theatre Watcher</title></head>
    <body style="font-family: sans-serif; max-width: 720px; margin: 40px auto;">
      <h2>Add Showtimes URL to Watch</h2>
      <form id="watchForm">
        <input id="url" type="url" placeholder="https://in.bookmyshow.com/..." style="width: 100%; padding: 8px;" required /><br/><br/>
        <label>Interval (5–10 min): <input id="interval" type="number" min="5" max="10" value="7" /></label>
        <input id="label" type="text" placeholder="Optional label (e.g. Avengers Fri)" style="margin-left: 12px; padding: 6px;" /><br/><br/>
        <input id="emails" type="text" placeholder="Friend emails separated by commas" style="width: 100%; padding: 8px;" /><br/><br/>
        <button type="submit" style="padding: 6px 14px;">Start Watching</button>
      </form>
      <pre id="out" style="background: #f4f4f4; padding: 12px; margin-top: 20px;"></pre>
      <script>
        async function refresh() {
          const res = await fetch('/watches');
          document.getElementById('out').textContent = JSON.stringify(await res.json(), null, 2);
        }
        document.getElementById('watchForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const rawEmails = document.getElementById('emails').value.split(',').map(s => s.trim()).filter(Boolean);
          const body = {
            url: document.getElementById('url').value,
            interval_minutes: Number(document.getElementById('interval').value),
            label: document.getElementById('label').value || null,
            emails: rawEmails
          };
          await fetch('/watches', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
          });
          refresh();
        });
        refresh();
      </script>
    </body>
    </html>
    """


@app.post("/watches", status_code=201)
async def create_watch(payload: WatchCreateRequest):
    if not (5 <= payload.interval_minutes <= 10):
        raise HTTPException(status_code=400, detail="interval_minutes must be between 5 and 10.")

    url_str = str(payload.url)
    watch_id = str(uuid.uuid4())[:8]
    now_iso = datetime.now(timezone.utc).isoformat()
    cleaned_emails = [e.strip() for e in payload.emails if e and e.strip()]

    initial_venues = await fetch_venues_direct(url_str)

    doc = {
        "_id": watch_id,
        "url": url_str,
        "label": payload.label,
        "interval_minutes": payload.interval_minutes,
        "emails": cleaned_emails,
        "active": True,
        "created_at": now_iso,
        "last_checked_at": now_iso,
        "last_error": None,
    }
    await app.state.watches_col.insert_one(doc)
    await record_venues_and_get_new(
        app.state.seen_col, watch_id, initial_venues, mark_notified=False
    )

    return {**doc, "known_venue_count": len(initial_venues)}


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