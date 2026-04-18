from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.test import TestCase

from ..models import Anime
from ..tasks.images import (
    _is_storage_endpoint_error,
    _queue_image_fetch,
    fetch_anime_images,
    heal_missing_anime_media,
)


class ImageTaskOutageDetectionTests(TestCase):
    def test_detects_minio_endpoint_error_message(self):
        exc = Exception('Could not connect to the endpoint URL: "http://minio:9000/bucket/path.jpg"')
        self.assertTrue(_is_storage_endpoint_error(exc))

    def test_non_storage_errors_are_not_misclassified(self):
        exc = ValueError("invalid payload from provider")
        self.assertFalse(_is_storage_endpoint_error(exc))


class ImageTaskSelfHealTests(TestCase):
    def setUp(self):
        enrich_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.mock_enrich_delay = enrich_patcher.start()
        self.addCleanup(enrich_patcher.stop)

    def _create_anime(self, **kwargs):
        defaults = {
            "title": "Self Heal Anime",
            "slug": "self-heal-anime",
            "synopsis": "desc",
            "anime_type": "TV",
            "status": "Airing",
            "release_date": date(2024, 1, 1),
        }
        defaults.update(kwargs)
        return Anime.objects.create(**defaults)

    @patch("apps.animes.tasks.images.cache.add", return_value=True)
    @patch("apps.animes.tasks.images.fetch_anime_images.apply_async")
    @patch("apps.animes.tasks.images.JikanService", autospec=True)
    def test_fetch_task_defers_when_storage_is_unreachable(
        self,
        mock_service_cls,
        mock_apply_async,
        _mock_cache_add,
    ):
        anime = self._create_anime(
            title="Storage Retry Anime",
            slug="storage-retry-anime",
            cover_image_external_url="https://img.anilist.co/cover.jpg",
        )

        service = mock_service_cls.return_value
        mock_service_cls.resolve_fetchable_image_url.side_effect = lambda url: url
        service.download_image = AsyncMock(return_value=b"cover-bytes")
        service._save_external_url = AsyncMock()
        service._save_image = AsyncMock(
            side_effect=Exception(
                'Could not connect to the endpoint URL: "http://minio:9000/anishows-media/media/cover.jpg"'
            )
        )
        service.close = AsyncMock()

        result = fetch_anime_images.run(
            anime_id=anime.id,
            cover_url="https://img.anilist.co/cover.jpg",
            banner_url="",
            mal_id=None,
            storage_retry=0,
        )

        self.assertEqual(result["status"], "deferred")
        self.assertEqual(result["reason"], "storage_unavailable")
        self.assertEqual(result["retry_in_seconds"], 300)
        self.assertEqual(result["storage_retry"], 1)
        mock_apply_async.assert_called_once()
        self.assertEqual(mock_apply_async.call_args.kwargs["countdown"], 300)
        self.assertEqual(mock_apply_async.call_args.kwargs["kwargs"]["anime_id"], anime.id)
        service.close.assert_awaited_once()

    @patch("apps.animes.models.Anime.objects.get")
    @patch("apps.animes.tasks.images.JikanService", autospec=True)
    def test_fetch_task_force_replace_redownloads_existing_images(
        self, mock_service_cls, mock_anime_get
    ):
        cover_field = SimpleNamespace(delete=lambda save=False: None)
        banner_field = SimpleNamespace(delete=lambda save=False: None)
        anime = SimpleNamespace(
            id=1234,
            title="Force Replace Anime",
            slug="force-replace-anime",
            cover_image=cover_field,
            banner_image=banner_field,
            cover_image_external_url="https://img.old/cover.jpg",
            banner_image_external_url="https://img.old/banner.jpg",
            save=lambda **kwargs: None,
        )
        mock_anime_get.return_value = anime

        service = mock_service_cls.return_value
        mock_service_cls.resolve_fetchable_image_url.side_effect = lambda url: url
        service.download_image = AsyncMock(return_value=b"image-bytes")
        service._save_external_url = AsyncMock()
        service._save_image = AsyncMock()
        service.close = AsyncMock()

        result = fetch_anime_images.run(
            anime_id=1234,
            cover_url="https://img.new/cover.jpg",
            banner_url="https://img.new/banner.jpg",
            mal_id=None,
            force_replace=True,
        )

        self.assertEqual(result["status"], "success")
        self.assertEqual(service.download_image.await_count, 2)
        self.assertEqual(service._save_image.await_count, 2)
        saved_filenames = [call.args[2] for call in service._save_image.await_args_list]
        self.assertIn("force-replace-anime_cover_", saved_filenames[0])
        self.assertIn("force-replace-anime_banner_", saved_filenames[1])
        service._save_external_url.assert_any_await(
            anime, "cover_image_external_url", "https://img.new/cover.jpg"
        )
        service._save_external_url.assert_any_await(
            anime, "banner_image_external_url", "https://img.new/banner.jpg"
        )
        service.close.assert_awaited_once()

    @patch("apps.animes.tasks.images.cache.add", return_value=True)
    @patch("apps.animes.tasks.images.fetch_anime_images.delay")
    @patch("apps.animes.tasks.images._is_storage_available", return_value=True)
    def test_periodic_self_heal_queues_missing_media(
        self,
        _mock_storage_available,
        mock_fetch_delay,
        _mock_cache_add,
    ):
        anime = self._create_anime(
            title="Missing Media Anime",
            slug="missing-media-anime",
            cover_image_external_url="https://img.anilist.co/cover2.jpg",
            banner_image_external_url="https://img.anilist.co/banner2.jpg",
            mal_id=1234,
        )

        result = heal_missing_anime_media.run(batch_size=10)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["queued"], 1)
        mock_fetch_delay.assert_called_once()
        kwargs = mock_fetch_delay.call_args.kwargs
        self.assertEqual(kwargs["anime_id"], anime.id)
        self.assertEqual(kwargs["cover_url"], "https://img.anilist.co/cover2.jpg")
        self.assertEqual(kwargs["banner_url"], "https://img.anilist.co/banner2.jpg")
        self.assertEqual(kwargs["mal_id"], 1234)

    @patch("apps.animes.tasks.images.cache.add", return_value=True)
    @patch("apps.animes.tasks.images.fetch_anime_images.delay")
    @patch("apps.animes.tasks.images._is_storage_available", return_value=True)
    def test_periodic_self_heal_queues_mal_banner_fallback_when_external_missing(
        self,
        _mock_storage_available,
        mock_fetch_delay,
        _mock_cache_add,
    ):
        anime = self._create_anime(
            title="MAL Banner Fallback Anime",
            slug="mal-banner-fallback-anime",
            cover_image_external_url="",
            banner_image_external_url="",
            mal_id=9876,
        )

        result = heal_missing_anime_media.run(batch_size=10)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["queued"], 1)
        kwargs = mock_fetch_delay.call_args.kwargs
        self.assertEqual(kwargs["anime_id"], anime.id)
        self.assertEqual(kwargs["cover_url"], "")
        self.assertEqual(kwargs["banner_url"], "")
        self.assertEqual(kwargs["mal_id"], 9876)

    @patch("apps.animes.tasks.images.fetch_anime_images.delay")
    @patch("apps.animes.tasks.images._is_storage_available", return_value=False)
    def test_periodic_self_heal_skips_when_storage_is_down(
        self,
        _mock_storage_available,
        mock_fetch_delay,
    ):
        result = heal_missing_anime_media.run(batch_size=10)

        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["reason"], "storage_unavailable")
        mock_fetch_delay.assert_not_called()

    @patch("apps.animes.tasks.images.fetch_anime_images.delay")
    @patch("apps.animes.tasks.images.get_queue_size", return_value=150)
    @patch("apps.animes.tasks.images._is_storage_available", return_value=True)
    def test_periodic_self_heal_skips_when_image_queue_backlog_is_high(
        self,
        _mock_storage_available,
        _mock_get_queue_size,
        mock_fetch_delay,
    ):
        result = heal_missing_anime_media.run(batch_size=10)

        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["reason"], "image_queue_backlog")
        self.assertEqual(result["image_queue_depth"], 150)
        mock_fetch_delay.assert_not_called()


class ImageTaskQueueNormalizationTests(TestCase):
    @patch("apps.animes.tasks.images.cache.add", return_value=True)
    @patch("apps.animes.tasks.images.fetch_anime_images.delay")
    def test_queue_image_fetch_rewrites_myanimelist_image_hosts(
        self,
        mock_fetch_delay,
        _mock_cache_add,
    ):
        queued = _queue_image_fetch(
            anime_id=77,
            cover_url="https://myanimelist.net/images/anime/1/77777.jpg",
            banner_url="https://www.myanimelist.net/images/anime/2/88888.webp",
            mal_id=None,
        )

        self.assertTrue(queued)
        mock_fetch_delay.assert_called_once_with(
            anime_id=77,
            cover_url="https://cdn.myanimelist.net/images/anime/1/77777.jpg",
            banner_url="https://cdn.myanimelist.net/images/anime/2/88888.webp",
            mal_id=None,
            storage_retry=0,
        )

    @patch("apps.animes.tasks.images.cache.add", return_value=True)
    @patch("apps.animes.tasks.images.fetch_anime_images.delay")
    def test_queue_image_fetch_drops_untrusted_urls_without_fallback(
        self,
        mock_fetch_delay,
        _mock_cache_add,
    ):
        queued = _queue_image_fetch(
            anime_id=88,
            cover_url="https://cdn.example.com/cover.jpg",
            banner_url="https://cdn.example.com/banner.jpg",
            mal_id=None,
        )

        self.assertFalse(queued)
        mock_fetch_delay.assert_not_called()
