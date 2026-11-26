# backend/test_alarm_push.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from httpx import ASGITransport

from app.logger import get_logs
from app.main import app
from app.notifier import notify_new_venues, send_expo_alarm_push
from app.poller import run_single_watch_check


class TestExpoPushDispatcher(unittest.IsolatedAsyncioTestCase):
    async def test_send_expo_alarm_push_payload_and_success(self):
        tokens = ["ExponentPushToken[token_123]", "ExpoPushToken[token_456]"]
        title = "New Theatre - Inception"
        body = "New theatre(s) added: PVR Cinemas (PVR)"
        data = {
            "watch_id": "w123",
            "label": "Inception Watch",
            "date_code": "20261225",
            "venues": [{"code": "PVR", "name": "PVR Cinemas"}],
            "showtimes_url": "https://in.bookmyshow.com/movies/chennai/buytickets/ET001/20261225",
        }

        mock_expo_response = {
            "data": [
                {"status": "ok", "id": "ticket-uuid-1"},
                {"status": "ok", "id": "ticket-uuid-2"},
            ]
        }

        captured_request = {}

        def mock_handler(request: httpx.Request):
            captured_request["url"] = str(request.url)
            captured_request["method"] = request.method
            import json
            captured_request["json"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(200, json=mock_expo_response)

        transport = httpx.MockTransport(mock_handler)
        with patch("app.notifier.httpx.AsyncClient", return_value=httpx.AsyncClient(transport=transport)):
            res = await send_expo_alarm_push(tokens, title, body, data)

        self.assertEqual(res, mock_expo_response)
        self.assertEqual(captured_request["url"], "https://exp.host/--/api/v2/push/send")
        self.assertEqual(captured_request["method"], "POST")
        req_json = captured_request["json"]
        self.assertEqual(req_json["priority"], "high")
        self.assertEqual(req_json["channelId"], "ticket-alarm")
        self.assertEqual(req_json["sound"], "alarm.wav")
        self.assertEqual(req_json["ttl"], 300)
        self.assertEqual(req_json["title"], title)
        self.assertEqual(req_json["body"], body)
        self.assertEqual(req_json["to"], tokens)
        self.assertEqual(req_json["data"], data)

        # Verify add_log logged ticket success
        recent_logs = get_logs(10)
        success_logs = [l for l in recent_logs if l["level"] == "SUCCESS" and "ticket-uuid-1" in l["message"]]
        self.assertTrue(len(success_logs) > 0)

    async def test_send_expo_alarm_push_error_logging(self):
        tokens = ["ExponentPushToken[invalid_token]"]
        mock_expo_response = {
            "data": [
                {
                    "status": "error",
                    "message": "DeviceNotRegistered",
                    "details": {"error": "DeviceNotRegistered"},
                }
            ]
        }

        transport = httpx.MockTransport(lambda req: httpx.Response(200, json=mock_expo_response))
        with patch("app.notifier.httpx.AsyncClient", return_value=httpx.AsyncClient(transport=transport)):
            res = await send_expo_alarm_push(tokens, "Title", "Body", {})

        self.assertEqual(res, mock_expo_response)
        recent_logs = get_logs(10)
        error_logs = [l for l in recent_logs if l["level"] == "ERROR" and "DeviceNotRegistered" in l["message"]]
        self.assertTrue(len(error_logs) > 0)

    async def test_send_expo_alarm_push_exception_handling(self):
        transport = httpx.MockTransport(lambda req: (_ for _ in ()).throw(httpx.ConnectTimeout("Connection timed out")))
        with patch("app.notifier.httpx.AsyncClient", return_value=httpx.AsyncClient(transport=transport)):
            res = await send_expo_alarm_push(["ExponentPushToken[abc]"], "T", "B", {})

        self.assertIn("error", res)
        recent_logs = get_logs(10)
        error_logs = [l for l in recent_logs if l["level"] == "ERROR" and "timed out" in l["message"]]
        self.assertTrue(len(error_logs) > 0)


class TestNotifyNewVenues(unittest.IsolatedAsyncioTestCase):
    async def test_notify_runs_push_alongside_email(self):
        job = {
            "_id": "watch_999",
            "label": "Movie Watch",
            "alarm_enabled": True,
            "device_tokens": ["ExponentPushToken[dev1]"],
            "emails": ["user@example.com"],
        }
        added = [("PVR", "PVR Cinemas")]

        mock_email = AsyncMock()
        mock_push = AsyncMock()

        with patch("app.notifier.send_brevo_email", mock_email), \
             patch("app.notifier.send_expo_alarm_push", mock_push), \
             patch("app.notifier.send_ntfy_notification", AsyncMock()):
            await notify_new_venues(
                label=job["label"],
                url="https://in.bookmyshow.com/buytickets/ET001/20261225",
                emails=job["emails"],
                added=added,
                date_code="20261225",
                job=job,
            )

        mock_email.assert_awaited_once()
        mock_push.assert_awaited_once()
        push_call_kwargs = mock_push.await_args.kwargs
        self.assertEqual(push_call_kwargs["tokens"], ["ExponentPushToken[dev1]"])
        self.assertEqual(push_call_kwargs["data"]["watch_id"], "watch_999")
        self.assertEqual(push_call_kwargs["data"]["venues"][0]["code"], "PVR")

    async def test_push_failure_does_not_block_or_fail_email(self):
        job = {
            "_id": "watch_fail",
            "label": "Movie Watch",
            "alarm_enabled": True,
            "device_tokens": ["ExponentPushToken[dev1]"],
            "emails": ["user@example.com"],
        }
        added = [("INOX", "INOX National")]

        mock_email = AsyncMock()
        mock_push = AsyncMock(side_effect=RuntimeError("Push network explosion!"))

        with patch("app.notifier.send_brevo_email", mock_email), \
             patch("app.notifier.send_expo_alarm_push", mock_push), \
             patch("app.notifier.send_ntfy_notification", AsyncMock()):
            # Must not raise exception
            await notify_new_venues(
                label=job["label"],
                url="https://in.bookmyshow.com/buytickets/ET001/20261225",
                emails=job["emails"],
                added=added,
                date_code="20261225",
                job=job,
            )

        # Email must still have been called and succeeded
        mock_email.assert_awaited_once()

    async def test_push_skipped_when_alarm_disabled_or_no_tokens(self):
        job = {
            "_id": "watch_no_alarm",
            "label": "Movie Watch",
            "alarm_enabled": False,
            "device_tokens": ["ExponentPushToken[dev1]"],
            "emails": ["user@example.com"],
        }
        added = [("AGS", "AGS Cinemas")]

        mock_email = AsyncMock()
        mock_push = AsyncMock()

        with patch("app.notifier.send_brevo_email", mock_email), \
             patch("app.notifier.send_expo_alarm_push", mock_push), \
             patch("app.notifier.send_ntfy_notification", AsyncMock()):
            await notify_new_venues(
                label=job["label"],
                url="https://in.bookmyshow.com/buytickets/ET001/20261225",
                emails=job["emails"],
                added=added,
                date_code="20261225",
                job=job,
            )

        mock_email.assert_awaited_once()
        mock_push.assert_not_awaited()


class MockMongoCollection:
    def __init__(self, data=None):
        self.docs = data or {}

    async def find_one(self, query):
        _id = query.get("_id")
        doc = self.docs.get(_id)
        return dict(doc) if doc else None

    def find(self, query):
        async def _generator():
            for doc in self.docs.values():
                yield dict(doc)
        return _generator()

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)
        return MagicMock(inserted_id=doc["_id"])

    async def update_one(self, query, update, upsert=False):
        _id = query.get("_id")
        if _id not in self.docs:
            if upsert:
                self.docs[_id] = {"_id": _id}
            else:
                return MagicMock(matched_count=0, modified_count=0)

        doc = self.docs[_id]
        if "$addToSet" in update:
            for k, v in update["$addToSet"].items():
                cur = doc.setdefault(k, [])
                if v not in cur:
                    cur.append(v)
        if "$pull" in update:
            for k, v in update["$pull"].items():
                cur = doc.get(k, [])
                if v in cur:
                    cur.remove(v)
        if "$set" in update:
            for k, v in update["$set"].items():
                doc[k] = v
        return MagicMock(matched_count=1, modified_count=1)

    async def delete_one(self, query):
        _id = query.get("_id")
        if _id in self.docs:
            del self.docs[_id]
            return MagicMock(deleted_count=1)
        return MagicMock(deleted_count=0)

    async def count_documents(self, query):
        return len(self.docs)


class TestMainEndpoints(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.watches_col = MockMongoCollection()
        self.seen_col = MockMongoCollection()
        app.state.watches_col = self.watches_col
        app.state.seen_col = self.seen_col
        self.client = httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_watch_creation_defaults_alarm_fields(self):
        # Seed an older watch doc missing alarm fields
        self.watches_col.docs["old_watch"] = {
            "_id": "old_watch",
            "label": "Old Watch",
            "active": True,
            "url": "https://in.bookmyshow.com/buytickets/ET001/20261225",
        }

        # GET /watches should gracefully add alarm_enabled: False and device_tokens: []
        res = await self.client.get("/watches")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        old = next(w for w in data if w["_id"] == "old_watch")
        self.assertFalse(old["alarm_enabled"])
        self.assertEqual(old["device_tokens"], [])

    async def test_watch_creation_initializes_alarm_fields(self):
        # Test creating watch initializes alarm_enabled: False and device_tokens: []
        with patch("app.main.fetch_synopsis", AsyncMock(return_value={"release_date_8digit": "", "movie_name": "Test Movie", "available_dates": []})), \
             patch("app.main.fetch_venues_direct", AsyncMock(return_value=({}, []))), \
             patch("app.main.send_watch_registration_email", AsyncMock()):
            res = await self.client.post("/watches", json={
                "ref_event_code": "ET00123456",
                "label": "Test Movie Watch",
                "interval_minutes": 10,
                "emails": ["fan@example.com"],
            })
            self.assertEqual(res.status_code, 201)
            doc = res.json()
            self.assertFalse(doc["alarm_enabled"])
            self.assertEqual(doc["device_tokens"], [])
            stored = self.watches_col.docs[doc["_id"]]
            self.assertFalse(stored["alarm_enabled"])
            self.assertEqual(stored["device_tokens"], [])

    async def test_device_registration_and_validation(self):
        self.watches_col.docs["w1"] = {
            "_id": "w1",
            "label": "Watch 1",
            "active": True,
            "alarm_enabled": False,
            "device_tokens": [],
        }

        # 1. Invalid token prefix -> 400
        res = await self.client.post("/watches/w1/devices", json={"token": "InvalidToken[123]"})
        self.assertEqual(res.status_code, 400)

        # 2. Valid ExponentPushToken -> 200, adds token, enables alarm
        token1 = "ExponentPushToken[token_abc_123]"
        res = await self.client.post("/watches/w1/devices", json={"token": token1})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [token1])

        doc = self.watches_col.docs["w1"]
        self.assertTrue(doc["alarm_enabled"])
        self.assertEqual(doc["device_tokens"], [token1])

        # 3. Valid ExpoPushToken -> 200, adds via $addToSet
        token2 = "ExpoPushToken[token_xyz_456]"
        res = await self.client.post("/watches/w1/devices", json={"token": token2})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [token1, token2])

        # 4. Duplicate token -> does not duplicate
        res = await self.client.post("/watches/w1/devices", json={"token": token1})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [token1, token2])

        # 5. Non-existent watch -> 404
        res = await self.client.post("/watches/non_existent/devices", json={"token": token1})
        self.assertEqual(res.status_code, 404)

    async def test_device_removal(self):
        token1 = "ExponentPushToken[tok1]"
        token2 = "ExponentPushToken[tok2]"
        self.watches_col.docs["w2"] = {
            "_id": "w2",
            "label": "Watch 2",
            "active": True,
            "alarm_enabled": True,
            "device_tokens": [token1, token2],
        }

        # Remove token1 -> token2 remains, alarm_enabled remains True
        res = await self.client.request("DELETE", "/watches/w2/devices", json={"token": token1})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertTrue(data["alarm_enabled"])
        self.assertEqual(data["device_tokens"], [token2])

        doc = self.watches_col.docs["w2"]
        self.assertTrue(doc["alarm_enabled"])
        self.assertEqual(doc["device_tokens"], [token2])

        # Remove token2 -> no tokens remain, alarm_enabled becomes False
        res = await self.client.request("DELETE", "/watches/w2/devices", json={"token": token2})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["alarm_enabled"])
        self.assertEqual(data["device_tokens"], [])

        doc = self.watches_col.docs["w2"]
        self.assertFalse(doc["alarm_enabled"])
        self.assertEqual(doc["device_tokens"], [])

        # Non-existent watch -> 404
        res = await self.client.request("DELETE", "/watches/ghost/devices", json={"token": token1})
        self.assertEqual(res.status_code, 404)

    async def test_test_alarm_endpoint(self):
        # 1. Watch with no devices -> 400
        self.watches_col.docs["w_no_dev"] = {
            "_id": "w_no_dev",
            "label": "Watch No Dev",
            "alarm_enabled": False,
            "device_tokens": [],
        }
        res = await self.client.post("/watches/w_no_dev/test-alarm")
        self.assertEqual(res.status_code, 400)

        # 2. Non-existent watch -> 404
        res = await self.client.post("/watches/fake_watch/test-alarm")
        self.assertEqual(res.status_code, 404)

        # 3. Watch with devices -> triggers send_expo_alarm_push and returns ticket response
        self.watches_col.docs["w_with_dev"] = {
            "_id": "w_with_dev",
            "label": "Doctor Strange",
            "movie_name": "Doctor Strange",
            "url": "https://in.bookmyshow.com/buytickets/ET002/20261225",
            "available_dates": ["20261225"],
            "alarm_enabled": True,
            "device_tokens": ["ExponentPushToken[dev_test_1]"],
        }

        mock_expo_ticket = {"data": [{"status": "ok", "id": "test-ticket-id-99"}]}
        with patch("app.main.send_expo_alarm_push", AsyncMock(return_value=mock_expo_ticket)) as mock_send:
            res = await self.client.post("/watches/w_with_dev/test-alarm")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json(), mock_expo_ticket)

            mock_send.assert_awaited_once()
            call_kwargs = mock_send.await_args.kwargs
            self.assertEqual(call_kwargs["tokens"], ["ExponentPushToken[dev_test_1]"])
            self.assertIn("Doctor Strange", call_kwargs["title"])
            self.assertEqual(call_kwargs["data"]["watch_id"], "w_with_dev")
            self.assertEqual(call_kwargs["data"]["label"], "Doctor Strange")
            self.assertEqual(call_kwargs["data"]["date_code"], "20261225")
            self.assertEqual(call_kwargs["data"]["venues"][0]["code"], "TEST")


if __name__ == "__main__":
    unittest.main()
