"""invalidate_anime_detail / invalidate_public_collections (G2 contract, P0-2)."""

from django.core.cache import cache
from django.test import SimpleTestCase

from ..services.public_anime_service import (
    AnimePublicPayloadService,
    invalidate_anime_detail,
    invalidate_public_collections,
)


class PublicCacheContractTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_detail_invalidation_drops_only_that_detail_payload(self):
        detail_key = AnimePublicPayloadService.detail_cache_key("frieren")
        other_key = AnimePublicPayloadService.detail_cache_key("mushishi")
        cache.set_many({detail_key: {"id": 1}, f"{detail_key}:stale": {"id": 1}, other_key: {}})
        namespace = AnimePublicPayloadService.collection_cache_namespace()

        invalidate_anime_detail("frieren")

        self.assertIsNone(cache.get(detail_key))
        self.assertIsNone(cache.get(f"{detail_key}:stale"))
        self.assertIsNotNone(cache.get(other_key))
        self.assertEqual(AnimePublicPayloadService.collection_cache_namespace(), namespace)

    def test_collections_invalidation_bumps_the_namespace(self):
        before = AnimePublicPayloadService.collection_cache_namespace()
        invalidate_public_collections()
        self.assertNotEqual(AnimePublicPayloadService.collection_cache_namespace(), before)
