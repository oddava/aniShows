from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIRequestFactory, APITestCase

from apps.animes.models import Anime
from apps.animes.serializers_mixins import ImageUrlMixin
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

    def test_prepare_anime_data_skips_null_rankings_and_status_distribution_entries(self):
        service = object.__new__(AniListService)
        item = {
            "id": 123,
            "idMal": 456,
            "title": {"english": "Null Safe Anime", "romaji": "Null Safe Anime"},
            "rankings": [
                None,
                {"rank": 10, "type": "RATED", "allTime": True},
                {"rank": 20, "type": "POPULAR", "allTime": True},
            ],
            "stats": {
                "statusDistribution": [
                    None,
                    {"status": "CURRENT", "amount": 12},
                    {"status": "COMPLETED", "amount": 34},
                ]
            },
            "coverImage": None,
            "bannerImage": None,
            "startDate": {"year": 2024, "month": 1, "day": 1},
            "endDate": {"year": 2024, "month": 3, "day": 1},
        }

        data = service._prepare_anime_data(item, "Null Safe Anime", "", "null-safe-anime")

        self.assertEqual(data["site_rank"], 10)
        self.assertEqual(data["popularity_rank"], 20)
        self.assertEqual(
            data["status_distribution"],
            {"CURRENT": 12, "COMPLETED": 34},
        )

    def test_prepare_anime_data_normalizes_myanimelist_image_hosts(self):
        service = object.__new__(AniListService)
        item = {
            "id": 321,
            "idMal": 654,
            "title": {"english": "MAL Hosted Anime", "romaji": "MAL Hosted Anime"},
            "coverImage": {
                "large": "https://myanimelist.net/images/anime/5/12345.jpg",
            },
            "bannerImage": "https://www.myanimelist.net/images/anime/9/99999.webp",
        }

        data = service._prepare_anime_data(item, "MAL Hosted Anime", "", "mal-hosted-anime")

        self.assertEqual(
            data["cover_image_external_url"],
            "https://cdn.myanimelist.net/images/anime/5/12345.jpg",
        )
        self.assertEqual(
            data["banner_image_external_url"],
            "https://cdn.myanimelist.net/images/anime/9/99999.webp",
        )


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


class AnimeDetailCacheSelfHealTests(APITestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_retrieve_refreshes_stale_cached_payload_without_cover(self, _mock_delay):
        anime = Anime.objects.create(
            title="Cached No Cover Anime",
            slug="cached-no-cover-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
            cover_image_external_url="https://img.anilist.co/cover-stale-fix.jpg",
            banner_image_external_url="https://img.anilist.co/banner-stale-fix.jpg",
        )

        cache_key = f"anime_detail_base:{anime.slug}"
        cache.set(
            cache_key,
            {
                "id": anime.id,
                "slug": anime.slug,
                "cover_image": None,
                "cover_image_small": None,
                "cover_image_medium": None,
                "cover_image_large": None,
                "banner_image": None,
                "banner_image_small": None,
                "banner_image_medium": None,
                "banner_image_large": None,
            },
            timeout=3600,
        )

        response = self.client.get(reverse("anime-detail", args=[anime.slug]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data.get("cover_image_large"),
            "https://img.anilist.co/cover-stale-fix.jpg",
        )
        self.assertEqual(
            response.data.get("banner_image_large"),
            "https://img.anilist.co/banner-stale-fix.jpg",
        )

        refreshed_cached = cache.get(cache_key)
        self.assertEqual(
            refreshed_cached.get("cover_image_large"),
            "https://img.anilist.co/cover-stale-fix.jpg",
        )

    @override_settings(ALLOWED_HOSTS=["testserver", "localhost", "ani.example"])
    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_retrieve_refreshes_cached_payload_with_internal_media_host(self, _mock_delay):
        anime = Anime.objects.create(
            title="Cached Internal Host Anime",
            slug="cached-internal-host-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
            cover_image_external_url="https://img.anilist.co/cover-internal-host-fix.jpg",
            banner_image_external_url="https://img.anilist.co/banner-internal-host-fix.jpg",
        )

        cache_key = f"anime_detail_base:{anime.slug}"
        cache.set(
            cache_key,
            {
                "id": anime.id,
                "slug": anime.slug,
                "cover_image": "http://localhost/media/anime/covers/stale.jpg",
                "cover_image_small": "http://localhost/media/CACHE/images/stale-small.webp",
                "cover_image_medium": "http://localhost/media/CACHE/images/stale-medium.webp",
                "cover_image_large": "http://localhost/media/CACHE/images/stale-large.webp",
                "banner_image": "http://localhost/media/anime/banners/stale.jpg",
                "banner_image_small": "http://localhost/media/CACHE/images/stale-banner-small.webp",
                "banner_image_medium": "http://localhost/media/CACHE/images/stale-banner-medium.webp",
                "banner_image_large": "http://localhost/media/CACHE/images/stale-banner-large.webp",
            },
            timeout=3600,
        )

        response = self.client.get(
            reverse("anime-detail", args=[anime.slug]),
            HTTP_HOST="ani.example",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data.get("cover_image"),
            "https://img.anilist.co/cover-internal-host-fix.jpg",
        )
        self.assertEqual(
            response.data.get("banner_image"),
            "https://img.anilist.co/banner-internal-host-fix.jpg",
        )

        refreshed_cached = cache.get(cache_key)
        self.assertEqual(
            refreshed_cached.get("cover_image"),
            "https://img.anilist.co/cover-internal-host-fix.jpg",
        )

    @override_settings(
        ALLOWED_HOSTS=["testserver", "localhost", "ani.example"],
        IMAGEKIT_CACHEFILE_DIR="CACHE/images-v2",
        IMAGEKIT_LEGACY_CACHEFILE_DIRS=("CACHE/images",),
    )
    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_retrieve_refreshes_cached_payload_with_legacy_thumbnail_prefix(self, _mock_delay):
        anime = Anime.objects.create(
            title="Cached Legacy Prefix Anime",
            slug="cached-legacy-prefix-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
            cover_image_external_url="https://img.anilist.co/cover-legacy-prefix-fix.jpg",
            banner_image_external_url="https://img.anilist.co/banner-legacy-prefix-fix.jpg",
        )

        cache_key = f"anime_detail_base:{anime.slug}"
        cache.set(
            cache_key,
            {
                "id": anime.id,
                "slug": anime.slug,
                "cover_image": "/media/CACHE/images/anime/covers/stale.jpg",
                "cover_image_small": "/media/CACHE/images/anime/covers/stale-small.webp",
                "cover_image_medium": "/media/CACHE/images/anime/covers/stale-medium.webp",
                "cover_image_large": "/media/CACHE/images/anime/covers/stale-large.webp",
                "banner_image": "/media/CACHE/images/anime/banners/stale.jpg",
                "banner_image_small": "/media/CACHE/images/anime/banners/stale-banner-small.webp",
                "banner_image_medium": "/media/CACHE/images/anime/banners/stale-banner-medium.webp",
                "banner_image_large": "/media/CACHE/images/anime/banners/stale-banner-large.webp",
            },
            timeout=3600,
        )

        response = self.client.get(
            reverse("anime-detail", args=[anime.slug]),
            HTTP_HOST="ani.example",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data.get("cover_image"),
            "https://img.anilist.co/cover-legacy-prefix-fix.jpg",
        )
        self.assertEqual(
            response.data.get("banner_image"),
            "https://img.anilist.co/banner-legacy-prefix-fix.jpg",
        )

        refreshed_cached = cache.get(cache_key)
        self.assertEqual(
            refreshed_cached.get("cover_image"),
            "https://img.anilist.co/cover-legacy-prefix-fix.jpg",
        )


class DummyImageSerializer(ImageUrlMixin):
    def __init__(self, request=None):
        self.context = {"request": request} if request is not None else {}


@override_settings(ALLOWED_HOSTS=["testserver", "localhost", "ani.example"])
class ImageUrlMixinFallbackTests(SimpleTestCase):
    def setUp(self):
        self.request = APIRequestFactory().get("/", HTTP_HOST="ani.example")
        self.serializer = DummyImageSerializer(request=self.request)

    def test_build_url_rewrites_localhost_media_to_relative_path(self):
        field = SimpleNamespace(url="http://localhost/media/anime/covers/test.jpg")

        resolved = self.serializer._build_url(field)

        self.assertEqual(resolved, "/media/anime/covers/test.jpg")

    def test_thumbnail_empty_url_falls_back_to_original_image(self):
        obj = SimpleNamespace(
            thumb=SimpleNamespace(url=""),
            original=SimpleNamespace(url="http://localhost/media/anime/covers/test.jpg"),
            fallback="https://img.anilist.co/fallback.jpg",
        )

        with patch.object(self.serializer, "_ensure_thumbnail", return_value=""):
            resolved = self.serializer.get_image_url_with_thumbnail(
                obj,
                "thumb",
                "original",
                "fallback",
            )

        self.assertEqual(resolved, "/media/anime/covers/test.jpg")

    def test_thumbnail_resolution_does_not_generate_during_request_by_default(self):
        thumbnail_field = Mock(spec=[])
        thumbnail_field.url = "/media/CACHE/images/anime/covers/test.webp"

        resolved = self.serializer._ensure_thumbnail(thumbnail_field)

        self.assertEqual(resolved, "/media/CACHE/images/anime/covers/test.webp")


class AnimeListImageFieldFallbackTests(APITestCase):
    def setUp(self):
        cache.clear()

    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_list_uses_external_cover_and_banner_when_local_images_missing(self, _mock_delay):
        anime = Anime.objects.create(
            title="External Image Fallback Anime",
            slug="external-image-fallback-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
            cover_image_external_url="https://img.anilist.co/external-cover.jpg",
            banner_image_external_url="https://img.anilist.co/external-banner.jpg",
        )

        response = self.client.get(reverse("anime-list"), {"sort": "title"})
        self.assertEqual(response.status_code, 200)
        payload = next(
            item for item in response.data["results"] if item["id"] == anime.id
        )
        self.assertEqual(payload["id"], anime.id)
        self.assertEqual(payload["cover_image"], "https://img.anilist.co/external-cover.jpg")
        self.assertEqual(payload["cover_image_small"], "https://img.anilist.co/external-cover.jpg")
        self.assertEqual(payload["banner_image"], "https://img.anilist.co/external-banner.jpg")
        self.assertEqual(payload["banner_image_small"], "https://img.anilist.co/external-banner.jpg")

    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_list_includes_external_image_fields_for_frontend_failover(self, _mock_delay):
        anime = Anime.objects.create(
            title="External Image Field Anime",
            slug="external-image-field-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
            cover_image_external_url="https://img.anilist.co/external-cover-2.jpg",
            banner_image_external_url="https://img.anilist.co/external-banner-2.jpg",
        )

        response = self.client.get(reverse("anime-list"), {"sort": "title"})
        self.assertEqual(response.status_code, 200)

        payload = next(
            item for item in response.data["results"] if item["id"] == anime.id
        )
        self.assertEqual(
            payload["cover_image_external_url"],
            "https://img.anilist.co/external-cover-2.jpg",
        )
        self.assertEqual(
            payload["banner_image_external_url"],
            "https://img.anilist.co/external-banner-2.jpg",
        )

    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_list_response_includes_cache_status_header(self, _mock_delay):
        Anime.objects.create(
            title="Cache Header Anime",
            slug="cache-header-anime",
            synopsis="desc",
            anime_type="TV",
            status="Airing",
            cover_image_external_url="https://img.anilist.co/external-cover-3.jpg",
        )

        first = self.client.get(reverse("anime-list"), {"sort": "title"})
        second = self.client.get(reverse("anime-list"), {"sort": "title"})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first["X-Cache-Status"], "miss")
        self.assertEqual(second["X-Cache-Status"], "hit")
