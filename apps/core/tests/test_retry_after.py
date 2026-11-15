from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from unittest.mock import patch

import httpx
from django.test import SimpleTestCase

from apps.animes.services.anilist import AniListService
from apps.shared.retry import retry_after_seconds


class RetryAfterSecondsTests(SimpleTestCase):
    def test_delta_seconds(self):
        self.assertEqual(retry_after_seconds("7"), 7.0)
        self.assertEqual(retry_after_seconds(" 1.5 "), 1.5)

    def test_http_date(self):
        when = datetime.now(UTC) + timedelta(seconds=30)
        seconds = retry_after_seconds(format_datetime(when, usegmt=True))
        self.assertIsNotNone(seconds)
        self.assertTrue(25 <= seconds <= 31, seconds)

    def test_past_date_and_negative_values_mean_no_wait(self):
        self.assertEqual(retry_after_seconds("Wed, 21 Oct 2015 07:28:00 GMT"), 0.0)
        self.assertEqual(retry_after_seconds("-5"), 0.0)

    def test_unusable_values(self):
        for value in (None, "", "soon", "nan", "inf"):
            with self.subTest(value=value):
                self.assertIsNone(retry_after_seconds(value))


class AniListRetryAfterTests(SimpleTestCase):
    def _service(self, responses):
        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        replies = iter(responses)
        service.client = httpx.Client(transport=httpx.MockTransport(lambda request: next(replies)))
        self.addCleanup(service.close)
        return service

    def test_http_date_retry_after_is_waited_on_not_raised(self):
        limited = httpx.Response(429, headers={"Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT"})
        ok = httpx.Response(200, json={"data": {"Media": {"id": 1}}})
        service = self._service([limited, ok])

        with patch("apps.animes.services.providers.anilist.client.backoff") as backoff:
            data = service._query("query Q { Media { id } }", {}, use_cache=False)

        self.assertEqual(data, {"Media": {"id": 1}})
        backoff.assert_called_once_with(0.0)

    def test_rate_limit_reset_header_is_used_without_retry_after(self):
        reset_at = int(datetime.now(UTC).timestamp()) + 20
        limited = httpx.Response(429, headers={"X-RateLimit-Reset": str(reset_at)})
        ok = httpx.Response(200, json={"data": {"Media": {"id": 2}}})
        service = self._service([limited, ok])

        with patch("apps.animes.services.providers.anilist.client.backoff") as backoff:
            service._query("query Q { Media { id } }", {}, use_cache=False)

        waited = backoff.call_args.args[0]
        self.assertTrue(15 <= waited <= 21, waited)
