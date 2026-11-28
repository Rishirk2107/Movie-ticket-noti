import os
from datetime import timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

IST_TZ = timezone(timedelta(hours=5, minutes=30))

CORS_ORIGINS_RAW = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://127.0.0.1:3000",
)
CORS_ORIGINS = [orig.strip() for orig in CORS_ORIGINS_RAW.split(",") if orig.strip()]

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "bms_watcher")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "")
BMS_COOKIE = os.getenv("BMS_COOKIE", "")
BMS_PROXY_URL = os.getenv("BMS_PROXY_URL", "").strip()

BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL", "")
BREVO_SENDER_NAME = os.getenv("BREVO_SENDER_NAME", "BMS Ticket Alerts")

API_BASE_URL = (
    "https://in.bookmyshow.com/api/movies-data/v5/showtimes-by-event/primary-dynamic"
)

SYNOPSIS_API_URL = "https://in.bookmyshow.com/api/movies/v1/synopsis/init/dynamic"
SYNOPSIS_STATIC_API_URL = "https://in.bookmyshow.com/api/movies/v1/synopsis/init/static"

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
    "Origin": "https://in.bookmyshow.com",
    "Referer": "https://in.bookmyshow.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "Windows",
}
if BMS_COOKIE:
    DEFAULT_HEADERS["Cookie"] = BMS_COOKIE
