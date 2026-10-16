"""Public payload caches: per-viewer shelves, coverless details, schedule days."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from ...users.models import UserProfile
from ..models import Anime, Genre

User = get_user_model()


class AdultContentShelfTests(APITestCase):
    def setUp(self):
        cache.clear()
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)
        hentai = Genre.objects.create(name="Hentai", slug="hentai")
        self.adult = Anime.objects.create(
            title="Adult Hit", slug="adult-hit", synopsis="x", rating=9.9,
            member_count=900_000, trending_rank=1, status=Anime.AnimeStatus.finished,
        )
        self.adult.genres.add(hentai)
        self.safe = Anime.objects.create(
            title="Safe Hit", slug="safe-hit", synopsis="x", rating=9.0,
            member_count=800_000, trending_rank=2, status=Anime.AnimeStatus.finished,
        )
        self.opted_in = User.objects.create_user(
            username="adult", email="adult@example.com", password="x"
        )
        UserProfile.objects.filter(user=self.opted_in).update(show_adult_content=True)

    def _slugs(self, url_name):
        return [row["slug"] for row in self.client.get(reverse(url_name)).data]

    def test_opted_in_viewer_filling_the_cache_does_not_leak_to_anonymous(self):
        for url_name in ("anime-trending", "anime-top-rated"):
            with self.subTest(url_name=url_name):
                cache.clear()
                self.client.force_authenticate(self.opted_in)
                self.assertIn("adult-hit", self._slugs(url_name))
                self.client.force_authenticate(None)
                slugs = self._slugs(url_name)
                self.assertIn("safe-hit", slugs)
                self.assertNotIn("adult-hit", slugs)


class ScheduleDayTimezoneTests(APITestCase):
    def test_path_like_provider_timezone_falls_back_instead_of_raising(self):
        from django.utils import timezone

        from ..services.public_anime_service import AnimeQueryService

        anime = Anime(
            title="T", slug="t", broadcast_timezone="/x",
            next_airing_date=timezone.now(),
        )
        self.assertIsNotNone(AnimeQueryService.resolve_schedule_day(anime))


class CoverlessDetailCacheTests(APITestCase):
    def setUp(self):
        cache.clear()
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_detail_without_cover_is_still_served_from_cache(self):
        Anime.objects.create(title="No Cover", slug="no-cover", synopsis="x")
        url = reverse("anime-detail", args=["no-cover"])

        first = self.client.get(url)
        second = self.client.get(url)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first["X-Cache-Status"], "miss")
        self.assertEqual(second["X-Cache-Status"], "hit")
