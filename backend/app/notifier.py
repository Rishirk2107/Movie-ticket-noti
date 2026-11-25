import asyncio
import urllib.request
import httpx
from app.config import (
    BREVO_API_KEY,
    BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME,
    NTFY_TOPIC,
)


def _post_ntfy_sync(title: str, message: str) -> None:
    if not NTFY_TOPIC:
        return
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


async def send_ntfy_notification(title: str, message: str) -> None:
    print(f"[ALERT] {title}: {message}")
    await asyncio.to_thread(_post_ntfy_sync, title, message)


async def send_brevo_email(recipients: list[str], subject: str, text_body: str) -> None:
    cleaned = [addr.strip() for addr in recipients if addr and addr.strip()]
    if not cleaned:
        return

    if not (BREVO_API_KEY and BREVO_SENDER_EMAIL):
        print("[WARN] Brevo email skipped: BREVO_API_KEY or BREVO_SENDER_EMAIL not set.")
        return

    html_lines = "<br>".join(text_body.splitlines())
    payload = {
        "sender": {"name": BREVO_SENDER_NAME, "email": BREVO_SENDER_EMAIL},
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


import re
import urllib.parse
from urllib.parse import parse_qs, urlparse


def _slugify(text: str) -> str:
    """Generate a clean URL slug from a movie name."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "movie"


def _format_public_bms_url(raw_url: str, date_code: str = "", movie_name: str = "") -> str:
    """
    Convert internal BMS API URLs into user-friendly BookMyShow web URLs for emails.
    Format:
      https://in.bookmyshow.com/movies/chennai/{slug}/buytickets/{event_code}/{date_code}?etCodes={etCodes}&language={language}&refEventCode={refEventCode}
    """
    if not raw_url:
        return "https://in.bookmyshow.com/explore/movies-chennai"

    if "/api/movies-data/" not in raw_url:
        return raw_url

    parsed = urlparse(raw_url)
    qs = parse_qs(parsed.query)

    ref_event = (qs.get("refEventCode") or [""])[0].strip()
    et_codes = (qs.get("etCodes") or ["*"])[0].strip()
    language = (qs.get("language") or ["english"])[0].strip().lower()

    # Event code in path: prefer et_codes if valid ET code, otherwise ref_event
    event_code = et_codes if re.match(r"^ET\d+$", et_codes, re.IGNORECASE) else ref_event
    if not event_code or event_code == "*":
        event_code = ref_event

    if not event_code:
        return "https://in.bookmyshow.com/explore/movies-chennai"

    dc = (date_code or (qs.get("dateCode") or [""])[0]).strip()
    slug = _slugify(movie_name) if movie_name else ""

    # Path format: /movies/chennai/{slug}/buytickets/{event_code}/{dc}
    # If slug is absent, fallback to /movies/chennai/{event_code}
    path_parts = ["movies", "chennai"]
    if slug and slug != "movie":
        path_parts.append(slug)
    path_parts.append("buytickets")
    path_parts.append(event_code)
    if dc:
        path_parts.append(dc)

    out_path = "/" + "/".join(path_parts)
    query_params = {
        "etCodes": et_codes or "*",
        "language": language or "english",
        "refEventCode": ref_event or event_code,
    }
    return f"https://in.bookmyshow.com{out_path}?{urllib.parse.urlencode(query_params)}"


async def notify_new_venues(
    label: str | None,
    url: str,
    emails: list[str],
    added: list[tuple[str, str]],
    date_code: str | None = None,
    movie_name: str | None = None,
) -> None:
    if not added:
        return
    watch_label = label or "BookMyShow Watch"
    date_formatted = ""
    if date_code and len(date_code) == 8:
        # e.g. 20261218 -> 2026-12-18
        date_formatted = f" ({date_code[:4]}-{date_code[4:6]}-{date_code[6:]})"
    
    title = f"New Theatre - {watch_label}{date_formatted}"
    summary = "; ".join(f"{name} ({code})" for code, name in added)
    m_name = movie_name or (label.split(" - ")[0] if label else "")
    public_url = _format_public_bms_url(url, date_code=date_code, movie_name=m_name)
    email_body = (
        f"New theatre(s) added for {watch_label}{date_formatted}:\n\n"
        + "\n".join(f"- {name} ({code})" for code, name in added)
        + f"\n\nShowtimes URL: {public_url}"
    )
    await send_ntfy_notification(title, summary)
    await send_brevo_email(emails, title, email_body)


async def send_watch_registration_email(
    emails: list[str],
    label: str,
    movie_name: str,
    city: str,
    start_date: str | None,
    end_date: str | None,
    url: str,
    initial_theatres_count: int,
) -> None:
    if not emails:
        return
    
    date_str = ""
    if start_date and end_date and start_date != end_date:
        date_str = f"{start_date} to {end_date}"
    elif start_date:
        date_str = start_date
    else:
        date_str = "Selected date(s)"

    m_name = movie_name or (label.split(" - ")[0] if label else "")
    public_url = _format_public_bms_url(url, movie_name=m_name)
    subject = f"Notification Alert Set: {label}"
    text_body = (
        f"Hello,\n\n"
        f"You have been registered to receive BookMyShow ticket alerts for:\n\n"
        f"• Movie / Event: {movie_name or label}\n"
        f"• Watch Label: {label}\n"
        f"• Area / City: {city or 'Not specified'}\n"
        f"• Date Range: {date_str}\n"
        f"• Currently Open Theatres: {initial_theatres_count}\n"
        f"• Showtimes URL: {public_url}\n\n"
        f"You will receive an instant email whenever new theatres or screens open up for these dates!\n\n"
        f"— BMS Ticket Alerts"
    )
    await send_brevo_email(emails, subject, text_body)
