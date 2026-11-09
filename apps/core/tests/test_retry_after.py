from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from unittest.mock import AsyncMock, Mock, patch

import httpx
from asgiref.sync import async_to_sync
from django.test import SimpleTestCase

from apps.animes.services.watch_episodes import AnimeWatchEpisodeService
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


class JikanEpisodePageRetryAfterTests(SimpleTestCase):
    def test_http_date_retry_after_is_waited_on_not_raised(self):
        request = httpx.Request("GET", "https://api.jikan.moe/v4/anime/1/episodes")
        limited = httpx.Response(
            429, headers={"Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT"}, request=request
        )
        ok = httpx.Response(200, json={"data": []}, request=request)
        client = Mock()
        client.get = AsyncMock(side_effect=[limited, ok])
        limiter = Mock(acquire=AsyncMock())

        with patch("apps.animes.services.watch_episodes.asyncio.sleep", new=AsyncMock()) as sleep:
            payload = async_to_sync(AnimeWatchEpisodeService()._get_jikan_page)(
                client, str(request.url), 1, limiter
            )

        self.assertEqual(payload, {"data": []})
        sleep.assert_awaited_once_with(0.0)
        limiter.record_429.assert_called_once_with(cooldown_hint=0.0)
