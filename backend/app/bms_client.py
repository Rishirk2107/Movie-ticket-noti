import asyncio
import re
import urllib.parse
from datetime import date, datetime
from urllib.parse import parse_qs, urlparse
from curl_cffi.requests import AsyncSession

from app.config import API_BASE_URL, DEFAULT_HEADERS, SYNOPSIS_API_URL
from app.logger import add_log

# Release date formats BMS uses: "Nov 20, 2026", "Dec 17, 2026", "20 Nov, 2026"
_RELEASE_DATE_FORMATS = [
    "%b %d, %Y",   # Nov 20, 2026
    "%d %b, %Y",   # 20 Nov, 2026
    "%B %d, %Y",   # November 20, 2026
    "%d %B, %Y",   # 20 November, 2026
]


def parse_release_date(date_str: str) -> date | None:
    """Parse BMS release-date strings into a Python date, or None if unparseable."""
    if not date_str:
        return None
    cleaned = date_str.strip()
    for fmt in _RELEASE_DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def extract_url_info(raw_url: str) -> dict:
    parsed = urlparse(raw_url)
    qs = parse_qs(parsed.query)

    parts = [p for p in parsed.path.split("/") if p]
    event_code = qs.get("refEventCode", [None])[0]
    date_code = qs.get("dateCode", [None])[0]

    city = ""
    movie_slug = ""
    if "movies" in parts:
        m_idx = parts.index("movies")
        if m_idx + 1 < len(parts):
            city = parts[m_idx + 1].capitalize()
        if m_idx + 2 < len(parts):
            movie_slug = parts[m_idx + 2].replace("-", " ").title()

    if "buytickets" in parts:
        idx = parts.index("buytickets")
        if not event_code and idx + 1 < len(parts):
            event_code = parts[idx + 1]
        if not date_code and idx + 2 < len(parts):
            date_code = parts[idx + 2]

    # Look for ET code and 8-digit dateCode anywhere in parts
    for p in parts:
        m_et = re.search(r"ET\d{8}", p, re.IGNORECASE)
        if m_et and (not event_code or not re.match(r"^ET\d{8}$", event_code, re.IGNORECASE)):
            event_code = m_et.group(0).upper()
        m_date = re.search(r"\b(20\d{6})\b", p)
        if m_date and (not date_code or len(date_code) != 8):
            date_code = m_date.group(1)

    # Pull language robustly from query string
    language = qs.get("language", [None])[0]
    if not language:
        # Fallback: look for language= anywhere in the raw url
        m = re.search(r"[?&]language=([^&]+)", raw_url)
        language = m.group(1).lower() if m else "english"

    return {
        "event_code": event_code or "ET00526306",
        "date_code": date_code or "20261218",
        "language": language,
        "et_codes": qs.get("etCodes", ["*"])[0],
        "city": city,
        "movie_name": movie_slug,
    }


def replace_url_date(raw_url: str, new_date_code: str) -> str:
    parsed = urlparse(raw_url)
    parts = parsed.path.split("/")
    new_parts = []

    replaced_in_path = False
    for i in range(len(parts)):
        if i >= 2 and parts[i - 2] == "buytickets":
            new_parts.append(new_date_code)
            replaced_in_path = True
        else:
            new_parts.append(parts[i])

    qs = parse_qs(parsed.query)
    if "dateCode" in qs or not replaced_in_path:
        qs["dateCode"] = [new_date_code]

    new_path = "/".join(new_parts)
    new_query = urllib.parse.urlencode(qs, doseq=True)
    return urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, new_path, parsed.params, new_query, parsed.fragment)
    )


def build_api_url(raw_url: str, date_code: str | None = None) -> tuple[str, str]:
    parsed = urlparse(raw_url)
    qs = parse_qs(parsed.query)

    if "/api/movies-data/" in parsed.path and "showtimes-by-event" in parsed.path:
        return raw_url, "https://in.bookmyshow.com/"

    info = extract_url_info(raw_url)
    active_date = date_code or info["date_code"]
    event_code = info["event_code"]

    params = {
        "etCodes": info["et_codes"],
        "dateCode": active_date,
        "isDesktop": "false",
        "regionCode": "CHEN",
        "xLocationShared": "false",
        "memberId": "",
        "lsId": "",
        "subCode": "",
        "appCode": "WEBV2",
        "language": info["language"],
        "refEventCode": event_code,
    }
    target_page_url = replace_url_date(raw_url, active_date) if date_code else raw_url
    return f"{API_BASE_URL}?{urllib.parse.urlencode(params)}", target_page_url


def parse_venues_and_dates(payload: dict) -> tuple[dict[str, str], list[str]]:
    """
    Parse showtime payload into:
      - venues: {venueCode: venueName}
      - available_dates: list of YYYYMMDD strings from topStickyWidgets date strip
    """
    venues: dict[str, str] = {}
    available_dates: list[str] = []

    data = payload.get("data", {})

    # --- Parse date strip from topStickyWidgets[0] ---
    top_sticky = data.get("topStickyWidgets", [])
    if top_sticky:
        for item in top_sticky[0].get("data", []):
            # Primary: item["id"] is 8-digit YYYYMMDD
            item_id = str(item.get("id", ""))
            if re.fullmatch(r"\d{8}", item_id):
                available_dates.append(item_id)
                continue
            # Fallback: cta.additionalData.dateCode
            fallback = (
                item.get("cta", {})
                .get("additionalData", {})
                .get("dateCode", "")
            )
            if re.fullmatch(r"\d{8}", str(fallback)):
                available_dates.append(str(fallback))

    # Deduplicate while preserving order
    seen_dc: set[str] = set()
    deduped: list[str] = []
    for dc in available_dates:
        if dc not in seen_dc:
            seen_dc.add(dc)
            deduped.append(dc)
    available_dates = deduped

    # --- Parse venue cards ---
    for widget in data.get("showtimeWidgets", []):
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

    return venues, available_dates


def _is_bms_autosnapped(payload: dict) -> bool:
    """Return True if BMS redirected us to a different date than requested."""
    title = (
        payload.get("data", {})
        .get("toast", {})
        .get("title", "")
    )
    return "date has been changed" in title.lower()


async def fetch_synopsis(
    event_code: str,
    session: AsyncSession | None = None,
) -> dict:
    """
    Call BMS synopsis endpoints to get movie metadata.
    Returns: {movie_name, release_date_str, release_date_8digit, release_date_obj}
    """
    ec_clean = event_code.strip().upper()
    ec_lower = ec_clean.lower()
    headers = {
        **DEFAULT_HEADERS,
        "Referer": "https://in.bookmyshow.com/",
    }

    async def _do(s: AsyncSession) -> dict:
        payload = None
        # Try mobile CDN synopsis cache
        for cdn_url in [
            f"https://in.bmscdn.com/moviesmaster/movies-synopsis-dynamic/chen-mob-{ec_lower}.json",
            f"https://assets-in.bmscdn.com/moviesmaster/movies-synopsis-dynamic/chen-mob-{ec_lower}.json",
        ]:
            try:
                r = await s.get(cdn_url)
                if r.status_code == 200:
                    payload = r.json()
                    break
            except Exception:
                pass

        # Try dynamic API with isdesktop=true
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
            movie_name = meta_event.get("eventName", "")
            release_date_str = meta_event.get("releaseDate", "")
            release_date_obj = parse_release_date(release_date_str)
            release_date_8digit = ""
            release_date_iso = ""
            if release_date_obj:
                release_date_8digit = release_date_obj.strftime("%Y%m%d")
                release_date_iso = release_date_obj.isoformat()
            if not opening_date_8digit:
                opening_date_8digit = release_date_8digit
                opening_date_iso = release_date_iso
                opening_date_str = release_date_str
            add_log(
                "INFO",
                f"Synopsis fetched for {ec_clean}: {movie_name!r}, release={release_date_str!r}, opening={opening_date_str!r}",
            )
            return {
                "movie_name": movie_name,
                "release_date_str": release_date_str,
                "release_date_iso": release_date_iso,
                "release_date_8digit": release_date_8digit,
                "release_date_obj": release_date_obj,
                "opening_date_str": opening_date_str,
                "opening_date_iso": opening_date_iso,
                "opening_date_8digit": opening_date_8digit,
                "available_dates": available_dates,
            }

        # Fallback to movie page scraping
        try:
            p_resp = await s.get(f"https://in.bookmyshow.com/movies/chennai/{ec_clean}", headers=headers)
            if p_resp.status_code == 200:
                html = p_resp.text
                m_title = re.search(r"<title>(.*?)(?:\s*-\s*Movie|\s*\||\s*-\s*BookMyShow)", html)
                fb_name = m_title.group(1).strip() if m_title else ec_clean
                return {
                    "movie_name": fb_name,
                    "release_date_str": "",
                    "release_date_iso": "",
                    "release_date_8digit": "",
                    "release_date_obj": None,
                    "opening_date_str": opening_date_str,
                    "opening_date_iso": opening_date_iso,
                    "opening_date_8digit": opening_date_8digit,
                    "available_dates": available_dates,
                }
        except Exception:
            pass

        return {
            "movie_name": ec_clean,
            "release_date_str": "",
            "release_date_iso": "",
            "release_date_8digit": "",
            "release_date_obj": None,
            "opening_date_str": opening_date_str,
            "opening_date_iso": opening_date_iso,
            "opening_date_8digit": opening_date_8digit,
            "available_dates": available_dates,
        }

    if session:
        return await _do(session)
    async with AsyncSession(impersonate="chrome", timeout=15.0) as s:
        return await _do(s)


async def fetch_venues_direct(
    raw_url: str,
    date_code: str | None = None,
    session: AsyncSession | None = None,
    max_retries: int = 2,
) -> tuple[dict[str, str], list[str]]:
    """
    Fetch venues for a given date. Returns (venues, available_dates).
    - venues: {venueCode: venueName}
    - available_dates: list of YYYYMMDD strings discovered in the date strip
    If BMS auto-snaps the date, returns ({}, []) to avoid storing a wrong date.
    """
    api_url, referer = build_api_url(raw_url, date_code=date_code)
    headers = {**DEFAULT_HEADERS, "Referer": referer}

    async def _fetch(s: AsyncSession) -> tuple[dict[str, str], list[str]]:
        for attempt in range(max_retries + 1):
            try:
                add_log("INFO", f"Calling BMS API for date {date_code or 'default'}...")
                resp = await s.get(api_url, headers=headers)
                if resp.status_code != 200:
                    snippet = resp.text[:200].replace("\n", " ")
                    add_log("ERROR", f"BMS API returned HTTP {resp.status_code}: {snippet}")
                    raise RuntimeError(f"HTTP {resp.status_code} from BMS API: {snippet}")
                try:
                    payload = resp.json()
                except Exception as exc:
                    snippet = resp.text[:200].replace("\n", " ")
                    add_log("ERROR", f"BMS API response is not valid JSON: {snippet}")
                    raise RuntimeError(f"Non-JSON response ({exc}): {snippet}") from exc

                # Detect BMS auto-snap: BMS served data for a *different* date
                if _is_bms_autosnapped(payload):
                    add_log(
                        "WARN",
                        f"BMS auto-snapped date {date_code} to another date — skipping this dateCode",
                    )
                    return {}, []

                venues, available_dates = parse_venues_and_dates(payload)
                add_log(
                    "SUCCESS",
                    f"BMS API responded 200 OK for date {date_code or 'default'} "
                    f"({len(venues)} venues found, {len(available_dates)} dates in strip)",
                )
                return venues, available_dates
            except Exception as e:
                if attempt < max_retries:
                    add_log(
                        "WARN",
                        f"BMS API call failed (attempt {attempt+1}/{max_retries+1}): {e}. Retrying...",
                    )
                    await asyncio.sleep(2.0 * (attempt + 1))
                else:
                    raise e

    if session:
        return await _fetch(session)

    async with AsyncSession(impersonate="chrome", timeout=15.0) as s:
        return await _fetch(s)
