import asyncio
import os
import random
import urllib.parse
import urllib.request
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, HttpUrl
from pymongo import ASCENDING, AsyncMongoClient, IndexModel

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "bms_watcher")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "")
BMS_COOKIE = os.getenv("BMS_COOKIE", "")

BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL", "")
BREVO_SENDER_NAME = os.getenv("BREVO_SENDER_NAME", "BMS Ticket Alerts")

API_BASE_URL = (
    "https://in.bookmyshow.com/api/movies-data/v5/showtimes-by-event/primary-dynamic"
)

DEFAULT_HEADERS = {
    "x-app-code": "WEB",
    "x-region-code": "CHEN",
    "x-region-slug": "chennai",
    "x-location-selection": "manual",
    "x-geohash": "tf3",
    "x-latitude": "13.056",
    "x-longitude": "80.206",
    "x-platform-code": "WEB",
    "x-platform": "WEB",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "Windows",
}
if BMS_COOKIE:
    DEFAULT_HEADERS["Cookie"] = BMS_COOKIE


class WatchCreateRequest(BaseModel):
    url: HttpUrl
    interval_minutes: int = 7  # 5 to 10 minutes
    label: Optional[str] = None
    emails: list[str] = []


def build_api_url(raw_url: str) -> tuple[str, str]:
    parsed = urlparse(raw_url)
    qs = parse_qs(parsed.query)

    if "/api/movies-data/" in parsed.path and "showtimes-by-event" in parsed.path:
        return raw_url, "https://in.bookmyshow.com/"

    parts = [p for p in parsed.path.split("/") if p]
    event_code = qs.get("refEventCode", [None])[0]
    date_code = qs.get("dateCode", [None])[0]

    if "buytickets" in parts:
        idx = parts.index("buytickets")
        if not event_code and idx + 1 < len(parts):
            event_code = parts[idx + 1]
        if not date_code and idx + 2 < len(parts):
            date_code = parts[idx + 2]

    params = {
        "etCodes": qs.get("etCodes", ["*"])[0],
        "dateCode": date_code or "20261218",
        "isDesktop": "true",
        "regionCode": "CHEN",
        "xLocationShared": "false",
        "memberId": "",
        "lsId": "",
        "subCode": "",
        "appCode": "WEB",
        "language": qs.get("language", ["english"])[0],
        "refEventCode": event_code or "ET00526306",
    }
    api_url = f"{API_BASE_URL}?{urllib.parse.urlencode(params)}"
    return api_url, raw_url


def parse_venues(payload: dict) -> dict[str, str]:
    venues: dict[str, str] = {}
    widgets = payload.get("data", {}).get("showtimeWidgets", [])
    for widget in widgets:
        if widget.get("type") != "groupList":
            continue
        for group in widget.get("data", []):
            for item in group.get("data", []):
                if item.get("type") != "venue-card":
                    continue
                extra = item.get("additionalData", {})
                code = extra.get("venueCode") or item.get("id")
                name = extra.get("venueName") or code
                if code:
                    venues[code] = name
    return venues


async def fetch_venues_direct(raw_url: str) -> dict[str, str]:
    api_url, referer = build_api_url(raw_url)
    headers = {**DEFAULT_HEADERS, "Referer": referer}

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(api_url, headers=headers)
        if resp.status_code != 200:
            snippet = resp.text[:200].replace("\n", " ")
            raise RuntimeError(f"HTTP {resp.status_code} from BMS API: {snippet}")
        try:
            payload = resp.json()
        except Exception as exc:
            snippet = resp.text[:200].replace("\n", " ")
            raise RuntimeError(f"Non-JSON response ({exc}): {snippet}") from exc

    return parse_venues(payload)


def send_ntfy_notification(title: str, message: str) -> None:
    print(f"[ALERT] {title}: {message}")
    if NTFY_TOPIC:
        req = urllib.request.Request(
            f"https://ntfy.sh/{NTFY_TOPIC}",
            data=message.encode("utf-8"),
            headers={"Title": title},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=10)
        except Exception as exc:
            print(f"[WARN] ntfy push failed: {exc}")


async def send_brevo_email(recipients: list[str], subject: str, text_body: str) -> None:
    cleaned = [addr.strip() for addr in recipients if addr and addr.strip()]
    if not cleaned:
        return

    if not (BREVO_API_KEY and BREVO_SENDER_EMAIL):
        print("[WARN] Brevo email skipped: BREVO_API_KEY or BREVO_SENDER_EMAIL not set.")
        return

    html_lines = "<br>".join(text_body.splitlines())
    payload = {
        "sender": {
            "name": BREVO_SENDER_NAME,
            "email": BREVO_SENDER_EMAIL,
        },
        "to": [{"email": addr} for addr in cleaned],
        "subject": subject,
        "textContent": text_body,
        "htmlContent": f"<p>{html_lines}</p>",
    }
    headers = {
        "api-key": BREVO_API_KEY,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.brevo.com/v3/smtp/email",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
        print(f"[BREVO SENT] To {len(cleaned)} recipient(s): {subject}")
    except Exception as exc:
        print(f"[WARN] Brevo email failed: {exc}")


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


async def poll_loop(watches_col, seen_col) -> None:
    while True:
        now = datetime.now(timezone.utc)
        async for job in watches_col.find({"active": True}):
            last_checked_str = job.get("last_checked_at")
            interval_sec = max(300, min(600, int(job.get("interval_minutes", 7)) * 60))

            if last_checked_str:
                elapsed = (now - datetime.fromisoformat(last_checked_str)).total_seconds()
                if elapsed < interval_sec:
                    continue

            watch_id = job["_id"]
            try:
                current = await fetch_venues_direct(job["url"])
                added = await record_venues_and_get_new(
                    seen_col, watch_id, current, mark_notified=True
                )

                if added:
                    summary = "; ".join(f"{name} ({code})" for code, name in added)
                    watch_label = job.get("label") or "BookMyShow Watch"
                    title = f"New Theatre - {watch_label}"
                    email_body = (
                        f"New theatre(s) added for {watch_label}:\n\n"
                        + "\n".join(f"- {name} ({code})" for code, name in added)
                        + f"\n\nShowtimes URL: {job['url']}"
                    )
                    await asyncio.to_thread(send_ntfy_notification, title, summary)
                    await send_brevo_email(job.get("emails", []), title, email_body)

                await watches_col.update_one(
                    {"_id": watch_id},
                    {
                        "$set": {
                            "last_checked_at": datetime.now(timezone.utc).isoformat(),
                            "last_error": None,
                        }
                    },
                )
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

        await asyncio.sleep(30 + random.randint(0, 15))


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = AsyncMongoClient(MONGO_URI)
    db = client[MONGO_DB]
    watches_col = db["watches"]
    seen_col = db["seen_venues"]

    await seen_col.create_indexes(
        [IndexModel([("watch_id", ASCENDING), ("venue_code", ASCENDING)], unique=True)]
    )

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
def health() -> dict:
    return {"status": "ok"}


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
    venues = []
    async for v in app.state.seen_col.find({"watch_id": watch_id}, {"_id": 0}):
        venues.append(v)
    return venues


@app.delete("/watches/{watch_id}")
async def delete_watch(watch_id: str):
    res = await app.state.watches_col.delete_one({"_id": watch_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Watch not found.")
    await app.state.seen_col.delete_many({"watch_id": watch_id})
    return {"deleted": watch_id}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)