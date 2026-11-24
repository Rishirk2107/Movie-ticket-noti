import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "bms_watcher")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "")
BMS_COOKIE = os.getenv("BMS_COOKIE", "")

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
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "Windows",
}
if BMS_COOKIE:
    DEFAULT_HEADERS["Cookie"] = BMS_COOKIE
