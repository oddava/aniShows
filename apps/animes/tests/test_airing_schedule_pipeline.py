from datetime import UTC, datetime, time, timedelta
from unittest.mock import AsyncMock, Mock, patch

from asgiref.sync import async_to_sync
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from ..models import Anime
from ..services.jikan import JikanService
from ..services.public_anime_service import AnimeQueryService
from ..tasks.airing import AiringWorkflowTask


class AiringScheduleTestMixin:
    def setUp(self):
        super().setUp()
        self.enrich_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.watch_sync_patcher = patch("apps.animes.signals.sync_watch_episodes_for_anime.apply_async")
        self.enrich_patcher.start()
        self.watch_sync_patcher.start()
        self.addCleanup(self.enrich_patcher.stop)
        self.addCleanup(self.watch_sync_patcher.stop)

    def _anime(self, title: str, **overrides) -> Anime:
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-"),
            "synopsis": "Placeholder",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.airing,
            "member_count": 1000,
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)


class JikanSchedulePersistenceTests(AiringScheduleTestMixin, TestCase):
    def test_update_anime_manual_persists_broadcast_and_next_airing_fields(self):
        anime = self._anime("Broadcast Test", status=Anime.AnimeStatus.unknown)
        next_airing_at = int((timezone.now() + timedelta(days=2)).timestamp())
        item = {
            "title": {"romaji": "Broadcast Test", "english": "", "native": ""},
            "format": "TV",
            "status": "RELEASING",
            "episodes": 12,
            "averageScore": 78,
            "popularity": 5000,
            "duration": 24,
            "startDate": {"year": 2026, "month": 4, "day": 1},
            "endDate": None,
            "description": "Schedule payload",
            "rankings": [],
            "stats": {"statusDistribution": []},
            "externalLinks": [],
            "tags": [],
            "relations": {"edges": []},
            "nextAiringEpisode": {"episode": 3, "airingAt": next_airing_at},
            "broadcast": {"day": "Sunday", "time": "23:30", "timezone": "Asia/Tokyo"},
            "source": "MANGA",
            "season": "SPRING",
            "seasonYear": 2026,
            "coverImage": {},
            "bannerImage": "",
            "id": 999,
            "idMal": 1999,
            "synonyms": [],
            "producers": [],
            "providerIds": {"jikan": 1999},
            "sourceUrls": [],
        }

        service = JikanService(enable_caching=False, enable_rate_limiting=False)

        try:
            updated = async_to_sync(service.update_anime_manual)(anime, item)
        finally:
            async_to_sync(service.close)()

        anime.refresh_from_db()

        self.assertTrue(updated)
        self.assertEqual(anime.status, Anime.AnimeStatus.airing)
        self.assertEqual(anime.broadcast_day, "Sunday")
        self.assertEqual(anime.broadcast_time, time(23, 30))
        self.assertEqual(anime.broadcast_timezone, "Asia/Tokyo")
        self.assertEqual(anime.next_airing_episode, 3)
        self.assertEqual(
            anime.next_airing_date,
            timezone.make_aware(datetime.fromtimestamp(next_airing_at), timezone=UTC),
        )

    def test_partial_catalog_updates_do_not_clobber_existing_schedule_fields(self):
        existing_next_airing = timezone.now() + timedelta(days=3)
        anime = self._anime(
            "Partial Update Test",
            anilist_id=12345,
            mal_id=54321,
            broadcast_day="Thursday",
            broadcast_time=time(22, 0),
            broadcast_timezone="Asia/Tokyo",
            next_airing_episode=7,
            next_airing_date=existing_next_airing,
        )
        partial_item = {
            "id": 12345,
            "idMal": 54321,
            "title": {"romaji": "Partial Update Test", "english": "", "native": ""},
            "format": "TV",
            "status": "RELEASING",
            "episodes": 12,
            "averageScore": 78,
            "popularity": 5000,
            "duration": 24,
            "startDate": {"year": 2026, "month": 4, "day": 1},
            "endDate": None,
            "description": "Partial payload",
            "rankings": [],
            "stats": {"statusDistribution": []},
            "externalLinks": [],
            "tags": [],
            "relations": {"edges": []},
            "source": "MANGA",
            "season": "SPRING",
            "seasonYear": 2026,
            "coverImage": {},
            "bannerImage": "",
            "synonyms": [],
            "producers": [],
            "providerIds": {"jikan": 54321},
            "sourceUrls": [],
        }

        service = JikanService(enable_caching=False, enable_rate_limiting=False)

        try:
            async_to_sync(service._update_anime_async)(
                anime,
                partial_item,
                "Partial Update Test",
                "",
                anime.slug,
            )
        finally:
            async_to_sync(service.close)()

        anime.refresh_from_db()

        self.assertEqual(anime.broadcast_day, "Thursday")
        self.assertEqual(anime.broadcast_time, time(22, 0))
        self.assertEqual(anime.broadcast_timezone, "Asia/Tokyo")
        self.assertEqual(anime.next_airing_episode, 7)
        self.assertEqual(anime.next_airing_date, existing_next_airing)


class AiringWorkflowTaskTests(AiringScheduleTestMixin, TestCase):
    def test_sync_airing_uses_lightweight_airing_resolver_for_mal_backed_rows(self):
        anime = self._anime("MAL Backed", mal_id=5114, anilist_id=None)
        task = AiringWorkflowTask()
        service = AsyncMock()
        service.resolve_airing_media_for_anime.return_value = {
            "nextAiringEpisode": {"episode": 2, "airingAt": int((timezone.now() + timedelta(days=1)).timestamp())}
        }
        service.update_anime_manual.return_value = True
        service.last_error_code = ""
        call_cache = Mock()
        call_cache.is_recently_updated.return_value = False

        result = async_to_sync(task._sync_airing)(service, call_cache, None)

        service.resolve_airing_media_for_anime.assert_awaited_once_with(anime)
        service.update_anime_manual.assert_awaited_once_with(anime, service.resolve_airing_media_for_anime.return_value)
        call_cache.mark_updated.assert_called_once_with(anime.mal_id)
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["errors"], 0)


class ScheduleEndpointTests(AiringScheduleTestMixin, APITestCase):
    def test_schedule_endpoint_groups_currently_airing_anime_by_broadcast_day(self):
        monday = self._anime(
            "Monday Show",
            broadcast_day="Monday",
            broadcast_time=time(10, 0),
            broadcast_timezone="Asia/Tokyo",
            next_airing_date=timezone.now() + timedelta(hours=8),
            next_airing_episode=4,
        )
        self._anime(
            "Tuesday Show",
            broadcast_day="Tuesday",
            broadcast_time=time(11, 0),
            broadcast_timezone="Asia/Tokyo",
            next_airing_date=timezone.now() + timedelta(days=1),
            next_airing_episode=7,
        )
        self._anime(
            "Finished Show",
            status=Anime.AnimeStatus.finished,
            broadcast_day="Monday",
            next_airing_date=timezone.now() + timedelta(days=2),
        )

        response = self.client.get("/api/v1/anime/schedule/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["counts"]["monday"], 1)
        self.assertEqual(response.data["counts"]["tuesday"], 1)
        self.assertEqual(response.data["total"], 2)
        self.assertEqual(response.data["days"]["monday"][0]["title"], monday.title)
        self.assertEqual(response.data["days"]["monday"][0]["broadcast_day"], "Monday")
        self.assertEqual(response.data["days"]["monday"][0]["broadcast_timezone"], "Asia/Tokyo")

    def test_schedule_endpoint_rejects_invalid_day_filters(self):
        response = self.client.get("/api/v1/anime/schedule/?day=invalid")

        self.assertEqual(response.status_code, 400)

    def test_resolve_schedule_day_uses_broadcast_timezone_for_next_airing_fallback(self):
        anime = self._anime(
            "Timezone Fallback",
            broadcast_day="",
            broadcast_timezone="Asia/Tokyo",
            next_airing_date=datetime(2026, 4, 11, 15, 30, tzinfo=UTC),
        )

        self.assertEqual(AnimeQueryService.resolve_schedule_day(anime), "Sunday")
