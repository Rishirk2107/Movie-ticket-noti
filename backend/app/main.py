# app/main.py
import asyncio
import re
import urllib.parse
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from curl_cffi.requests import AsyncSession
from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, HttpUrl

from app.bms_client import (
    build_api_url,
    extract_url_info,
    fetch_synopsis,
    fetch_venues_direct,
    parse_release_date,
    parse_venues_and_dates,
    replace_url_date,
)
from app.config import (
    API_BASE_URL,
    CORS_ORIGINS,
    DEFAULT_HEADERS,
    IST_TZ,
    SYNOPSIS_API_URL,
    SYNOPSIS_STATIC_API_URL,
)
from app.db import init_db, record_venues_and_get_new, update_watch_available_dates
from app.logger import get_logs
from app.notifier import send_watch_registration_email
from app.poller import get_poll_date_codes, poll_loop

TEMPLATES_DIR = Path(__file__).parent / "templates"
INDEX_HTML_PATH = TEMPLATES_DIR / "index.html"
CREATE_HTML_PATH = TEMPLATES_DIR / "create.html"

# ─────────────────────────── BMS URL builder ────────────────────────────────

def _build_bms_url_from_parts(
    ref_event_code: str,
    et_codes: str,
    language: str,
    date_code: str,
) -> str:
    """Build a synthetic BMS showtimes API URL from picked movie parts."""
    params = {
        "etCodes": et_codes,
        "dateCode": date_code,
        "isDesktop": "false",
        "regionCode": "CHEN",
        "xLocationShared": "false",
        "memberId": "",
        "lsId": "",
        "subCode": "",
        "appCode": "WEBV2",
        "language": language.lower(),
        "refEventCode": ref_event_code,
    }
    return f"{API_BASE_URL}?{urllib.parse.urlencode(params)}"


# ─────────────────────────── Pydantic models ─────────────────────────────────

class WatchCreateRequest(BaseModel):
    url: Optional[HttpUrl] = None          # legacy: raw BMS URL (still accepted)
    # New structured fields (used when url is absent)
    ref_event_code: Optional[str] = None   # e.g. ET00526306
    et_codes: Optional[str] = "*"          # etCodes param
    language: Optional[str] = "english"
    # common
    interval_minutes: int = 10
    label: str
    emails: list[str] = []
    start_date: Optional[str] = None       # YYYY-MM-DD
    end_date: Optional[str] = None         # YYYY-MM-DD
    include_preview: bool = False          # include releaseDate-1 date


# ─────────────────────────── App lifespan ────────────────────────────────────

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────── HTML pages ──────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def home() -> HTMLResponse:
    if INDEX_HTML_PATH.exists():
        return HTMLResponse(content=INDEX_HTML_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h2>index.html not found</h2>", status_code=500)


@app.get("/create", response_class=HTMLResponse)
def create_page() -> HTMLResponse:
    if CREATE_HTML_PATH.exists():
        return HTMLResponse(content=CREATE_HTML_PATH.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h2>create.html not found</h2>", status_code=500)


# ─────────────────────────── Health ──────────────────────────────────────────

@app.get("/health")
async def health_check(response: Response):
    try:
        await app.state.watches_col.database.client.admin.command("ping")
        active_watches = await app.state.watches_col.count_documents({"active": True})
        return {"status": "ok", "db": "connected", "active_watches": active_watches}
    except Exception as exc:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "db": "disconnected", "detail": str(exc)}


# ─────────────────────────── BMS proxy endpoints ─────────────────────────────

def _extract_movie_cards(data: dict) -> list[dict]:
    movies: list[dict] = []
    seen_codes = set()
    for listing in data.get("listings", []):
        for card in listing.get("cards", []):
            analytics = card.get("analytics", {})
            ec = analytics.get("event_code", "")
            title = analytics.get("title", "")
            cta_url = card.get("ctaUrl", "")

            # Fallback for event code from ctaUrl (e.g. /ET00504901)
            if not ec and cta_url:
                m_ec = re.search(r"ET\d{8}", cta_url)
                if m_ec:
                    ec = m_ec.group(0)

            # Fallback for title from text components
            if not title:
                for text_item in card.get("text", []):
                    for comp in text_item.get("components", []):
                        if comp.get("text"):
                            title = comp.get("text")
                            break
                    if title:
                        break

            if not ec or not title:
                continue

            if ec in seen_codes:
                continue
            seen_codes.add(ec)

            poster = ""
            img = card.get("image", card.get("poster", {}))
            if isinstance(img, dict):
                poster = img.get("url", img.get("src", ""))
            elif isinstance(img, str):
                poster = img

            movies.append({
                "event_code": ec,
                "event_group": analytics.get("event_group", card.get("id", "")),
                "title": title,
                "language": analytics.get("language", ""),
                "genre": analytics.get("genre", ""),
                "cta_url": cta_url,
                "poster": poster,
            })
    return movies


@app.get("/api/bms/movies")
async def proxy_movies_chennai():
    """
    Get movies in Chennai.
    Tries BMS CDN response cache, then discovery API, then explore HTML fallback.
    """
    async with AsyncSession(impersonate="chrome", timeout=15.0) as s:
        # Strategy 1: BMS CDN Response Cache for movies-chen-web
        cdn_urls = [
            "https://assets-in.bmscdn.com/discovery-catalog/response-cache/movies-chen-web.json",
            "https://in.bmscdn.com/discovery-catalog/response-cache/movies-chen-web.json",
        ]
        for cdn_url in cdn_urls:
            try:
                resp = await s.get(cdn_url)
                if resp.status_code == 200:
                    movies = _extract_movie_cards(resp.json())
                    if movies:
                        return {"movies": movies, "count": len(movies)}
            except Exception:
                pass

        # Strategy 2: BMS discover API endpoint
        try:
            api_url = "https://in.bookmyshow.com/api/explore/v1/discover/movies-chennai"
            headers = {
                **DEFAULT_HEADERS,
                "x-bms-id": "1",
                "Referer": "https://in.bookmyshow.com/explore/movies-chennai",
            }
            resp = await s.get(api_url, headers=headers)
            if resp.status_code == 200:
                movies = _extract_movie_cards(resp.json())
                if movies:
                    return {"movies": movies, "count": len(movies)}
        except Exception:
            pass

        # Strategy 3: HTML SSR window.__INITIAL_STATE__ fallback
        try:
            html_url = "https://in.bookmyshow.com/explore/movies-chennai"
            resp = await s.get(html_url, headers=DEFAULT_HEADERS)
            if resp.status_code == 200:
                html = resp.text
                m = re.search(r"window\.__INITIAL_STATE__\s*=\s*", html)
                if m:
                    end_script = html.find("</script>", m.start())
                    raw_json = html[m.end():end_script].strip().rstrip(";")
                    import json
                    state = json.loads(raw_json)
                    explore = state.get("exploreApi", {}).get("queries", {})
                    for key, val in explore.items():
                        if "movies-chennai" in key:
                            movies = _extract_movie_cards(val.get("data", {}))
                            if movies:
                                return {"movies": movies, "count": len(movies)}
        except Exception:
            pass

    return {"movies": [], "count": 0}


@app.get("/api/bms/synopsis")
async def proxy_synopsis(eventcode: str):
    """
    Proxy GET synopsis/init/dynamic for a given eventcode.
    Returns parsed language/format options (2D, IMAX 2D, Select all) + release metadata.
    Uses BMS mobile synopsis CDN cache first, then dynamic API (isdesktop=true), then HTML fallback.
    """
    ec_clean = eventcode.strip().upper()
    ec_lower = ec_clean.lower()
    headers = {**DEFAULT_HEADERS, "Referer": "https://in.bookmyshow.com/"}

    payload = None
    async with AsyncSession(impersonate="chrome", timeout=15.0) as s:
        # Strategy 1: BMS mobile synopsis CDN cache (contains exact pageCta language & format options)
        cdn_urls = [
            f"https://in.bmscdn.com/moviesmaster/movies-synopsis-dynamic/chen-mob-{ec_lower}.json",
            f"https://assets-in.bmscdn.com/moviesmaster/movies-synopsis-dynamic/chen-mob-{ec_lower}.json",
        ]
        for cdn_url in cdn_urls:
            try:
                resp = await s.get(cdn_url)
                if resp.status_code == 200:
                    payload = resp.json()
                    break
            except Exception:
                pass

        # Strategy 2: BMS dynamic synopsis API with isdesktop=true
        if not payload:
            try:
                params = {
                    "eventcode": ec_clean,
                    "channel": "web",
                    "isdesktop": "true",
                    "isRnROnly": "false",
                    "regionCode": "CHEN",
                }
                api_url = f"{SYNOPSIS_API_URL}?{urllib.parse.urlencode(params)}"
                resp = await s.get(api_url, headers=headers)
                if resp.status_code == 200:
                    payload = resp.json()
            except Exception:
                pass

        # Probe showtimes endpoint to find active date strip & early opening dates
        available_dates: list[str] = []
        try:
            st_params = {
                "etCodes": "*",
                "dateCode": "",
                "isDesktop": "false",
                "regionCode": "CHEN",
                "xLocationShared": "false",
                "memberId": "",
                "lsId": "",
                "subCode": "",
                "appCode": "WEBV2",
                "language": "english",
                "refEventCode": ec_clean,
            }
            st_url = f"{API_BASE_URL}?{urllib.parse.urlencode(st_params)}"
            st_resp = await s.get(st_url, headers=headers)
            if st_resp.status_code == 200:
                _, available_dates = parse_venues_and_dates(st_resp.json())
        except Exception:
            pass

        opening_date_8digit = available_dates[0] if available_dates else ""
        opening_date_iso = (
            f"{opening_date_8digit[:4]}-{opening_date_8digit[4:6]}-{opening_date_8digit[6:]}"
            if (opening_date_8digit and len(opening_date_8digit) == 8)
            else ""
        )
        opening_date_str = ""
        if opening_date_8digit and len(opening_date_8digit) == 8:
            try:
                opening_date_str = datetime.strptime(opening_date_8digit, "%Y%m%d").strftime("%b %d, %Y")
            except Exception:
                opening_date_str = ""

        if payload and "meta" in payload and "event" in payload.get("meta", {}):
            meta_event = payload.get("meta", {}).get("event", {})
            release_date_str = meta_event.get("releaseDate", "")
            release_date_obj = parse_release_date(release_date_str)
            release_date_iso = release_date_obj.isoformat() if release_date_obj else ""
            release_date_8digit = release_date_obj.strftime("%Y%m%d") if release_date_obj else ""

            if not opening_date_8digit:
                opening_date_8digit = release_date_8digit
                opening_date_iso = release_date_iso
                opening_date_str = release_date_str

            # Parse language + format options from pageCta
            options: list[dict] = []
            page_cta = payload.get("pageCta", []) or []
            for cta in page_cta:
                meta = cta.get("meta", {})
                for opt in meta.get("options", []):
                    lang = opt.get("language", "")
                    formats = opt.get("formats", [])
                    for fmt in formats:
                        dim = fmt.get("dimension", "")
                        options.append({
                            "language": lang,
                            "dimension": dim,
                            "event_code": fmt.get("eventCode", "") or ec_clean,
                            "ref_event_code": fmt.get("refEventCode", "") or ec_clean,
                            "label": f"{lang} – {dim}",
                        })
                    # Add "Select all" format option per language (matches BMS UI)
                    if formats:
                        options.append({
                            "language": lang,
                            "dimension": "Select all",
                            "event_code": "*",
                            "ref_event_code": ec_clean,
                            "label": f"{lang} – Select all",
                        })

            # If no options found in pageCta, derive from eventDimension & eventLanguage
            if not options and meta_event.get("eventDimension"):
                dims = [d.strip() for d in meta_event.get("eventDimension", "").split(",") if d.strip()]
                langs = meta_event.get("eventLanguage", []) or ["English"]
                if isinstance(langs, str):
                    langs = [langs]
                for l in langs:
                    lang_cap = l.capitalize()
                    for dim in dims:
                        options.append({
                            "language": lang_cap,
                            "dimension": dim,
                            "event_code": "*",
                            "ref_event_code": ec_clean,
                            "label": f"{lang_cap} – {dim}",
                        })
                    options.append({
                        "language": lang_cap,
                        "dimension": "Select all",
                        "event_code": "*",
                        "ref_event_code": ec_clean,
                        "label": f"{lang_cap} – Select all",
                    })

            if not options:
                options = [
                    {
                        "language": "All Languages",
                        "dimension": "All Formats",
                        "event_code": "*",
                        "ref_event_code": ec_clean,
                        "label": "All Formats (*)",
                    }
                ]

            return {
                "event_code": meta_event.get("eventCode", ec_clean),
                "movie_name": meta_event.get("eventName", ""),
                "release_date_str": release_date_str,
                "release_date_iso": release_date_iso,
                "release_date_8digit": release_date_8digit,
                "opening_date_str": opening_date_str,
                "opening_date_iso": opening_date_iso,
                "opening_date_8digit": opening_date_8digit,
                "available_dates": available_dates,
                "book_button": meta_event.get("bookButton", False),
                "options": options,
            }

        # Strategy 3: HTML fallback for movie page
        movie_name = ""
        release_date_str = ""
        release_date_iso = ""
        release_date_8digit = ""
        try:
            page_url = f"https://in.bookmyshow.com/movies/chennai/{ec_clean}"
            page_resp = await s.get(page_url, headers=headers)
            if page_resp.status_code == 200:
                html = page_resp.text
                import json
                ld_matches = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
                for item in ld_matches:
                    try:
                        obj = json.loads(item)
                        if obj.get("@type") == "Movie":
                            movie_name = obj.get("name", "")
                            pub = obj.get("datePublished", "")
                            if pub:
                                release_date_iso = pub
                                release_date_obj = parse_release_date(pub)
                                if release_date_obj:
                                    release_date_8digit = release_date_obj.strftime("%Y%m%d")
                                    release_date_str = release_date_obj.strftime("%b %d, %Y")
                                else:
                                    release_date_8digit = pub.replace("-", "")
                                    release_date_str = pub
                            break
                    except Exception:
                        pass

                if not movie_name:
                    m_title = re.search(r"<title>(.*?)(?:\s*-\s*Movie|\s*\||\s*-\s*BookMyShow)", html)
                    if m_title:
                        movie_name = m_title.group(1).strip()
        except Exception:
            pass

        if not opening_date_8digit:
            opening_date_8digit = release_date_8digit
            opening_date_iso = release_date_iso
            opening_date_str = release_date_str

        return {
            "event_code": ec_clean,
            "movie_name": movie_name or ec_clean,
            "release_date_str": release_date_str,
            "release_date_iso": release_date_iso,
            "release_date_8digit": release_date_8digit,
            "opening_date_str": opening_date_str,
            "opening_date_iso": opening_date_iso,
            "opening_date_8digit": opening_date_8digit,
            "available_dates": available_dates,
            "book_button": False,
            "options": [
                {
                    "language": "All Languages",
                    "dimension": "All Formats",
                    "event_code": "*",
                    "ref_event_code": ec_clean,
                    "label": "All Formats (*)",
                }
            ],
        }


# ─────────────────────────── Watches CRUD ────────────────────────────────────

@app.post("/watches", status_code=201)
async def create_watch(payload: WatchCreateRequest):
    if payload.interval_minutes < 1:
        raise HTTPException(status_code=400, detail="interval_minutes must be at least 1.")

    # ── Resolve URL / event info ──
    if payload.url:
        url_str = str(payload.url)
        info = extract_url_info(url_str)
        ref_event_code = info["event_code"]
        et_codes = info["et_codes"]
        language = info["language"]
        city = info.get("city", "")
    elif payload.ref_event_code:
        ref_event_code = payload.ref_event_code.strip()
        et_codes = (payload.et_codes or "*").strip()
        language = (payload.language or "english").strip().lower()
        city = "Chennai"
        # Build a synthetic API URL — will be stored as job["url"]
        today_ist_code = datetime.now(IST_TZ).strftime("%Y%m%d")
        url_str = _build_bms_url_from_parts(
            ref_event_code, et_codes, language,
            (payload.start_date or "").replace("-", "") or today_ist_code
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either 'url' (BMS buytickets URL) or 'ref_event_code'."
        )

    # ── Dates ──
    start_date = payload.start_date
    if not start_date:
        if payload.url:
            info2 = extract_url_info(url_str)
            dc = info2.get("date_code", "")
            if dc and len(dc) == 8:
                start_date = f"{dc[:4]}-{dc[4:6]}-{dc[6:]}"
    end_date = payload.end_date or start_date

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

    # ── Synopsis for release date + movie name ──
    synopsis = {}
    try:
        synopsis = await fetch_synopsis(ref_event_code)
    except Exception as exc:
        print(f"[WARN] Synopsis fetch failed: {exc}")

    release_date_8digit = synopsis.get("release_date_8digit", "")
    movie_name = synopsis.get("movie_name", "") or payload.label

    # ── Determine initial date list to baseline ──
    initial_available_dates = synopsis.get("available_dates", [])
    doc_base = {
        "start_date": start_date,
        "end_date": end_date,
        "release_date_8digit": release_date_8digit,
        "available_dates": initial_available_dates,
    }
    date_codes_to_fetch = get_poll_date_codes(doc_base)

    if payload.include_preview and release_date_8digit and len(release_date_8digit) == 8:
        try:
            release_dt = datetime.strptime(release_date_8digit, "%Y%m%d").date()
            preview_dt = release_dt - timedelta(days=1)
            today = datetime.now(IST_TZ).date()
            preview_code = preview_dt.strftime("%Y%m%d")
            if preview_dt >= today and preview_code not in date_codes_to_fetch:
                date_codes_to_fetch = sorted(set(date_codes_to_fetch) | {preview_code})
        except ValueError:
            pass

    # ── Baseline fetch ──
    watch_id = str(uuid.uuid4())[:8]
    now_iso = datetime.now(timezone.utc).isoformat()
    cleaned_emails = [e.strip() for e in payload.emails if e and e.strip()]
    all_discovered_dates: set[str] = set(initial_available_dates)
    total_initial_venues = 0

    for i, d_code in enumerate(date_codes_to_fetch):
        if i > 0:
            await asyncio.sleep(1.0)
        try:
            initial_venues, discovered_dates = await fetch_venues_direct(
                url_str, date_code=d_code or None, max_retries=2
            )
            all_discovered_dates.update(discovered_dates)
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

    merged_dates = sorted(all_discovered_dates | set(date_codes_to_fetch))

    doc = {
        "_id": watch_id,
        "url": url_str,
        "label": payload.label,
        "movie_name": movie_name,
        "ref_event_code": ref_event_code,
        "et_codes": et_codes,
        "language": language,
        "city": city,
        "interval_minutes": payload.interval_minutes,
        "start_date": start_date,
        "end_date": end_date,
        "emails": cleaned_emails,
        "active": True,
        "created_at": now_iso,
        "last_checked_at": now_iso,
        "last_error": None,
        "release_date_8digit": release_date_8digit,
        "available_dates": merged_dates,
        "dates_updated_at": now_iso,
    }

    await app.state.watches_col.insert_one(doc)

    if cleaned_emails:
        asyncio.create_task(
            send_watch_registration_email(
                emails=cleaned_emails,
                label=payload.label,
                movie_name=movie_name,
                city=city,
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
