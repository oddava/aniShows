"""invalidate_anime_detail / invalidate_public_collections (G2 contract stubs)."""

from unittest.mock import patch

from django.test import SimpleTestCase

from ..services.public_anime_service import (
    AnimePublicPayloadService,
    invalidate_anime_detail,
    invalidate_public_collections,
)


class PublicCacheContractTests(SimpleTestCase):
    def test_detail_invalidation_is_what_an_anime_save_does_today(self):
        with patch("apps.animes.signals._invalidate_anime_public_caches") as invalidate:
            invalidate_anime_detail("frieren")
        invalidate.assert_called_once_with("frieren")

    def test_collections_invalidation_bumps_the_namespace(self):
        before = AnimePublicPayloadService.collection_cache_namespace()
        invalidate_public_collections()
        self.assertNotEqual(AnimePublicPayloadService.collection_cache_namespace(), before)
