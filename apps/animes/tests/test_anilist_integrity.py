from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import TestCase

from apps.animes.models import Anime
from apps.animes.services.anilist import AniListService
from apps.animes.tasks.metadata import MetadataEnrichmentTask


class AniListIntegrityTests(TestCase):
    def setUp(self):
        self.enrich_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.enrich_patcher.start()
        self.addCleanup(self.enrich_patcher.stop)

    def test_resolve_manual_update_item_refetches_when_anilist_id_mismatches(self):
        Anime.objects.create(
            title="Conflicting Anime",
            slug="conflicting-anime",
            synopsis="existing",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=456,
        )
        anime = Anime.objects.create(
            title="Target Anime",
            slug="target-anime",
            synopsis="target",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            anilist_id=123,
        )

        wrong_item = {
            "id": 456,
            "title": {"english": "Conflicting Anime", "romaji": "Conflicting Anime"},
        }
        canonical_item = {
            "id": 123,
            "title": {"english": "Canonical Title", "romaji": "Canonical Title"},
            "description": "updated",
        }

        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())

        with patch.object(service, "get_anime_by_id", AsyncMock(return_value=canonical_item)):
            resolved = async_to_sync(service._resolve_manual_update_item)(anime, wrong_item)

        self.assertEqual(resolved["id"], 123)
        self.assertEqual(
            resolved["title"]["english"], "Canonical Title"
        )

    def test_update_anime_sync_keeps_existing_title_on_conflict(self):
        anime = Anime.objects.create(
            title="Unique Source",
            slug="unique-source",
            synopsis="source",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            anilist_id=111,
        )
        Anime.objects.create(
            title="Taken Title",
            slug="taken-title",
            synopsis="taken",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=222,
        )

        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())

        sync_update = service._update_anime.func.__self__.func
        sync_update(service, anime, {"title": "Taken Title", "synopsis": "updated synopsis"})

        anime.refresh_from_db()
        self.assertEqual(anime.title, "Unique Source")
        self.assertEqual(anime.synopsis, "updated synopsis")

    def test_metadata_resolver_prefers_anilist_id_lookup(self):
        anime = Anime.objects.create(
            title="Resolver Anime",
            slug="resolver-anime",
            synopsis="resolver",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            anilist_id=555,
            mal_id=999,
        )

        service = SimpleNamespace(
            get_anime_by_id=AsyncMock(return_value={"id": 555, "title": {"english": "ok"}}),
            search_by_mal_id=AsyncMock(return_value={"id": 999}),
            search_anime=AsyncMock(return_value=[{"id": 1}]),
        )

        task = MetadataEnrichmentTask()
        result = async_to_sync(task._resolve_media_for_anime)(service, anime)

        self.assertEqual(result["id"], 555)
        service.get_anime_by_id.assert_awaited_once_with(555)
        service.search_by_mal_id.assert_not_awaited()
        service.search_anime.assert_not_awaited()

    def test_metadata_resolver_uses_exact_title_match_when_searching(self):
        anime = Anime.objects.create(
            title="Exact Match",
            slug="exact-match",
            synopsis="resolver",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            title_jp="Exact Native",
        )

        service = SimpleNamespace(
            get_anime_by_id=AsyncMock(return_value=None),
            search_by_mal_id=AsyncMock(return_value=None),
            search_anime=AsyncMock(
                return_value=[
                    {"id": 1, "title": {"english": "Different", "romaji": "Different"}},
                    {"id": 2, "title": {"native": "Exact Native"}},
                ]
            ),
        )

        task = MetadataEnrichmentTask()
        result = async_to_sync(task._resolve_media_for_anime)(service, anime)

        self.assertEqual(result["id"], 2)
        service.search_anime.assert_awaited_once_with("Exact Match")

    def test_process_theme_songs_handles_none_theme_lists(self):
        anime = Anime.objects.create(
            title="Theme Null Guard",
            slug="theme-null-guard",
            synopsis="resolver",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            anilist_id=98765,
        )
        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())

        service._process_theme_songs(
            anime,
            {
                "openings": None,
                "endings": None,
            },
        )
