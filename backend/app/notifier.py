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


async def notify_new_venues(
    label: str | None,
    url: str,
    emails: list[str],
    added: list[tuple[str, str]],
) -> None:
    if not added:
        return
    watch_label = label or "BookMyShow Watch"
    title = f"New Theatre - {watch_label}"
    summary = "; ".join(f"{name} ({code})" for code, name in added)
    email_body = (
        f"New theatre(s) added for {watch_label}:\n\n"
        + "\n".join(f"- {name} ({code})" for code, name in added)
        + f"\n\nShowtimes URL: {url}"
    )
    await send_ntfy_notification(title, summary)
    await send_brevo_email(emails, title, email_body)