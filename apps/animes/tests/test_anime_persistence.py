"""Updating an anime from a provider must not erase what the provider left out."""

import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import TestCase

from ..models import Anime
from ..services.anilist import AniListService
from ..services.jikan import JikanService


def _rich_anime() -> Anime:
    return Anime.objects.create(
        title="Frieren",
        title_jp="葬送のフリーレン",
        slug="frieren",
        synopsis="An elf mage outlives her party.",
        anime_type=Anime.AnimeType.tv,
        status=Anime.AnimeStatus.airing,
        episode_count=28,
        duration_minutes=24,
        member_count=900000,
        rating=9.1,
        site_rank=1,
        release_date=datetime.date(2023, 9, 29),
        anilist_id=154587,
        mal_id=52991,
        cover_image_external_url="https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/a.jpg",
        tags=["Fantasy", "Travel"],
        external_links=[{"site": "Crunchyroll", "url": "https://www.crunchyroll.com/frieren"}],
        status_distribution={"CURRENT": 10},
        provider_ids={"anilist": 154587, "myanimelist": 52991},
    )


# What a provider sends when it knows little: no synopsis, no episode total
# (normal for airing shows), no images, tags, rankings or links.
SPARSE_ITEM = {
    "id": 154587,
    "idMal": 52991,
    "title": {"english": "Frieren", "romaji": "Sousou no Frieren", "native": None},
    "format": None,
    "status": "RELEASING",
    "episodes": None,
    "duration": None,
    "popularity": None,
    "averageScore": None,
    "startDate": {},
    "endDate": {},
    "description": None,
    "coverImage": {},
    "bannerImage": None,
    "rankings": [],
    "stats": {},
    "externalLinks": [],
    "tags": [],
    "synonyms": [],
    "producers": [],
    "providerIds": {"jikan": 52991},
    "sourceUrls": [],
    "nextAiringEpisode": None,
    "broadcast": {},
}


class SparseUpdateDoesNotClobberTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)

    def _update(self, service, anime, item):
        with (
            patch.object(service, "_handle_relationships_async", new=AsyncMock()),
            patch.object(service, "_download_and_save_images", new=AsyncMock()),
        ):
            async_to_sync(service._update_anime_async)(
                anime, item, "Frieren", item["title"]["native"], anime.slug
            )
        anime.refresh_from_db()

    def _assert_preserved(self, anime):
        self.assertEqual(anime.synopsis, "An elf mage outlives her party.")
        self.assertEqual(anime.title_jp, "葬送のフリーレン")
        self.assertEqual(anime.episode_count, 28)
        self.assertEqual(anime.duration_minutes, 24)
        self.assertEqual(anime.member_count, 900000)
        self.assertEqual(anime.rating, Decimal("9.1"))
        self.assertEqual(anime.site_rank, 1)
        self.assertEqual(anime.release_date, datetime.date(2023, 9, 29))
        self.assertEqual(anime.anime_type, Anime.AnimeType.tv)
        self.assertTrue(anime.cover_image_external_url)
        self.assertEqual(anime.tags, ["Fantasy", "Travel"])
        self.assertEqual(len(anime.external_links), 1)
        self.assertEqual(anime.status_distribution, {"CURRENT": 10})

    def test_jikan_sparse_update_keeps_stored_values_and_merges_provider_ids(self):
        anime = _rich_anime()
        service = JikanService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())

        self._update(service, anime, SPARSE_ITEM)

        self._assert_preserved(anime)
        self.assertEqual(
            anime.provider_ids, {"anilist": 154587, "myanimelist": 52991, "jikan": 52991}
        )

    def test_jikan_update_without_ids_keeps_stored_provider_ids(self):
        anime = _rich_anime()
        service = JikanService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())

        self._update(service, anime, {**SPARSE_ITEM, "providerIds": {"myanimelist": None}})

        self.assertEqual(anime.provider_ids, {"anilist": 154587, "myanimelist": 52991})

    def test_anilist_sparse_update_keeps_stored_values(self):
        anime = _rich_anime()
        service = AniListService()
        self.addCleanup(lambda: async_to_sync(service.close)())

        self._update(service, anime, SPARSE_ITEM)

        self._assert_preserved(anime)

    def test_real_new_values_still_update(self):
        anime = _rich_anime()
        service = JikanService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())
        item = {
            **SPARSE_ITEM,
            "episodes": 29,
            "description": "New synopsis.",
            "status": "FINISHED",
            "tags": [{"name": "Adventure", "rank": 90, "isMediaSpoiler": False}],
        }

        self._update(service, anime, item)

        self.assertEqual(anime.episode_count, 29)
        self.assertEqual(anime.synopsis, "New synopsis.")
        self.assertEqual(anime.status, Anime.AnimeStatus.finished)
        self.assertIn("adventure", anime.tags)

    def test_jikan_update_refreshes_next_airing_episode(self):
        anime = _rich_anime()
        anime.next_airing_episode = 5
        anime.save(update_fields=["next_airing_episode"])
        service = JikanService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())
        airing_at = int(datetime.datetime(2030, 1, 5, 15, tzinfo=datetime.UTC).timestamp())
        item = {**SPARSE_ITEM, "nextAiringEpisode": {"episode": 6, "airingAt": airing_at}}

        self._update(service, anime, item)

        self.assertEqual(anime.next_airing_episode, 6)
        self.assertEqual(anime.next_airing_date.timestamp(), airing_at)


class AniListCreateDoesNotHijackSlugTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_new_show_sharing_a_title_gets_its_own_row(self):
        original = _rich_anime()
        remake = {
            **SPARSE_ITEM,
            "id": 999001,
            "idMal": 999001,
            "description": "A different show with the same name.",
            "seasonYear": 2031,
            "providerIds": {},
        }
        service = AniListService()
        self.addCleanup(lambda: async_to_sync(service.close)())

        with (
            patch.object(service, "_handle_relationships_async", new=AsyncMock()),
            patch.object(service, "_handle_extended_info_async", new=AsyncMock()),
            patch.object(service, "_download_and_save_images", new=AsyncMock()),
        ):
            stats = async_to_sync(service.process_media_list)([remake])

        self.assertEqual(stats["created"], 1)
        created = Anime.objects.get(anilist_id=999001)
        self.assertNotEqual(created.pk, original.pk)
        self.assertNotEqual(created.slug, "frieren")
        original.refresh_from_db()
        self.assertEqual(original.anilist_id, 154587)
        self.assertEqual(original.synopsis, "An elf mage outlives her party.")
