"""Structured logs, the request id and Sentry scrubbing (root/log_formatting.py, root/request_id.py)."""

import asyncio
import datetime as dt
import io
import json
import logging
from decimal import Decimal
from typing import Any

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from root.log_formatting import (
    MAX_LINE_BYTES,
    JsonFormatter,
    RequestIdFilter,
    redact_url,
    scrub_sentry_breadcrumb,
    scrub_sentry_event,
)
from root.request_id import (
    RESPONSE_HEADER,
    RequestIdMiddleware,
    get_request_id,
    request_id_from_meta,
)


def _logger_with_stream(name: str):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIdFilter())
    logger = logging.getLogger(name)
    logger.handlers = [handler]
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    return logger, stream


def _lines(stream: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in stream.getvalue().splitlines()]


class JsonFormatterTests(SimpleTestCase):
    def test_envelope_and_extra_keys(self):
        logger, stream = _logger_with_stream("anishows.test.json")
        logger.info("imported %s entries", 3, extra={"user_id": 7, "job": "mal"})
        (line,) = _lines(stream)
        self.assertEqual(line["level"], "INFO")
        self.assertEqual(line["logger"], "anishows.test.json")
        self.assertEqual(line["message"], "imported 3 entries")
        self.assertEqual(line["request_id"], "-")
        self.assertEqual((line["user_id"], line["job"]), (7, "mal"))
        dt.datetime.fromisoformat(line["ts"])  # parses

    def test_non_serialisable_values_never_raise(self):
        logger, stream = _logger_with_stream("anishows.test.values")
        logger.warning(
            "odd values",
            extra={"when": dt.date(2026, 11, 16), "amount": Decimal("1.5"), "obj": object()},
        )
        (line,) = _lines(stream)
        self.assertEqual(line["when"], "2026-11-16")
        self.assertEqual(line["amount"], "1.5")
        self.assertIn("object", line["obj"])

    def test_exceptions_are_one_line_with_exc_info(self):
        logger, stream = _logger_with_stream("anishows.test.exc")
        try:
            raise ValueError("boom\nsecond line")
        except ValueError:
            logger.exception("failed")
        raw = stream.getvalue()
        self.assertEqual(raw.count("\n"), 1, "one JSON object per line")
        (line,) = _lines(stream)
        self.assertIn("ValueError: boom", line["exc_info"])
        self.assertIn("Traceback", line["exc_info"])

    def test_huge_lines_are_truncated_but_valid(self):
        logger, stream = _logger_with_stream("anishows.test.big")
        logger.error("x" * (MAX_LINE_BYTES * 3), extra={"blob": "y" * MAX_LINE_BYTES})
        raw = stream.getvalue().strip()
        self.assertLessEqual(len(raw.encode()), MAX_LINE_BYTES)
        line = json.loads(raw)
        self.assertTrue(line["truncated"])
        self.assertEqual(line["level"], "ERROR")

    def test_extras_never_overwrite_the_envelope(self):
        logger, stream = _logger_with_stream("anishows.test.collide")
        logger.info("hi", extra={"level": "fake", "logger": "x", "ts": 0})
        (line,) = _lines(stream)
        self.assertEqual((line["level"], line["logger"]), ("INFO", "anishows.test.collide"))
        self.assertEqual(
            (line["extra_level"], line["extra_logger"], line["extra_ts"]), ("fake", "x", 0)
        )

    def test_unserialisable_extras_keep_the_line(self):
        logger, stream = _logger_with_stream("anishows.test.keys")
        circular: list = []
        circular.append(circular)
        logger.warning("odd", extra={"mapping": {1: "a", (2, 3): "b"}, "loop": circular})
        (line,) = _lines(stream)
        self.assertEqual(line["message"], "odd")
        self.assertIn("(2, 3)", line["mapping"])
        self.assertIsInstance(line["loop"], str)

    def test_tokens_in_string_extras_are_redacted(self):
        logger, stream = _logger_with_stream("anishows.test.extra-redact")
        logger.info("request", extra={"path": "/verify-email/MQ/tok/", "status": 200})
        (line,) = _lines(stream)
        self.assertEqual(line["path"], "/verify-email/<redacted>")
        self.assertEqual(line["status"], 200)

    def test_tokens_in_logged_urls_are_redacted(self):
        logger, stream = _logger_with_stream("anishows.test.redact")
        logger.info("GET /reset-password/MQ/abc-123/ 200")
        (line,) = _lines(stream)
        self.assertEqual(line["message"], "GET /reset-password/<redacted> 200")


class RequestIdTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_cf_ray_wins_then_x_request_id_then_generated(self):
        self.assertEqual(
            request_id_from_meta({"HTTP_CF_RAY": "8a1b2c3d4e5f-AMS", "HTTP_X_REQUEST_ID": "abc"}),
            "8a1b2c3d4e5f-AMS",
        )
        self.assertEqual(request_id_from_meta({"HTTP_X_REQUEST_ID": "req-42"}), "req-42")
        generated = request_id_from_meta({})
        self.assertRegex(generated, r"^[0-9a-f]{32}$")

    def test_unsafe_header_values_are_replaced(self):
        for value in ("a b", "x\ninjected", "{json}", "z" * 200):
            with self.subTest(value=value):
                self.assertRegex(
                    request_id_from_meta({"HTTP_X_REQUEST_ID": value}), r"^[0-9a-f]{32}$"
                )

    def test_middleware_sets_context_and_echoes_header(self):
        logger, stream = _logger_with_stream("anishows.test.request")
        seen = {}

        def view(request):
            seen["id"] = get_request_id()
            logger.info("inside the request")
            return HttpResponse("ok")

        response = RequestIdMiddleware(view)(self.factory.get("/", HTTP_CF_RAY="ray-1"))
        self.assertEqual(response[RESPONSE_HEADER], "ray-1")
        self.assertEqual(seen["id"], "ray-1")
        self.assertEqual(_lines(stream)[0]["request_id"], "ray-1")
        self.assertIsNone(get_request_id(), "reset after the request")

    def test_two_lines_of_one_request_share_the_id(self):
        logger, stream = _logger_with_stream("anishows.test.share")

        def view(request):
            logger.info("first")
            logger.warning("second", extra={"step": 2})
            return HttpResponse("ok")

        response = RequestIdMiddleware(view)(self.factory.get("/"))
        ids = {line["request_id"] for line in _lines(stream)}
        self.assertEqual(ids, {response[RESPONSE_HEADER]})

    def test_async_middleware(self):
        async def view(request):
            return HttpResponse(get_request_id() or "")

        middleware = RequestIdMiddleware(view)
        response = asyncio.run(middleware(self.factory.get("/", HTTP_X_REQUEST_ID="async-1")))
        self.assertEqual(response.content, b"async-1")
        self.assertEqual(response[RESPONSE_HEADER], "async-1")


class RedactionTests(SimpleTestCase):
    def test_account_link_paths(self):
        cases = {
            "/reset-password/abc/def": "/reset-password/<redacted>",
            "https://anishows.com/verify-email/MQ/tok/": "https://anishows.com/verify-email/<redacted>",
            "/confirm-email-change/MQ/tok/bmV3QGV4LmNvbQ/": "/confirm-email-change/<redacted>",
            "/api/v1/users/verify-email/MQ/tok/?next=/x": "/api/v1/users/verify-email/<redacted>?next=/x",
            "/api/v1/anime/naruto/": "/api/v1/anime/naruto/",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(redact_url(raw), expected)

    def test_secret_query_values(self):
        self.assertEqual(
            redact_url("/oauth/callback?code=abc&state=1&token=t"),
            "/oauth/callback?code=<redacted>&state=1&token=<redacted>",
        )


class SentryScrubTests(SimpleTestCase):
    def test_event_url_headers_and_cookies(self):
        event = {
            "request": {
                "url": "https://anishows.com/reset-password/abc/def",
                "query_string": "token=zzz&page=2",
                "headers": {
                    "Authorization": "Bearer secret",
                    "Cookie": "sessionid=1",
                    "User-Agent": "test",
                },
                "cookies": {"sessionid": "1"},
            },
            "transaction": "/reset-password/abc/def",
        }
        scrubbed = scrub_sentry_event(event)
        self.assertEqual(
            scrubbed["request"]["url"], "https://anishows.com/reset-password/<redacted>"
        )
        self.assertEqual(scrubbed["request"]["query_string"], "token=<redacted>&page=2")
        self.assertEqual(scrubbed["request"]["headers"], {"User-Agent": "test"})
        self.assertNotIn("cookies", scrubbed["request"])
        self.assertEqual(scrubbed["transaction"], "/reset-password/<redacted>")
        self.assertNotIn("secret", json.dumps(scrubbed))

    def test_breadcrumbs(self):
        crumb = {
            "category": "httplib",
            "data": {
                "url": "https://api.example.com/verify-email/a/b",
                "http.query": "key=k",
                "Authorization": "Bearer t",
                "headers": [["Set-Cookie", "x"], ["Accept", "*/*"]],
            },
        }
        scrubbed = scrub_sentry_breadcrumb(crumb)
        self.assertEqual(scrubbed["data"]["url"], "https://api.example.com/verify-email/<redacted>")
        self.assertEqual(scrubbed["data"]["http.query"], "key=<redacted>")
        self.assertNotIn("Authorization", scrubbed["data"])
        self.assertEqual(scrubbed["data"]["headers"], [["Accept", "*/*"]])

    def test_referer_carrying_a_token_is_redacted(self):
        event: dict[str, Any] = {
            "request": {
                "url": "https://anishows.com/api/v1/auth/password-reset-confirm/",
                "headers": {"Referer": "https://anishows.com/reset-password/MQ/tok-123/"},
            }
        }
        scrub_sentry_event(event)
        self.assertEqual(
            event["request"]["headers"]["Referer"], "https://anishows.com/reset-password/<redacted>"
        )
        crumb = {"data": {"headers": [["Referer", "/verify-email/a/b"], ["Accept", "*/*"]]}}
        scrub_sentry_breadcrumb(crumb)
        self.assertEqual(
            crumb["data"]["headers"], [["Referer", "/verify-email/<redacted>"], ["Accept", "*/*"]]
        )

    def test_event_breadcrumbs_are_scrubbed_too(self):
        event = {"breadcrumbs": {"values": [{"message": "GET /reset-password/a/b"}]}}
        scrub_sentry_event(event)
        self.assertEqual(
            event["breadcrumbs"]["values"][0]["message"], "GET /reset-password/<redacted>"
        )
