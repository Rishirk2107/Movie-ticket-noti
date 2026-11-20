import asyncio
import re
import urllib.parse
from urllib.parse import parse_qs, urlparse
from curl_cffi.requests import AsyncSession
from app.config import API_BASE_URL, DEFAULT_HEADERS


def extract_url_info(raw_url: str) -> dict:
    parsed = urlparse(raw_url)
    qs = parse_qs(parsed.query)

    parts = [p for p in parsed.path.split("/") if p]
    event_code = qs.get("refEventCode", [None])[0]
    date_code = qs.get("dateCode", [None])[0]

    if "buytickets" in parts:
        idx = parts.index("buytickets")
        if not event_code and idx + 1 < len(parts):
            event_code = parts[idx + 1]
        if not date_code and idx + 2 < len(parts):
            date_code = parts[idx + 2]

    return {
        "event_code": event_code or "ET00526306",
        "date_code": date_code or "20261218",
        "language": qs.get("language", ["english"])[0],
        "et_codes": qs.get("etCodes", ["*"])[0],
    }


def replace_url_date(raw_url: str, new_date_code: str) -> str:
    parsed = urlparse(raw_url)
    parts = parsed.path.split("/")
    new_parts = []
    
    # Check if buytickets/{event_code}/{date_code} pattern exists in path
    replaced_in_path = False
    for i in range(len(parts)):
        if i >= 2 and parts[i - 2] == "buytickets":
            # This is the date code segment
            new_parts.append(new_date_code)
            replaced_in_path = True
        else:
            new_parts.append(parts[i])

    qs = parse_qs(parsed.query)
    if "dateCode" in qs or not replaced_in_path:
        qs["dateCode"] = [new_date_code]

    new_path = "/".join(new_parts)
    # reconstruct query string
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
        "isDesktop": "true",
        "regionCode": "CHEN",
        "xLocationShared": "false",
        "memberId": "",
        "lsId": "",
        "subCode": "",
        "appCode": "WEB",
        "language": info["language"],
        "refEventCode": event_code,
    }
    target_page_url = replace_url_date(raw_url, active_date) if date_code else raw_url
    return f"{API_BASE_URL}?{urllib.parse.urlencode(params)}", target_page_url


def parse_venues(payload: dict) -> dict[str, str]:
    venues: dict[str, str] = {}
    for widget in payload.get("data", {}).get("showtimeWidgets", []):
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


async def fetch_venues_direct(
    raw_url: str,
    date_code: str | None = None,
    session: AsyncSession | None = None,
    max_retries: int = 2,
) -> dict[str, str]:
    api_url, referer = build_api_url(raw_url, date_code=date_code)
    headers = {**DEFAULT_HEADERS, "Referer": referer}

    async def _fetch(s: AsyncSession):
        for attempt in range(max_retries + 1):
            try:
                resp = await s.get(api_url, headers=headers)
                if resp.status_code != 200:
                    snippet = resp.text[:200].replace("\n", " ")
                    raise RuntimeError(f"HTTP {resp.status_code} from BMS API: {snippet}")
                try:
                    payload = resp.json()
                except Exception as exc:
                    snippet = resp.text[:200].replace("\n", " ")
                    raise RuntimeError(f"Non-JSON response ({exc}): {snippet}") from exc
                return parse_venues(payload)
            except Exception as e:
                if attempt < max_retries:
                    await asyncio.sleep(2.0 * (attempt + 1))
                else:
                    raise e

    if session:
        return await _fetch(session)

    async with AsyncSession(impersonate="chrome", timeout=15.0) as s:
        return await _fetch(s)