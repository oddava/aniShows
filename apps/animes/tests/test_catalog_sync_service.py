from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from ..models import Anime
from ..services.catalog_sync import CatalogSyncService


class CatalogSyncServiceTests(TestCase):
    def setUp(self):
        self.enrich_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.watch_sync_patcher = patch("apps.animes.signals.sync_watch_episodes_for_anime.apply_async")
        self.enrich_patcher.start()
        self.watch_sync_patcher.start()
        self.addCleanup(self.enrich_patcher.stop)
        self.addCleanup(self.watch_sync_patcher.stop)
        self.service = CatalogSyncService()

    def _anime(self, title: str, **overrides) -> Anime:
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-"),
            "synopsis": "Placeholder",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.finished,
            "member_count": 1000,
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)

    def test_refresh_trending_ranks_updates_local_order(self):
        first = self._anime(
            "Airing Favorite",
            status=Anime.AnimeStatus.airing,
            popularity_rank=5,
            site_rank=20,
            rating=8.4,
            member_count=250000,
        )
        second = self._anime(
            "Finished Favorite",
            popularity_rank=1,
            site_rank=10,
            rating=9.1,
            member_count=400000,
        )
        excluded = self._anime("Stale Trend", trending_rank=99, member_count=500)

        updated = self.service.refresh_trending_ranks([first.id, second.id])

        first.refresh_from_db()
        second.refresh_from_db()
        excluded.refresh_from_db()

        self.assertEqual(updated, 2)
        self.assertEqual(first.trending_rank, 1)
        self.assertEqual(second.trending_rank, 2)
        self.assertIsNone(excluded.trending_rank)

    def test_seasonal_slice_uses_existing_season_fields(self):
        first = self._anime("Spring Headliner", season="SPRING", season_year=2026, popularity_rank=1)
        second = self._anime("Spring Followup", season="SPRING", season_year=2026, popularity_rank=3)
        self._anime("Summer Show", season="SUMMER", season_year=2026, popularity_rank=1)

        anime_ids = self.service.get_seasonal_anime_ids(season="SPRING", year=2026, limit=10)

        self.assertEqual(anime_ids, [first.id, second.id])

    def test_airing_slice_prefers_known_upcoming_air_dates(self):
        now = timezone.now()
        soon = self._anime(
            "Soon",
            status=Anime.AnimeStatus.airing,
            popularity_rank=5,
            next_airing_date=now + timedelta(hours=1),
        )
        later = self._anime(
            "Later",
            status=Anime.AnimeStatus.airing,
            popularity_rank=1,
            next_airing_date=now + timedelta(days=1),
        )
        unknown = self._anime(
            "Unknown",
            status=Anime.AnimeStatus.airing,
            popularity_rank=1,
            next_airing_date=None,
        )

        anime_ids = self.service.get_airing_anime_ids(limit=10)

        self.assertEqual(anime_ids[:3], [soon.id, later.id, unknown.id])
