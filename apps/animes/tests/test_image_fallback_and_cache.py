from datetime import date
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase

from apps.animes.models import Anime
from apps.animes.services.anilist import AniListService


class AniListPrepareAnimeDataTests(SimpleTestCase):
    def test_prepare_anime_data_sets_external_image_urls(self):
        service = object.__new__(AniListService)
        item = {
            "id": 123,
            "idMal": 456,
            "title": {"english": "Test Anime", "romaji": "Test Anime"},
            "coverImage": {
                "large": "https://img.anilist.co/cover-large.jpg",
                "extraLarge": "https://img.anilist.co/cover-xl.jpg",
            },
            "bannerImage": "https://img.anilist.co/banner.jpg",
            "startDate": {"year": 2024, "month": 1, "day": 1},
            "endDate": {"year": 2024, "month": 3, "day": 1},
        }

        data = service._prepare_anime_data(item, "Test Anime", "", "test-anime")

        self.assertEqual(data["cover_image_external_url"], "https://img.anilist.co/cover-xl.jpg")
        self.assertEqual(data["banner_image_external_url"], "https://img.anilist.co/banner.jpg")


class AnimeDetailCacheInvalidationSignalTests(TestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_post_save_invalidates_anime_detail_cache(self, _mock_delay):
        anime = Anime.objects.create(
            title="Cache Test Anime",
            slug="cache-test-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 1, 1),
        )

        cache_key = f"anime_detail_base:{anime.slug}"
        cache.set(cache_key, {"id": anime.id}, timeout=3600)
        self.assertIsNotNone(cache.get(cache_key))

        anime.member_count = 100
        anime.save(update_fields=["member_count"])

        self.assertIsNone(cache.get(cache_key))

    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_post_delete_invalidates_anime_detail_cache(self, _mock_delay):
        anime = Anime.objects.create(
            title="Cache Delete Anime",
            slug="cache-delete-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
        )

        cache_key = f"anime_detail_base:{anime.slug}"
        cache.set(cache_key, {"id": anime.id}, timeout=3600)
        self.assertIsNotNone(cache.get(cache_key))

        anime.delete()

        self.assertIsNone(cache.get(cache_key))
