# app/main.py
import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, HttpUrl

from app.bms_client import extract_url_info, fetch_venues_direct, replace_url_date
from app.db import init_db, record_venues_and_get_new
from app.poller import get_watch_date_codes, poll_loop


class WatchCreateRequest(BaseModel):
    url: HttpUrl
    interval_minutes: int = 7
    label: Optional[str] = None
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
def home() -> str:
    return """
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>BookMyShow Theatre Watcher</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #333; }
        .card { background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 24px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
        h2 { margin-top: 0; color: #111; }
        label { display: block; font-weight: 600; margin-top: 14px; margin-bottom: 6px; font-size: 14px; }
        input, select { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
        .row { display: flex; gap: 14px; }
        .row > div { flex: 1; }
        button { background: #e50914; color: white; border: none; border-radius: 6px; padding: 12px 20px; font-size: 15px; font-weight: bold; cursor: pointer; margin-top: 20px; }
        button:hover { background: #b80710; }
        pre { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 16px; margin-top: 24px; font-size: 12px; overflow-x: auto; }
        .hint { font-size: 12px; color: #666; font-weight: normal; margin-left: 4px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>🎬 BookMyShow Theatre Watcher</h2>
        <form id="watchForm">
          <label>BookMyShow Showtimes URL</label>
          <input id="url" type="url" placeholder="https://in.bookmyshow.com/movies/.../buytickets/..." required />

          <div class="row">
            <div>
              <label>Start Date <span class="hint">(Detected from link)</span></label>
              <input id="startDate" type="date" required />
            </div>
            <div>
              <label>End Date <span class="hint">(Max 2 weeks from start)</span></label>
              <input id="endDate" type="date" required />
            </div>
          </div>

          <div class="row">
            <div>
              <label>Interval (minutes)</label>
              <input id="interval" type="number" min="1" max="60" value="2" required />
            </div>
            <div>
              <label>Label <span class="hint">(Optional)</span></label>
              <input id="label" type="text" placeholder="e.g. Avengers Doomsday" />
            </div>
          </div>

          <label>Alert Emails <span class="hint">(Comma-separated)</span></label>
          <input id="emails" type="text" placeholder="user1@gmail.com, user2@gmail.com" />

          <button type="submit">Start Watching</button>
        </form>
      </div>

      <h3>Active Watches</h3>
      <pre id="out">Loading...</pre>

      <script>
        const urlInput = document.getElementById('url');
        const startDateInput = document.getElementById('startDate');
        const endDateInput = document.getElementById('endDate');

        function parseDateFromUrl(urlStr) {
          try {
            const url = new URL(urlStr);
            const parts = url.pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('buytickets');
            let dateStr = url.searchParams.get('dateCode');
            if (!dateStr && idx !== -1 && idx + 2 < parts.length) {
              dateStr = parts[idx + 2];
            }
            if (dateStr && /^[0-9]{8}$/.test(dateStr)) {
              return `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
            }
          } catch (e) {}
          return null;
        }

        urlInput.addEventListener('input', () => {
          const detected = parseDateFromUrl(urlInput.value);
          if (detected) {
            startDateInput.value = detected;
            updateDateRangeBounds(detected);
          }
        });

        startDateInput.addEventListener('change', () => {
          updateDateRangeBounds(startDateInput.value);
        });

        function updateDateRangeBounds(startVal) {
          if (!startVal) return;
          const s = new Date(startVal);
          const maxDate = new Date(s);
          maxDate.setDate(s.getDate() + 14);

          const maxIso = maxDate.toISOString().split('T')[0];
          endDateInput.min = startVal;
          endDateInput.max = maxIso;

          if (!endDateInput.value || endDateInput.value < startVal || endDateInput.value > maxIso) {
            endDateInput.value = startVal;
          }
        }

        async function refresh() {
          const res = await fetch('/watches');
          document.getElementById('out').textContent = JSON.stringify(await res.json(), null, 2);
        }

        document.getElementById('watchForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const rawEmails = document.getElementById('emails').value.split(',').map(s => s.trim()).filter(Boolean);
          const body = {
            url: urlInput.value,
            start_date: startDateInput.value,
            end_date: endDateInput.value,
            interval_minutes: Number(document.getElementById('interval').value),
            label: document.getElementById('label').value || null,
            emails: rawEmails
          };
          const res = await fetch('/watches', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            const err = await res.json();
            alert('Error: ' + (err.detail || 'Could not save watch'));
            return;
          }
          refresh();
        });

        refresh();
      </script>
    </body>
    </html>
    """


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