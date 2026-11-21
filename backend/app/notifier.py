import asyncio
import urllib.request
import httpx
from app.config import (
    ADMIN_ALERT_EMAIL,
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


async def notify_new_venues(
    label: str | None,
    url: str,
    emails: list[str],
    added: list[tuple[str, str]],
    date_code: str | None = None,
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
    email_body = (
        f"New theatre(s) added for {watch_label}{date_formatted}:\n\n"
        + "\n".join(f"- {name} ({code})" for code, name in added)
        + f"\n\nShowtimes URL: {url}"
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

    subject = f"Notification Alert Set: {label}"
    text_body = (
        f"Hello,\n\n"
        f"You have been registered to receive BookMyShow ticket alerts for:\n\n"
        f"• Movie / Event: {movie_name or label}\n"
        f"• Watch Label: {label}\n"
        f"• Area / City: {city or 'Not specified'}\n"
        f"• Date Range: {date_str}\n"
        f"• Currently Open Theatres: {initial_theatres_count}\n"
        f"• Showtimes URL: {url}\n\n"
        f"You will receive an instant email whenever new theatres or screens open up for these dates!\n\n"
        f"— BMS Ticket Alerts"
    )
    await send_brevo_email(emails, subject, text_body)


async def send_failure_alert_email(
    watch_label: str,
    watch_url: str,
    errors: list[str],
    watch_id: str,
) -> None:
    if not ADMIN_ALERT_EMAIL:
        return

    subject = f"[ALERT] BMS Watch Failure: {watch_label}"
    err_details = "\n".join(f"• {e}" for e in errors)
    body = (
        f"Hi,\n\n"
        f"A BookMyShow polling check failed for:\n\n"
        f"• Watch Label: {watch_label}\n"
        f"• Watch ID: {watch_id}\n"
        f"• Showtimes URL: {watch_url}\n\n"
        f"Error Details:\n"
        f"{err_details}\n\n"
        f"Please check if BookMyShow is blocking requests or if the URL/cookie needs updating.\n\n"
        f"— BMS Watcher System"
    )
    await send_brevo_email([ADMIN_ALERT_EMAIL], subject, body)
