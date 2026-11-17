from django.test import SimpleTestCase

from apps.animes.services.public_anime_service import AnimePublicPayloadService
from apps.shared.media_urls import normalize_media_url


class InternalStorageHostTests(SimpleTestCase):
    """URLs minted against the internal S3 service are rewritten to ``/media/...``."""

    def test_the_rustfs_and_legacy_minio_hosts_become_relative(self):
        for host in ("rustfs:9000", "minio:9000", "localhost:9000", "web"):
            with self.subTest(host=host):
                self.assertEqual(
                    normalize_media_url(f"http://{host}/anishows-media/media/avatars/a.jpg"),
                    "/media/avatars/a.jpg",
                )

    def test_a_public_url_is_unchanged(self):
        url = "https://anishows.com/media/avatars/a.jpg"
        self.assertEqual(normalize_media_url(url), url)

    def test_the_payload_service_flags_the_internal_hosts(self):
        for host in ("rustfs", "minio"):
            with self.subTest(host=host):
                item = {"cover_image": f"http://{host}:9000/anishows-media/media/c.jpg"}
                self.assertTrue(AnimePublicPayloadService.item_has_internal_media_urls(item))
        public = {"cover_image": "https://anishows.com/media/c.jpg"}
        self.assertFalse(AnimePublicPayloadService.item_has_internal_media_urls(public))
