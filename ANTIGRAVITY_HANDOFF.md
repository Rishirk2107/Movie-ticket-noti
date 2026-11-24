# ANTIGRAVITY Technical Handoff Report: BookMyShow Ticket Watcher

**Project Name:** BookMyShow Movie Ticket Notifier & Watcher  
**Workspace Root:** `c:\Users\rishi\Downloads\Movie-ticket-noti`  
**Generated Date:** November 24, 2026  
**Status:** Fully Implemented, Verified, and Operational  

---

## 1. Repository Tree & File Responsibilities

### Repository Directory Structure
```text
Movie-ticket-noti/
│
├── .gitignore
├── README.md
├── ANTIGRAVITY_HANDOFF.md             <-- Technical handoff report (this document)
│
├── frontend/                          <-- Vite + React SPA Frontend
│   ├── package.json                   <-- React 19, React Router v7, Vite dependencies
│   ├── vite.config.js                 <-- Vite dev server with reverse-proxy to backend (:8000)
│   ├── index.html                     <-- HTML entry point
│   └── src/
│       ├── main.jsx                   <-- React entry point
│       ├── App.jsx                    <-- App shell & React Router route definitions
│       ├── App.css                    <-- Card-and-chip cinema-red design system
│       ├── components/
│       │   ├── Navbar.jsx             <-- Navigation bar with active route pills
│       │   └── EmailChipInput.jsx     <-- Tag/chip email input with paste/Enter/Backspace
│       ├── pages/
│       │   ├── About.jsx              <-- / About & overview with 3-step visual workflow
│       │   ├── Home.jsx               <-- /movies Movie discovery catalog with language filters
│       │   ├── ConfigureWatch.jsx     <-- /configure Language/format picker & watch form
│       │   ├── Watches.jsx            <-- /watches Registered watches dashboard & modal
│       │   └── Logs.jsx               <-- /logs Live log stream with pause/resume & filters
│       ├── services/
│       │   └── api.js                 <-- Centralized API client supporting VITE_API_BASE_URL
│       └── utils/
│           └── dateUtils.js           <-- IST (UTC+5:30) & local date math utilities
│
└── backend/
    ├── .env                           <-- Environment variables (Mongo, Brevo, ntfy, BMS cookie)
    ├── requirements.txt               <-- Python package dependencies
    ├── run.py                         <-- Application entry point (uvicorn launcher)
    │
    └── app/
        ├── __init__.py                <-- Package marker
        ├── config.py                  <-- App settings, API URLs, headers & env vars
        ├── logger.py                  <-- Thread-safe in-memory ring buffer logger
        ├── db.py                      <-- MongoDB connection, schema setup & seen_venues deduplication
        ├── bms_client.py              <-- BMS URL parser, date parsing, synopsis & showtimes client
        ├── notifier.py                <-- ntfy push & Brevo transactional email dispatcher
        ├── poller.py                  <-- Background scheduler, multi-date collector & expiry cleaner
        ├── main.py                    <-- FastAPI web application, API routes & HTML endpoints
        │
        └── templates/
            ├── index.html             <-- Active Watches dashboard & real-time log viewer
            └── create.html            <-- 3-step interactive Movie, Format & Date Watch Creator
```

### Exact File Responsibilities & Key Symbols

| File | Exact Responsibility | Key Functions / Classes / Routes |
| :--- | :--- | :--- |
| **`backend/run.py`** | Application process entry point. Launches Uvicorn ASGI server hosting `app.main:app` on configured `PORT` (default `8000`) with `0.0.0.0` binding. | `__main__` entry calling `uvicorn.run("app.main:app", ...)` |
| **`backend/requirements.txt`** | Frozen Python package dependencies for the runtime environment. | `fastapi`, `uvicorn`, `pymongo`, `curl_cffi`, `httpx`, `python-dotenv`, `pydantic`, `dnspython` |
| **`backend/.env`** | Local environment configuration storing database credentials, notification keys, CORS origins, and optional session cookies. | `MONGO_URI`, `MONGO_DB`, `NTFY_TOPIC`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BMS_COOKIE`, `CORS_ORIGINS`, `PORT` |
| **`backend/app/config.py`** | Loads `.env` via `python-dotenv` and defines global configuration constants, `IST_TZ` timezone (`UTC+5:30`), `CORS_ORIGINS`, BookMyShow API URLs, and browser-impersonation request headers. | `IST_TZ`, `CORS_ORIGINS`, `MONGO_URI`, `MONGO_DB`, `NTFY_TOPIC`, `BMS_COOKIE`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `API_BASE_URL`, `SYNOPSIS_API_URL`, `SYNOPSIS_STATIC_API_URL`, `DEFAULT_HEADERS` |
| **`backend/app/logger.py`** | In-memory thread-safe log collector using a fixed-size `deque(maxlen=100)`. Prints logs to standard output and exposes them via `/logs` for real-time frontend monitoring. | `add_log(level, message, meta)`<br>`get_logs(limit)` |
| **`backend/app/db.py`** | Manages async MongoDB connection using `AsyncMongoClient`. Creates unique compound indexes on `seen_venues` and handles atomic upserts. | `init_db()`<br>`record_venues_and_get_new(seen_col, watch_id, venues, date_code, mark_notified)`<br>`update_watch_available_dates(watches_col, watch_id, new_dates)` |
| **`backend/app/bms_client.py`** | BookMyShow reverse-engineered client. Handles URL parsing, date normalization, release date extraction, dynamic synopsis scraping, date strip discovery, and showtimes querying with auto-snap detection. | `parse_release_date(date_str)`<br>`extract_url_info(raw_url)`<br>`replace_url_date(raw_url, new_date_code)`<br>`build_api_url(raw_url, date_code)`<br>`parse_venues_and_dates(payload)`<br>`_is_bms_autosnapped(payload)`<br>`fetch_synopsis(event_code, session)`<br>`fetch_venues_direct(raw_url, date_code, session, max_retries)` |
| **`backend/app/notifier.py`** | Dispatches push notifications to `ntfy.sh` and transactional HTML/text emails via Brevo REST API v3. Handles both watch registration and new theatre discovery alerts. | `send_ntfy_notification(title, message)`<br>`send_brevo_email(recipients, subject, text_body)`<br>`notify_new_venues(label, url, emails, added, date_code)`<br>`send_watch_registration_email(emails, label, movie_name, city, start_date, end_date, url, initial_theatres_count)` |
| **`backend/app/poller.py`** | Background task running during app lifespan. Resolves dates to poll, enforces 14-day date ranges, handles `-1` day preview dates, polls dates with auto-snap protection, and auto-deletes expired watches. | `get_poll_date_codes(job)`<br>`get_watch_date_codes(job)`<br>`is_watch_expired(job)`<br>`run_single_watch_check(watches_col, seen_col, job)`<br>`poll_loop(watches_col, seen_col)` |
| **`backend/app/main.py`** | FastAPI application setup with lifespan manager (spawns background poller and connects DB). Hosts HTML templates and REST API endpoints for watches, logs, and BMS proxy endpoints. | `lifespan(app)`<br>`WatchCreateRequest` (Pydantic model)<br>`GET /`<br>`GET /create`<br>`GET /health`<br>`GET /api/bms/movies`<br>`GET /api/bms/synopsis`<br>`POST /watches`<br>`GET /watches`<br>`GET /watches/{watch_id}/venues`<br>`DELETE /watches/{watch_id}`<br>`GET /logs` |
| **`backend/app/templates/index.html`** | Single-page UI for viewing active watches, discovered date badges, theatre counts, real-time log streaming box, and viewing seen venues modal. | Search filtering, watch deletion, auto-refresh polling (5s for logs, 15s for watches), venue details modal. |
| **`backend/app/templates/create.html`** | Interactive multi-step watch creation wizard. Browse/search Chennai movies, pick format & language chips, select date ranges with earliest opening date defaulting, preview toggle, interval, and multi-email chips. | Step 1: Movie Picker<br>Step 2: Language & Format Chips<br>Step 3: Watch Configuration & Submit |

---

## 2. Web Pages & Frontend Flows

The frontend is served directly by FastAPI without any NodeJS build step or external UI framework, using vanilla JavaScript, CSS custom properties, and responsive cards.

### Navigation Architecture
* **`GET /` (Active Watches & Live Activity Page):**
  * Displays a summary banner showing active watch count and a **`+ Create Watch`** primary button linking to `/create`.
  * Displays active watch cards with movie name, watch label, format, date range, interval, alert emails, and clickable pills for all `available_dates` discovered in BMS.
  * Provides a search bar filtering watches by movie title or label in real time.
  * Contains a **"Theatres (N)"** button on each card opening an in-page modal listing all discovered venues for that watch grouped by date.
  * Contains a **"Delete"** button calling `DELETE /watches/{watch_id}` with immediate card removal.
  * Contains a live terminal log box polling `GET /logs` every 5 seconds to display real-time background poller and API fetch activity.
* **`GET /create` (Movie & Format Selector Wizard):**
  * Top navigation contains a **`← Active Watches`** button returning to `/`.
  * Divided into three progressive steps:
    1. **Step 1 — Pick a Movie:** Automatically loads current Chennai theatrical movies from `GET /api/bms/movies`. Displays a responsive poster grid with a live search filter. Also provides a manual input option to type an event code (e.g. `ET00491771`). Clicking a movie card automatically focuses and unlocks Step 2.
    2. **Step 2 — Choose Language & Format:** Calls `GET /api/bms/synopsis?eventcode={ec}`. Renders a format chip group (e.g., `English – 2D`, `English – IMAX 2D`, `English – Select all`). Selecting a chip selects the exact `et_codes` (or `*`) and unlocks Step 3.
    3. **Step 3 — Configure Watch:**
       * **Label:** Pre-filled with movie title, customizable by the user.
       * **Dates:** Start date and optional End date.
       * **Preview Toggle:** A switch labeled *"Include day-before preview (releaseDate − 1)"*.
       * **Check Interval:** Number input in minutes (default `10`).
       * **Alert Emails:** Interactive tag input container accepting emails on `Enter` or `,` and allowing one-click deletion with `×` or `Backspace`.
       * **Submit Button:** Submits structured JSON payload to `POST /watches` without requiring raw BookMyShow URLs. Upon success, redirects the user back to `/`.

### Movie Selection, Format Resolution, & No-URL Workflow
Users never need to visit BookMyShow or copy URLs:
1. When `/create` loads, `loadMovies()` fetches movies via `GET /api/bms/movies`.
2. Clicking a movie invokes `selectMovie(eventCode, title)`, which calls `loadSynopsis(eventCode)`.
3. The synopsis response populates `options`:
   * Each format option contains `dimension` (e.g. `2D`, `IMAX 2D`), `event_code` (e.g. `ET00526290` or `*`), and `language` (e.g. `English`).
   * An additional *"Select all"* option is provided for each language to watch all screens simultaneously.
4. When submitted, the frontend posts structured parameters:
   ```json
   {
     "ref_event_code": "ET00491771",
     "et_codes": "ET00526290",
     "language": "english",
     "label": "Dune: Part Three IMAX",
     "start_date": "2026-12-16",
     "end_date": "2026-12-18",
     "interval_minutes": 10,
     "emails": ["user@example.com"],
     "include_preview": false
   }
   ```
5. `backend/app/main.py` builds the internal BMS URL synthetically using `_build_bms_url_from_parts()`.

### Local Date (YYYY-MM-DD) & IST (Asia/Kolkata) Bounds Handling
To eliminate UTC day-shift bugs (where converting dates via `toISOString()` shifts IST midnight back to the previous day):
* **IST Calculation:** `todayIST()` calculates current date using fixed UTC+5:30 offset arithmetic:
  ```javascript
  function todayIST() {
    const now = new Date();
    const ist = new Date(now.getTime() + (5 * 60 + 30) * 60000);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const d = String(ist.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  ```
* **Pure Local Date Math:** `localDate(isoStr)` splits ISO strings `[y, m, d]` directly into `new Date(y, m - 1, d)` rather than parsing timestamps.
* **14-Day Date Range Enforcing:**
  ```javascript
  function addDays(isoStr, n) {
    const dt = localDate(isoStr);
    dt.setDate(dt.getDate() + n);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  ```
  When `startDate` changes, `endDate.min` is locked to `startDate.value` and `endDate.max` is locked to `addDays(startDate.value, 14)`.
* **Earliest Opening Date Defaulting:** When synopsis loads, the frontend checks `data.opening_date_iso || data.release_date_iso`. If BookMyShow has early screenings (such as Dec 16 for a Dec 18 wide release), `startDate` automatically initializes to the early screening date (`2026-12-16`), and an informative banner appears:
  `Opening Date: 2026-12-16 (Early Screenings) · Wide Release: 2026-12-18`.
* **Preview Toggle Logic:** When the user toggles the day-before preview switch, `onPreviewToggleChange()` checks if `releaseDate8` is known and calculates `addDays(releaseDate, -1)`. If earlier than the currently selected start date, it automatically adjusts `startDate` to include the preview date.

---

## 3. Backend API Endpoints & Request/Response Contracts

### Summary Table of Endpoints

| HTTP Method | Path | Purpose | Request Body / Query | Success Status |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | System health & MongoDB ping | None | `200 OK` / `503 Service Unavailable` |
| `GET` | `/` | Active watches & logs dashboard | None | `200 OK` (HTML) |
| `GET` | `/create` | Movie picker & watch wizard | None | `200 OK` (HTML) |
| `GET` | `/api/bms/movies` | Fetch Chennai movies list | None | `200 OK` (JSON) |
| `GET` | `/api/bms/synopsis` | Fetch movie formats & dates | `eventcode` (Query, string, required) | `200 OK` (JSON) |
| `POST` | `/watches` | Create a new ticket watch | `WatchCreateRequest` (JSON) | `201 Created` |
| `GET` | `/watches` | List all active watches | None | `200 OK` (JSON) |
| `GET` | `/watches/{watch_id}/venues` | List seen venues for a watch | `watch_id` (Path, string, required) | `200 OK` (JSON) |
| `DELETE` | `/watches/{watch_id}` | Delete watch & seen venues | `watch_id` (Path, string, required) | `200 OK` (JSON) / `404 Not Found` |
| `GET` | `/logs` | Get recent log ring buffer | `limit` (Query, int, default `50`) | `200 OK` (JSON) |

---

### Detailed Endpoint Contracts

#### 1. `GET /health`
* **Response `200 OK`:**
  ```json
  {
    "status": "ok",
    "db": "connected",
    "active_watches": 2
  }
  ```
* **Response `503 Service Unavailable`:**
  ```json
  {
    "status": "error",
    "db": "disconnected",
    "detail": "connection timeout"
  }
  ```

#### 2. `GET /api/bms/movies`
* **Query Parameters:** None.
* **Response `200 OK`:**
  ```json
  {
    "movies": [
      {
        "event_code": "ET00491771",
        "event_group": "EG00139281",
        "title": "Dune: Part Three",
        "language": "English",
        "genre": "Action, Adventure, Drama, Sci-Fi",
        "cta_url": "/movies/chennai/dune-part-three/ET00491771",
        "poster": "https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/dune-part-three-et00491771.jpg"
      }
    ],
    "count": 1
  }
  ```

#### 3. `GET /api/bms/synopsis`
* **Query Parameters:**
  * `eventcode` (`str`, required): The BMS event code, e.g., `ET00491771`.
* **Response `200 OK`:**
  ```json
  {
    "event_code": "ET00491771",
    "movie_name": "Dune: Part Three",
    "release_date_str": "Dec 18, 2026",
    "release_date_iso": "2026-12-18",
    "release_date_8digit": "20261218",
    "opening_date_str": "Dec 16, 2026",
    "opening_date_iso": "2026-12-16",
    "opening_date_8digit": "20261216",
    "available_dates": ["20261216", "20261217", "20261218", "20261219", "20261220", "20261221", "20261222"],
    "book_button": false,
    "options": [
      {
        "language": "English",
        "dimension": "2D",
        "event_code": "ET00491771",
        "ref_event_code": "ET00491771",
        "label": "English – 2D"
      },
      {
        "language": "English",
        "dimension": "IMAX 2D",
        "event_code": "ET00526290",
        "ref_event_code": "ET00491771",
        "label": "English – IMAX 2D"
      },
      {
        "language": "English",
        "dimension": "Select all",
        "event_code": "*",
        "ref_event_code": "ET00491771",
        "label": "English – Select all"
      }
    ]
  }
  ```

#### 4. `POST /watches`
* **Request JSON Body (`WatchCreateRequest`):**
  * `url` (`HttpUrl`, optional): Legacy BookMyShow buytickets URL.
  * `ref_event_code` (`str`, optional): Event code (e.g. `ET00491771`). Either `url` or `ref_event_code` must be provided.
  * `et_codes` (`str`, optional, default `"*"`): Filter format code or `*` for all.
  * `language` (`str`, optional, default `"english"`): Audio language.
  * `label` (`str`, required): Name for the watch.
  * `interval_minutes` (`int`, optional, default `10`): Minimum `1`.
  * `start_date` (`str`, optional): `YYYY-MM-DD`.
  * `end_date` (`str`, optional): `YYYY-MM-DD` (must be within 14 days of `start_date`).
  * `include_preview` (`bool`, optional, default `false`): Include `releaseDate - 1`.
  * `emails` (`list[str]`, optional, default `[]`): Alert recipients.
* **Validation Rules:**
  * Must supply either `url` or `ref_event_code` (HTTP 400 if missing).
  * `interval_minutes >= 1` (HTTP 400 if less).
  * `end_date >= start_date` (HTTP 400 if inverted).
  * `(end_date - start_date).days <= 14` (HTTP 400 if greater than 14 days).
* **Response `201 Created`:**
  ```json
  {
    "_id": "a1b2c3d4",
    "url": "https://in.bookmyshow.com/api/movies-data/v5/showtimes-by-event/primary-dynamic?etCodes=*&dateCode=20261216&isDesktop=false&regionCode=CHEN&xLocationShared=false&memberId=&lsId=&subCode=&appCode=WEBV2&language=english&refEventCode=ET00491771",
    "label": "Dune: Part Three Chennai",
    "movie_name": "Dune: Part Three",
    "ref_event_code": "ET00491771",
    "et_codes": "*",
    "language": "english",
    "city": "Chennai",
    "interval_minutes": 10,
    "start_date": "2026-12-16",
    "end_date": "2026-12-18",
    "emails": ["user@example.com"],
    "active": true,
    "created_at": "2026-11-24T06:15:00.000000+00:00",
    "last_checked_at": "2026-11-24T06:15:00.000000+00:00",
    "last_error": null,
    "release_date_8digit": "20261218",
    "available_dates": ["20261216", "20261217", "20261218", "20261219", "20261220", "20261221", "20261222"],
    "dates_updated_at": "2026-11-24T06:15:00.000000+00:00",
    "known_venue_count": 4
  }
  ```

#### 5. `GET /watches`
* **Response `200 OK`:** List of watch objects, each enriched with `known_venue_count` computed from `seen_venues`.

#### 6. `GET /watches/{watch_id}/venues`
* **Path Parameters:** `watch_id` (`str`).
* **Response `200 OK`:**
  ```json
  [
    {
      "watch_id": "a1b2c3d4",
      "date_code": "20261216",
      "venue_code": "SPIB",
      "venue_name": "SPI Palazzo IMAX: Chennai",
      "first_seen_at": "2026-11-24T06:15:00.000000+00:00",
      "notified": false
    }
  ]
  ```

#### 7. `DELETE /watches/{watch_id}`
* **Response `200 OK`:** `{"deleted": "a1b2c3d4"}`.
* **Response `404 Not Found`:** `{"detail": "Watch not found."}`.
* Deletes the watch document from `watches` and all matching entries from `seen_venues`.

#### 8. `GET /logs`
* **Query Parameters:** `limit` (`int`, optional, default `50`).
* **Response `200 OK`:**
  ```json
  {
    "logs": [
      {
        "timestamp": "06:15:00",
        "level": "SUCCESS",
        "message": "BMS API responded 200 OK for date 20261216 (4 venues found, 7 dates in strip)",
        "meta": {}
      }
    ]
  }
  ```

---

## 4. BookMyShow API Integrations & Parsing Logic

All outgoing BookMyShow requests use `curl_cffi.requests.AsyncSession` impersonating Chrome (`impersonate="chrome"`, TLS fingerprinting bypassed) with `DEFAULT_HEADERS`:
```python
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "Windows",
}
```

### 1. Movie Discovery Integration
Implemented across 3 fallback tiers in `proxy_movies_chennai()`:
1. **Tier 1 (CDN Response Cache):**  
   `GET https://assets-in.bmscdn.com/discovery-catalog/response-cache/movies-chen-web.json`  
   Fastest static mirror; returns precomputed discovery JSON.
2. **Tier 2 (Discovery API):**  
   `GET https://in.bookmyshow.com/api/explore/v1/discover/movies-chennai`  
   Headers include `x-bms-id: 1` and `Referer: https://in.bookmyshow.com/explore/movies-chennai`.
3. **Tier 3 (Explore HTML SSR Fallback):**  
   `GET https://in.bookmyshow.com/explore/movies-chennai`  
   Extracts `window.__INITIAL_STATE__` script block and parses `exploreApi.queries["...movies-chennai..."].data`.

**JSON Response Paths Parsed (`_extract_movie_cards`):**
* `data.listings[].cards[]`:
  * `analytics.event_code`: Event code (e.g. `ET00491771`). If missing, extracts `ET\d{8}` from `card.ctaUrl`.
  * `analytics.title`: Movie title. If missing, extracts text from `card.text[].components[].text`.
  * `analytics.event_group` or `card.id`: Group identifier.
  * `analytics.language` & `analytics.genre`: Movie language and genres.
  * `card.ctaUrl`: Direct BMS relative link.
  * `card.image.url` or `card.poster.url`: Thumbnail URL.

---

### 2. Synopsis & Language/Format Integration
Implemented across 3 fallback tiers in `proxy_synopsis()` and `fetch_synopsis()`:
1. **Tier 1 (Mobile Synopsis CDN Cache):**  
   `GET https://in.bmscdn.com/moviesmaster/movies-synopsis-dynamic/chen-mob-{event_code_lower}.json`  
   Direct JSON containing exact options payload without anti-bot blocks.
2. **Tier 2 (Dynamic Synopsis API):**  
   `GET https://in.bookmyshow.com/api/movies/v1/synopsis/init/dynamic`  
   Query parameters:
   * `eventcode={ec}`
   * `channel=web`
   * `isdesktop=true`
   * `isRnROnly=false`
   * `regionCode=CHEN`
3. **Tier 3 (Movie Page HTML Scrape Fallback):**  
   `GET https://in.bookmyshow.com/movies/chennai/{ec}`  
   Parses `<script type="application/ld+json">` for `Movie.datePublished` and `<title>`.

**JSON Response Paths Parsed:**
* `meta.event`:
  * `eventName`: String title.
  * `releaseDate`: String (e.g. `"Dec 18, 2026"` or `"20 Nov, 2026"`).
  * `bookButton`: Boolean booking status.
  * `eventDimension`: Comma-delimited fallback dimensions (`"2D, IMAX 2D"`).
  * `eventLanguage`: List of languages.
* `pageCta[].meta.options[]`:
  * `language`: Language name (`"English"`).
  * `formats[]`: Array of objects containing:
    * `dimension`: String (`"2D"`, `"IMAX 2D"`).
    * `eventCode`: Specific format event code (e.g. `ET00526290` for IMAX).
    * `refEventCode`: Parent movie code (`ET00491771`).

---

### 3. Showtimes API (`primary-dynamic`) Integration
Called by `fetch_venues_direct()` during both baseline creation and scheduled polling:
* **URL:** `https://in.bookmyshow.com/api/movies-data/v5/showtimes-by-event/primary-dynamic`
* **Query Parameters:**
  * `etCodes`: Format code or `*` (e.g. `ET00526290` or `*`)
  * `dateCode`: 8-digit date string `YYYYMMDD` (e.g. `20261216`)
  * `isDesktop`: `"false"`
  * `regionCode`: `"CHEN"`
  * `xLocationShared`: `"false"`
  * `memberId`: `""`
  * `lsId`: `""`
  * `subCode`: `""`
  * `appCode`: `"WEBV2"`
  * `language`: Lowercase language (e.g. `"english"`)
  * `refEventCode`: Parent movie event code (e.g. `"ET00491771"`)
* **Headers:** `DEFAULT_HEADERS` with dynamic `Referer`.

**JSON Response Paths Parsed (`parse_venues_and_dates`):**
1. **Date Strip Discovery:**
   * Scans `data.topStickyWidgets[0].data[]`.
   * Primary key: `item["id"]` if 8 digits (`^\d{8}$`).
   * Fallback key: `item.cta.additionalData.dateCode`.
   * Discovered dates are deduplicated while preserving chronological order.
2. **Auto-Snap Detection (`_is_bms_autosnapped`):**
   * If a requested dateCode has no shows, BMS frequently auto-snaps to the nearest active date and displays a toast message.
   * Path 1: `data.additionalData.dateCode` vs requested dateCode.
   * Path 2: `data.toast.title` or `metadata.toast.title` containing `"date has been changed"`.
   * Action: Returns `({}, [])` to ensure false-positive theatres are discarded.
3. **Venues & Theatres Extraction:**
   * Iterates through `data.showtimeWidgets[]` where `widget["type"] == "groupList"`.
   * For each group item in `widget["data"]`, iterates through `item["data"]` supporting both `item["type"] == "venue-card"` and `item["type"] == "venueCard"`.
   * Extracts `venue_code` and `venue_name` from `item.get("additionalData", {})` first (`venueCode`, `venueName`), falling back to top-level keys (`venueCode`, `venueName`, `name`, or `id`).

---

## 5. IST Date Resolution, -1 Day Preview, & MongoDB Schema

### IST (Asia/Kolkata) Date Resolution
* **Shared `IST_TZ` Helper (`app.config`):**
  * `IST_TZ = timezone(timedelta(hours=5, minutes=30))` is defined and shared across the backend, ensuring reliable IST date resolution without OS `tzdata` package dependencies.
* **Release Date Parsing (`parse_release_date`):**
  Parses BMS date formats without locale dependency:
  * `%b %d, %Y` (`Dec 18, 2026`)
  * `%d %b, %Y` (`18 Dec, 2026`)
  * `%B %d, %Y` (`December 18, 2026`)
  * `%d %B, %Y` (`18 December, 2026`)
* **IST Current Date (`datetime.now(IST_TZ).date()`):**
  * Used consistently across `is_watch_expired(job)`, `get_poll_date_codes(job)`, and default synthetic URL date fallbacks in `main.py`.
  * Frontend pairs this with `todayIST()` with matching UTC+5:30 arithmetic.
* **`-1` Day Early Preview:**
  * When `include_preview: true`, `get_poll_date_codes` calculates:
    ```python
    release_dt = datetime.strptime(release_date_8digit, "%Y%m%d").date()
    preview_dt = release_dt - timedelta(days=1)
    preview_code = preview_dt.strftime("%Y%m%d")
    ```
  * Checked against `today`. If `preview_dt >= today`, `preview_code` is injected into the polling list.
* **Watch Expiry Check (`is_watch_expired`):**
  * `end = job.get("end_date") or job.get("start_date")`
  * If `today > end_dt`, the watch has expired and is auto-deleted.

---

### MongoDB Schema & Indexes

Database Name: `bms_watcher` (or value of `MONGO_DB`)

#### Collection: `watches`
Stores watch configuration and dynamic date-discovery state.
```typescript
{
  _id: string,                   // Short UUID (e.g. "a1b2c3d4")
  url: string,                   // Synthetic or raw BookMyShow API URL
  label: string,                 // User-friendly label (e.g. "Dune IMAX")
  movie_name: string,            // Parsed movie title (e.g. "Dune: Part Three")
  ref_event_code: string,        // Parent event code (e.g. "ET00491771")
  et_codes: string,              // Selected format code (e.g. "ET00526290" or "*")
  language: string,              // Audio language (e.g. "english")
  city: string,                  // City name (default "Chennai")
  interval_minutes: number,      // Polling period in minutes (min: 1)
  start_date: string,            // "YYYY-MM-DD"
  end_date: string,              // "YYYY-MM-DD"
  emails: string[],              // Array of notification email addresses
  active: boolean,               // true = polled by background worker
  created_at: string,            // ISO-8601 UTC timestamp
  last_checked_at: string,       // ISO-8601 UTC timestamp
  last_error: string | null,     // Last error message or null
  release_date_8digit: string,   // "YYYYMMDD" or ""
  available_dates: string[],     // Dynamically updated array of 8-digit date codes
  dates_updated_at: string       // ISO-8601 UTC timestamp of last date strip update
}
```

#### Collection: `seen_venues`
Stores historical theatres seen to prevent duplicate notifications.
```typescript
{
  _id: ObjectId,                 // MongoDB ObjectId
  watch_id: string,              // Foreign key referencing watches._id
  date_code: string,             // 8-digit dateCode (e.g. "20261216")
  venue_code: string,            // Unique BMS venue code (e.g. "SPIB")
  venue_name: string,            // Full venue name (e.g. "SPI Palazzo IMAX")
  first_seen_at: string,         // ISO-8601 UTC timestamp
  notified: boolean              // false during initial baseline; true on new alerts
}
```

#### Deduplication & Indexing Rules
1. **Compound Unique Index:**
   ```python
   IndexModel(
       [("watch_id", ASCENDING), ("date_code", ASCENDING), ("venue_code", ASCENDING)],
       unique=True
   )
   ```
   Ensures that the exact same theatre on the exact same screening date cannot be recorded twice for the same watch.
2. **Atomic Upsert Logic (`record_venues_and_get_new`):**
   ```python
   res = await seen_col.update_one(
       {"watch_id": watch_id, "date_code": date_code, "venue_code": code},
       {
           "$setOnInsert": {
               "watch_id": watch_id,
               "date_code": date_code,
               "venue_code": code,
               "venue_name": name,
               "first_seen_at": now_iso,
               "notified": mark_notified,
           }
       },
       upsert=True,
   )
   if res.upserted_id is not None:
       newly_added.append((code, name))
   ```
   Only newly inserted records produce an `upserted_id`. Existing theatres produce an update with no changes, returning an empty list and triggering zero spam notifications.
3. **Dynamic Date Strip Update (`update_watch_available_dates`):**
   ```python
   await watches_col.update_one(
       {"_id": watch_id},
       {
           "$addToSet": {"available_dates": {"$each": new_dates}},
           "$set": {"dates_updated_at": datetime.now(timezone.utc).isoformat()},
       },
   )
   ```
   Uses `$addToSet` with `$each` to merge any new date added to BMS's top sticky widget without duplicate values.

---

## 6. Polling Loop, Notifications, & Edge Cases / Known Limitations

### Polling Loop Architecture (`poll_loop` & `run_single_watch_check`)
* **Lifespan Startup:** Launched via `asyncio.create_task(poll_loop(watches_col, seen_col))` during FastAPI startup. Cleanly cancelled upon shutdown.
* **Interval Scheduling:**
  * Runs an infinite loop with a randomized sleep: `await asyncio.sleep(30 + random.randint(0, 15))`.
  * Evaluates each active watch where `elapsed >= interval_minutes * 60`.
* **Multi-Date Poller (`run_single_watch_check`):**
  1. Computes all polling dates via `get_poll_date_codes(job)`.
  2. Iterates through each date code with a gentle delay (`1.5s` between dates) to avoid BMS rate-limiting.
  3. Calls `fetch_venues_direct` with `max_retries=2` and exponential backoff.
  4. If BMS auto-snapped the date, returns empty and proceeds.
  5. Any discovered dates are merged into `watches.available_dates`.
  6. New venues are recorded in `seen_venues` with `mark_notified=True`.
  7. If new venues exist, fires notification dispatchers.
  8. Updates `last_checked_at` and `last_error` in MongoDB.
* **Auto-Deletion of Expired Watches:**
  * If `is_watch_expired(job)` is true, logs an event, deletes the watch document, and purges all related `seen_venues`.

---

### Notification Dispatchers

#### 1. ntfy Push Notifications (`send_ntfy_notification`)
* **Target:** `https://ntfy.sh/{NTFY_TOPIC}`
* **Method:** HTTP `POST` executed in thread pool (`asyncio.to_thread`).
* **Title:** `New Theatre - {watch_label} ({YYYY-MM-DD})`
* **Message:** Semicolon-delimited list of new theatres, e.g., `SPI Palazzo IMAX: Chennai (SPIB); PVR Grand Galada (PVRG)`.

#### 2. Brevo Transactional Email (`send_brevo_email`)
* **Target:** `https://api.brevo.com/v3/smtp/email`
* **Method:** HTTP `POST` with `api-key` header using `httpx.AsyncClient`.
* **Watch Registration Confirmation (`send_watch_registration_email`):**
  * Sent immediately upon creating a watch with alert emails.
  * Formatted with movie name, city, watch label, target date range, initial open theatre count, and direct BMS showtimes link.
* **New Theatres Alert (`notify_new_venues`):**
  * Subject: `New Theatre - {watch_label} ({date})`
  * Text & HTML body listing each new venue name and venue code, plus showtimes URL.

---

### Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MONGO_URI` | No | `mongodb://localhost:27017` | MongoDB connection string. |
| `MONGO_DB` | No | `bms_watcher` | Database name. |
| `PORT` | No | `8000` | HTTP port for Uvicorn server. |
| `NTFY_TOPIC` | No | `""` | ntfy topic name. If blank, ntfy alerts are skipped. |
| `BREVO_API_KEY` | No | `""` | Brevo API key (v3). |
| `BREVO_SENDER_EMAIL`| No | `""` | Verified sender email address configured in Brevo. |
| `BREVO_SENDER_NAME` | No | `"BMS Ticket Alerts"`| Display name on outgoing alert emails. |
| `BMS_COOKIE` | No | `""` | Optional BookMyShow session cookie appended to headers. |
| `CORS_ORIGINS` | No | `"http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://127.0.0.1:3000"` | Comma-separated allowed CORS origins for external frontends (e.g. Vite + React). |

---

### Edge Cases, Assumptions, & Known Limitations
1. **BMS Date Auto-Snapping:**
   * *Behavior:* When querying a date that has zero shows, BMS's API does not return a 404; it often snaps to an available date and returns HTTP 200 with that date's venues.
   * *Handling:* `_is_bms_autosnapped()` checks `data.additionalData.dateCode` against the requested date and inspects `toast.title` for `"Your date has been changed"`. If detected, the response is discarded to prevent false-positive notifications.
2. **Early Screening vs. Wide Release Date Discrepancies:**
   * *Behavior:* A movie's official `releaseDate` in BMS synopsis is frequently the wide Friday release, even if preview screenings start on Wednesday or Thursday.
   * *Handling:* `proxy_synopsis` probes the showtimes date strip directly and discovers the earliest screening date, setting `opening_date_iso` and pre-filling the frontend date input.
3. **14-Day Date Range Cap:**
   * BookMyShow rarely opens schedules beyond 14 days in advance. Both the frontend date picker and backend date generator enforce a maximum 14-day window (`(end_date - start_date).days <= 14`) to prevent unbounded queries.
4. **Network & Bot Detection Resilience:**
   * The application uses `curl_cffi` impersonating a desktop Chrome browser. If running on a cloud IP address that gets flagged by Akamai or Cloudflare, setting `BMS_COOKIE` in `.env` passes valid session cookies to bypass rate limits.
5. **No `tzdata` System Dependency:**
   * Date calculations rely strictly on ISO strings, date integers, and UTC datetime objects combined with frontend IST offsets, preventing runtime failures on minimal Windows/container environments.
6. **In-Memory Logging Buffer:**
   * The live activity log (`logger.py`) uses an in-memory deque with a maximum capacity of 100 entries. It provides real-time visibility in the web UI without incurring disk I/O overhead. Restarting the server resets this buffer.
