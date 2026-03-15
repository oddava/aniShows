import asyncio
from unittest.mock import AsyncMock, patch

import httpx
from django.test import SimpleTestCase

from apps.animes.services.jikan import JikanRateLimiter, fetch_themes_from_jikan


class JikanThemeFetchRetryTests(SimpleTestCase):
    def test_fetch_themes_does_not_retry_on_404(self):
        attempts = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(404, request=request, json={"status": 404})

        transport = httpx.MockTransport(handler)

        async def run_test():
            limiter = JikanRateLimiter(base_delay=0.01)
            async with httpx.AsyncClient(transport=transport) as client:
                return await fetch_themes_from_jikan(
                    client,
                    mal_id=51532,
                    rate_limiter=limiter,
                    max_retries=3,
                )

        result = asyncio.run(run_test())

        self.assertIsNone(result)
        self.assertEqual(attempts, 1)

    def test_fetch_themes_retries_transient_500_then_succeeds(self):
        attempts = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                return httpx.Response(500, request=request, json={"status": 500})
            return httpx.Response(
                200,
                request=request,
                json={"data": {"openings": ["OP 1"], "endings": ["ED 1"]}},
            )

        transport = httpx.MockTransport(handler)

        async def run_test():
            limiter = JikanRateLimiter(base_delay=0.01)
            async with httpx.AsyncClient(transport=transport) as client:
                with patch("apps.animes.services.jikan.asyncio.sleep", new=AsyncMock()) as sleep_mock:
                    themes = await fetch_themes_from_jikan(
                        client,
                        mal_id=1,
                        rate_limiter=limiter,
                        max_retries=3,
                    )
                return themes, sleep_mock.await_count

        result, sleep_calls = asyncio.run(run_test())

        self.assertEqual(result, {"openings": ["OP 1"], "endings": ["ED 1"]})
        self.assertEqual(attempts, 3)
        self.assertEqual(sleep_calls, 2)
