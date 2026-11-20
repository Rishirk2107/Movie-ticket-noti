import urllib.parse
from urllib.parse import parse_qs, urlparse
from curl_cffi.requests import AsyncSession
from app.config import API_BASE_URL, DEFAULT_HEADERS


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
    return f"{API_BASE_URL}?{urllib.parse.urlencode(params)}", raw_url


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


async def fetch_venues_direct(raw_url: str) -> dict[str, str]:
    api_url, referer = build_api_url(raw_url)
    headers = {**DEFAULT_HEADERS, "Referer": referer}

    async with AsyncSession(impersonate="chrome", timeout=20.0) as session:
        resp = await session.get(api_url, headers=headers)
        if resp.status_code != 200:
            snippet = resp.text[:200].replace("\n", " ")
            raise RuntimeError(f"HTTP {resp.status_code} from BMS API: {snippet}")
        try:
            payload = resp.json()
        except Exception as exc:
            snippet = resp.text[:200].replace("\n", " ")
            raise RuntimeError(f"Non-JSON response ({exc}): {snippet}") from exc

    return parse_venues(payload)