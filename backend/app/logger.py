from collections import deque
from datetime import datetime, timezone
from typing import Any

# Ring buffer keeping the last 100 log messages in memory
_logs: deque[dict[str, Any]] = deque(maxlen=100)


def add_log(level: str, message: str, meta: dict | None = None) -> None:
    now_str = datetime.now(timezone.utc).strftime("%H:%M:%S")
    entry = {
        "timestamp": now_str,
        "level": level,  # INFO, SUCCESS, WARN, ERROR
        "message": message,
        "meta": meta or {},
    }
    _logs.appendleft(entry)
    # Also log to terminal
    print(f"[{entry['timestamp']} {level}] {message}")


def get_logs(limit: int = 50) -> list[dict[str, Any]]:
    return list(_logs)[:limit]
