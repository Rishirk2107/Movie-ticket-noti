import asyncio
import json
import random
import re
import urllib.parse
from datetime import date, datetime
from urllib.parse import parse_qs, urlparse
from curl_cffi.requests import AsyncSession

from app.config import (
    API_BASE_URL,
    BMS_COOKIE,
    BMS_PROXY_URL,
    DEFAULT_HEADERS,
    SYNOPSIS_API_URL,
)
from app.logger import add_log

BMS_IMPERSONATE_PROFILE = "chrome131"
BMS_HOME_URL = "https://in.bookmyshow.com/"


class BMSBlockedError(RuntimeError):
    """Raised when BookMyShow / Cloudflare returns HTTP 403."""

    def __init__(self, message: str, status_code: int = 403):
        super().__init__(message)
        self.status_code = status_code


_shared_session: AsyncSession | None = None
_session_warmed: bool = False
_proxy_logged: bool = False
_session_lock = asyncio.Lock()


def _mask_proxy_url(proxy_url: str) -> str:
    """Return a credential-free scheme://host:port summary for safe logging."""
    try:
        parsed = urlparse(proxy_url)
        scheme = parsed.scheme or "http"
        host = parsed.hostname or "unknown"
        port = f":{parsed.port}" if parsed.port else ""
        return f"{scheme}://{host}{port}"
    except Exception:
        return "<configured-proxy>"


def get_bms_proxies() -> dict[str, str] | None:
    if not BMS_PROXY_URL:
        return None
    return {"http": BMS_PROXY_URL, "https": BMS_PROXY_URL}


def build_rgn_cookie(region_code: str = "CHEN", city: str = "Chennai") -> str:
    """Build URL-encoded Rgn cookie matching the watch's region_code and city."""
    rc = (region_code or "CHEN").strip().upper()
    cn = (city or "Chennai").strip()
    raw_val = f"|Code={rc}|Name={cn}|"
    return f"Rgn={urllib.parse.quote(raw_val, safe='')}"


def _build_bms_headers(
    referer: str = BMS_HOME_URL,
    region_code: str = "CHEN",
    city: str = "Chennai",
) -> dict[str, str]:
    rc = (region_code or "CHEN").strip().upper()
    rgn_cookie = build_rgn_cookie(rc, city)
    cookie_parts = [rgn_cookie]
    if BMS_COOKIE:
        cookie_parts.append(BMS_COOKIE.strip())
    return {
        **DEFAULT_HEADERS,
        "x-region-code": rc,
        "Origin": "https://in.bookmyshow.com",
        "Referer": referer or BMS_HOME_URL,
        "Cookie": "; ".join(p for p in cookie_parts if p),
    }


async def get_bms_session() -> AsyncSession:
    """Return a persistent curl_cffi AsyncSession (reusing TLS/cookie state)."""
    global _shared_session, _proxy_logged
    async with _session_lock:
        if _shared_session is None:
            proxies = get_bms_proxies()
            if proxies and not _proxy_logged:
                add_log(
                    "INFO",
                    f"BMS outbound proxy enabled: {_mask_proxy_url(BMS_PROXY_URL)}",
                )
                _proxy_logged = True
            _shared_session = AsyncSession(
                impersonate=BMS_IMPERSONATE_PROFILE,
                timeout=15.0,
                proxies=proxies,
            )
        return _shared_session


async def reset_bms_session() -> None:
    """Close and clear the persistent session so next request re-warms cookies."""
    global _shared_session, _session_warmed
    async with _session_lock:
        old = _shared_session
        _shared_session = None
        _session_warmed = False
    if old is not None:
        try:
            await old.close()
        except Exception:
            pass


async def close_bms_session() -> None:
    """Cleanly close the shared BMS session on shutdown."""
    await reset_bms_session()


async def warmup_bms_session(
    session: AsyncSession,
    region_code: str = "CHEN",
    city: str = "Chennai",
    force: bool = False,
) -> None:
    """
    Hit https://in.bookmyshow.com/ once per session so Cloudflare clearance
    and region cookies persist across subsequent API requests.
    """
    global _session_warmed
    if _session_warmed and not force:
        return
    try:
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "Referer": BMS_HOME_URL,
            "Cookie": build_rgn_cookie(region_code, city),
        }
        resp = await session.get(BMS_HOME_URL, headers=headers)
        _session_warmed = True
        if resp.status_code == 403:
            add_log("WARN", "BMS warm-up hit HTTP 403; cookies may be challenged.")
        else:
            add_log("INFO", f"BMS session warmed up (HTTP {resp.status_code}).")
    except Exception as exc:
        add_log("WARN", f"BMS session warm-up failed: {exc}")

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
        if date_code:
            qs["dateCode"] = [str(date_code).strip()]
            new_query = urllib.parse.urlencode(qs, doseq=True)
            active_url = urllib.parse.urlunparse(
                (parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment)
            )
            return active_url, "https://in.bookmyshow.com/"
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
                item_type = item.get("type")
                if item_type not in ("venue-card", "venueCard"):
                    continue
                extra = item.get("additionalData", {}) or {}
                code = (
                    extra.get("venueCode")
                    or item.get("venueCode")
                    or item.get("id")
                )
                name = (
                    extra.get("venueName")
                    or item.get("venueName")
                    or item.get("name")
                    or code
                )
                if code:
                    venues[str(code)] = str(name)

    return venues, available_dates


def _is_bms_autosnapped(payload: dict, requested_date_code: str | None = None) -> tuple[bool, str]:
    r"""
    Check if BMS redirected/auto-snapped to a different date than requested.
    Returns:
      (is_snapped: bool, reason: str)

    Criteria for auto-snap:
    1. Toast title in data.toast or metadata.toast explicitly contains
       "date has been changed" (case-insensitive).
    2. When requested_date_code is provided and non-empty:
       returned_date_code (from data.additionalData.dateCode) is a valid 8-digit string
       (re.fullmatch(r"^\d{8}$", returned_date_code)) that explicitly differs from
       the normalized requested_date_code.
    """
    req_norm = str(requested_date_code).strip() if requested_date_code is not None else ""

    # Check toast in data.toast and metadata.toast
    toast_titles = [
        str(payload.get("data", {}).get("toast", {}).get("title", "")).strip(),
        str(payload.get("metadata", {}).get("toast", {}).get("title", "")).strip(),
    ]
    for title in toast_titles:
        if title and "date has been changed" in title.lower():
            return True, f'toast="{title}"'

    # Check dateCode in additionalData
    if req_norm:
        raw_ret = payload.get("data", {}).get("additionalData", {}).get("dateCode")
        ret_norm = str(raw_ret).strip() if raw_ret is not None else ""
        if ret_norm and re.fullmatch(r"^\d{8}$", ret_norm):
            if ret_norm != req_norm:
                return True, f"requested={req_norm} vs returned={ret_norm}"

    return False, ""


def parse_page_cta_from_html(html: str) -> list[dict]:
    """Extract pageCta JSON array from BookMyShow movie page HTML."""
    pos = html.find('"primaryCta"')
    if pos == -1:
        return []
    cta_start = html.rfind('"pageCta":', 0, pos)
    if cta_start == -1:
        return []
    array_start = html.find('[', cta_start)
    if array_start == -1:
        return []

    depth = 0
    in_string = False
    escape = False
    array_end = -1
    for i in range(array_start, len(html)):
        ch = html[i]
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if not in_string:
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    array_end = i + 1
                    break

    if array_end != -1:
        raw_json = html[array_start:array_end]
        try:
            return json.loads(raw_json)
        except Exception:
            pass
    return []


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
            # Parse language + format options from pageCta
            options: list[dict] = []
            page_cta = payload.get("pageCta", []) or []
            if not page_cta and movie_name:
                slug = re.sub(r"[^\w\s-]", "", movie_name).strip().lower()
                slug = re.sub(r"[-\s]+", "-", slug)
                movie_page_urls = [
                    f"https://in.bookmyshow.com/movies/chennai/{slug}/{ec_clean}",
                    f"https://in.bookmyshow.com/movies/chennai/{ec_clean}",
                ]
                for p_url in movie_page_urls:
                    try:
                        p_resp = await s.get(p_url, headers=headers)
                        if p_resp.status_code == 200:
                            page_cta = parse_page_cta_from_html(p_resp.text)
                            if page_cta:
                                break
                    except Exception:
                        pass

            for cta in page_cta:
                meta = cta.get("meta", {})
                for opt in meta.get("options", []):
                    lang = opt.get("language", "")
                    formats = opt.get("formats", [])
                    has_select_all = False
                    for fmt in formats:
                        dim = fmt.get("dimension", "")
                        ev_code = fmt.get("eventCode", "") or ec_clean
                        ref_ev_code = fmt.get("refEventCode", "") or ev_code or ec_clean
                        if dim.lower() == "select all" or ev_code == "*":
                            has_select_all = True
                        options.append({
                            "language": lang,
                            "dimension": dim,
                            "event_code": ev_code,
                            "ref_event_code": ref_ev_code,
                            "label": f"{lang} – {dim}",
                        })
                    if formats and not has_select_all:
                        first_fmt_ref = (
                            formats[0].get("refEventCode")
                            or formats[0].get("eventCode")
                            or ec_clean
                        )
                        options.append({
                            "language": lang,
                            "dimension": "Select all",
                            "event_code": "*",
                            "ref_event_code": first_fmt_ref,
                            "label": f"{lang} – Select all",
                        })

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
                "options": options,
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
        await warmup_bms_session(session)
        return await _do(session)
    shared = await get_bms_session()
    await warmup_bms_session(shared)
    return await _do(shared)


async def fetch_venues_direct(
    raw_url: str,
    date_code: str | None = None,
    session: AsyncSession | None = None,
    max_retries: int = 2,
    region_code: str = "CHEN",
    city: str = "Chennai",
) -> tuple[dict[str, str], list[str]]:
    """
    Fetch venues for a given date. Returns (venues, available_dates).
    - venues: {venueCode: venueName}
    - available_dates: list of YYYYMMDD strings discovered in the date strip
    If BMS auto-snaps the date, returns ({}, []) to avoid storing a wrong date.
    Raises BMSBlockedError immediately on HTTP 403 without retrying.
    """
    api_url, referer = build_api_url(raw_url, date_code=date_code)
    headers = _build_bms_headers(referer=referer, region_code=region_code, city=city)

    async def _fetch(s: AsyncSession) -> tuple[dict[str, str], list[str]]:
        await warmup_bms_session(s, region_code=region_code, city=city)

        for attempt in range(max_retries + 1):
            try:
                add_log("INFO", f"Calling BMS API for date {date_code or 'default'}...")
                resp = await s.get(api_url, headers=headers)

                if resp.status_code == 403:
                    snippet = resp.text[:200].replace("\n", " ")
                    add_log("ERROR", f"BMS API returned HTTP 403 (Cloudflare block): {snippet}")
                    await reset_bms_session()
                    raise BMSBlockedError(f"HTTP 403 from BMS API: {snippet}", status_code=403)

                if resp.status_code == 429 or 500 <= resp.status_code < 600:
                    snippet = resp.text[:200].replace("\n", " ")
                    raise RuntimeError(f"Transient HTTP {resp.status_code} from BMS API: {snippet}")

                if resp.status_code != 200:
                    snippet = resp.text[:200].replace("\n", " ")
                    add_log("ERROR", f"BMS API returned HTTP {resp.status_code}: {snippet}")
                    # Non-retryable 4xx (other than 403/429)
                    raise ValueError(f"HTTP {resp.status_code} from BMS API: {snippet}")

                try:
                    payload = resp.json()
                except Exception as exc:
                    snippet = resp.text[:200].replace("\n", " ")
                    add_log("ERROR", f"BMS API response is not valid JSON: {snippet}")
                    raise RuntimeError(f"Non-JSON response ({exc}): {snippet}") from exc

                # Detect BMS auto-snap: BMS served data for a *different* date
                is_snapped, snap_reason = _is_bms_autosnapped(payload, requested_date_code=date_code)
                if is_snapped:
                    add_log(
                        "WARN",
                        f"BMS auto-snapped date {date_code} to another date ({snap_reason}) — skipping this dateCode",
                    )
                    return {}, []

                venues, available_dates = parse_venues_and_dates(payload)
                add_log(
                    "SUCCESS",
                    f"BMS API responded 200 OK for date {date_code or 'default'} "
                    f"({len(venues)} venues found, {len(available_dates)} dates in strip)",
                )
                return venues, available_dates
            except (BMSBlockedError, ValueError):
                # Do not retry HTTP 403 or non-retryable 4xx
                raise
            except Exception as e:
                if attempt < max_retries:
                    backoff = (2 ** attempt) + random.uniform(0.3, 1.2)
                    add_log(
                        "WARN",
                        f"BMS API call failed (attempt {attempt+1}/{max_retries+1}): {e}. Retrying in {backoff:.1f}s...",
                    )
                    await asyncio.sleep(backoff)
                else:
                    raise

    if session:
        return await _fetch(session)

    shared = await get_bms_session()
    return await _fetch(shared)
