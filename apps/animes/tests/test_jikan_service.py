import asyncio
from unittest.mock import AsyncMock, patch

import httpx
from django.test import SimpleTestCase, TestCase

from apps.animes.models import Anime
from apps.animes.services.jikan import (
    JikanRateLimiter,
    JikanService,
    fetch_themes_from_jikan,
)


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


class JikanServiceNormalizationTests(TestCase):
    def setUp(self):
        self.enrich_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.enrich_patcher.start()
        self.addCleanup(self.enrich_patcher.stop)

    def _build_service(self, handler) -> JikanService:
        service = JikanService(enable_caching=False, enable_rate_limiting=False)
        asyncio.run(service.client.aclose())
        service.base_url = "http://test/v4"
        service.client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=15.0)
        self.addCleanup(lambda: asyncio.run(service.close()))
        return service

    def test_get_anime_by_id_normalizes_full_detail_payload(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            query = dict(request.url.params)

            if path == "/v4/anime/1/full":
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "data": {
                            "mal_id": 1,
                            "url": "https://myanimelist.net/anime/1/Test_Anime",
                            "images": {
                                "jpg": {"large_image_url": "https://cdn.test/anime-1.jpg"},
                                "webp": {"large_image_url": "https://cdn.test/anime-1.webp"},
                            },
                            "trailer": {"youtube_id": "abc123"},
                            "titles": [{"type": "Default", "title": "Test Anime"}],
                            "title": "Test Anime",
                            "title_english": "Test Anime",
                            "title_japanese": "テストアニメ",
                            "title_synonyms": ["TA"],
                            "type": "TV",
                            "source": "Manga",
                            "episodes": 12,
                            "status": "Finished Airing",
                            "score": 8.7,
                            "members": 54321,
                            "duration": "24 min per ep",
                            "synopsis": "Detailed synopsis",
                            "season": "spring",
                            "year": 2024,
                            "aired": {
                                "prop": {
                                    "from": {"year": 2024, "month": 4, "day": 7},
                                    "to": {"year": 2024, "month": 6, "day": 23},
                                }
                            },
                            "genres": [{"name": "Action"}],
                            "themes": [{"name": "School"}],
                            "demographics": [{"name": "Shounen"}],
                            "studios": [{"name": "Bones"}],
                            "producers": [{"name": "Aniplex"}],
                            "relations": [
                                {
                                    "relation": "Sequel",
                                    "entry": [{"mal_id": 2, "type": "anime", "name": "Test Anime 2"}],
                                }
                            ],
                            "external": [{"name": "Official Site", "url": "https://example.com"}],
                            "streaming": [{"name": "Crunchyroll", "url": "https://crunchyroll.com/test"}],
                        }
                    },
                )

            if path == "/v4/anime/1/characters":
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "data": [
                            {
                                "role": "Main",
                                "character": {
                                    "mal_id": 101,
                                    "name": "Hero",
                                    "name_kanji": "ヒーロー",
                                    "about": "Lead character",
                                    "images": {"jpg": {"image_url": "https://cdn.test/hero.jpg"}},
                                },
                                "voice_actors": [
                                    {
                                        "language": "Japanese",
                                        "person": {
                                            "mal_id": 201,
                                            "name": "Actor",
                                            "images": {"jpg": {"image_url": "https://cdn.test/actor.jpg"}},
                                        },
                                    }
                                ],
                            }
                        ]
                    },
                )

            if path == "/v4/anime/1/staff":
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "data": [
                            {
                                "positions": ["Director"],
                                "person": {
                                    "mal_id": 301,
                                    "name": "Director Name",
                                    "images": {"jpg": {"image_url": "https://cdn.test/director.jpg"}},
                                },
                            }
                        ]
                    },
                )

            if path == "/v4/anime/1/themes":
                return httpx.Response(
                    200,
                    request=request,
                    json={"data": {"openings": ["OP 1"], "endings": ["ED 1"]}},
                )

            if path == "/v4/anime/1/statistics":
                return httpx.Response(
                    200,
                    request=request,
                    json={"data": {"watching": 10, "completed": 20, "on_hold": 3, "dropped": 2, "plan_to_watch": 15}},
                )

            if path == "/v4/anime/1":
                return httpx.Response(
                    200,
                    request=request,
                    json={"data": {"mal_id": 1, "status": "Finished Airing"}},
                )

            if path == "/v4/anime/1/episodes" and query.get("page") == "1":
                return httpx.Response(
                    200,
                    request=request,
                    json={"data": [], "pagination": {"last_visible_page": 1, "has_next_page": False}},
                )

            raise AssertionError(f"Unhandled request: {request.url}")

        service = self._build_service(handler)
        payload = asyncio.run(service.get_anime_by_id(JikanService.ANIME_ID_OFFSET + 1))

        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["id"], JikanService.ANIME_ID_OFFSET + 1)
        self.assertEqual(payload["idMal"], 1)
        self.assertEqual(payload["title"]["english"], "Test Anime")
        self.assertEqual(payload["format"], "TV")
        self.assertEqual(payload["status"], "FINISHED")
        self.assertEqual(payload["averageScore"], 87)
        self.assertEqual(payload["coverImage"]["large"], "https://cdn.test/anime-1.webp")
        self.assertEqual(payload["genres"], ["Action"])
        self.assertEqual(payload["tags"], ["school", "shounen"])
        self.assertEqual(payload["producers"], ["Aniplex"])
        self.assertEqual(payload["relations"]["edges"][0]["node"]["id"], JikanService.ANIME_ID_OFFSET + 2)
        self.assertEqual(payload["characterPreview"]["edges"][0]["node"]["id"], JikanService.CHARACTER_ID_OFFSET + 101)
        self.assertEqual(payload["staffPreview"]["edges"][0]["node"]["id"], JikanService.STAFF_ID_OFFSET + 301)
        self.assertEqual(payload["openings"], ["OP 1"])
        self.assertEqual(payload["stats"]["statusDistribution"][0]["status"], "CURRENT")

    def test_get_anime_by_id_preserves_legacy_sync_identifier_for_existing_rows(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            if path == "/v4/anime/1/full":
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "data": {
                            "mal_id": 1,
                            "title": "Legacy",
                            "title_english": "Legacy",
                            "title_japanese": "",
                            "type": "TV",
                            "status": "Finished Airing",
                            "episodes": 1,
                            "score": 7.5,
                            "members": 100,
                            "duration": "24 min per ep",
                            "aired": {"prop": {"from": {"year": 2020, "month": 1, "day": 1}}},
                            "images": {"jpg": {"large_image_url": "https://cdn.test/legacy.jpg"}},
                            "genres": [],
                            "studios": [],
                            "relations": [],
                        }
                    },
                )
            if path in {
                "/v4/anime/1/characters",
                "/v4/anime/1/staff",
                "/v4/anime/1/themes",
                "/v4/anime/1/statistics",
            }:
                return httpx.Response(200, request=request, json={"data": [] if "themes" not in path else {}})
            if path == "/v4/anime/1":
                return httpx.Response(
                    200,
                    request=request,
                    json={"data": {"mal_id": 1, "status": "Finished Airing"}},
                )
            if path == "/v4/anime/1/episodes":
                return httpx.Response(
                    200,
                    request=request,
                    json={"data": [], "pagination": {"last_visible_page": 1, "has_next_page": False}},
                )
            raise AssertionError(f"Unhandled request: {request.url}")

        service = self._build_service(handler)
        with patch.object(
            service,
            "_resolve_mal_id_for_service_id",
            new=AsyncMock(return_value=(1, True)),
        ):
            payload = asyncio.run(service.get_anime_by_id(111))

        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["id"], 111)
        self.assertEqual(payload["idMal"], 1)

    def test_get_recent_updates_prefers_current_season_and_falls_back_to_top_airing(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            query = dict(request.url.params)
            if path == "/v4/seasons/now":
                page = int(query["page"])
                if page != 1:
                    raise AssertionError(f"Unexpected seasons page: {page}")
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "data": [
                            {
                                "mal_id": 20,
                                "title": "Finished Season Show",
                                "title_english": "Finished Season Show",
                                "title_japanese": "",
                                "type": "TV",
                                "status": "Finished Airing",
                                "episodes": 12,
                                "score": 8.1,
                                "members": 1800,
                                "popularity": 20,
                                "rank": 30,
                                "duration": "24 min per ep",
                                "aired": {"prop": {"from": {"year": 2024, "month": 4, "day": 1}}},
                                "images": {"jpg": {"large_image_url": "https://cdn.test/20.jpg"}},
                                "genres": [],
                                "studios": [],
                                "relations": [],
                            }
                        ],
                        "pagination": {"has_next_page": False},
                    },
                )

            if path == "/v4/top/anime":
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "data": [
                            {
                                "mal_id": 10,
                                "title": "Airing Fallback Show",
                                "title_english": "Airing Fallback Show",
                                "title_japanese": "",
                                "type": "TV",
                                "status": "Currently Airing",
                                "episodes": 12,
                                "score": 8.7,
                                "members": 2500,
                                "popularity": 10,
                                "rank": 15,
                                "duration": "24 min per ep",
                                "aired": {"prop": {"from": {"year": 2024, "month": 4, "day": 2}}},
                                "images": {"jpg": {"large_image_url": "https://cdn.test/10.jpg"}},
                                "genres": [],
                                "studios": [],
                                "relations": [],
                            }
                        ],
                        "pagination": {"has_next_page": False},
                    },
                )

            raise AssertionError(f"Unexpected path: {path}")

        service = self._build_service(handler)
        payload = asyncio.run(service.get_recent_updates(limit=30))

        self.assertEqual(len(payload), 2)
        self.assertEqual(payload[0]["idMal"], 10)
        self.assertEqual(payload[1]["idMal"], 20)
