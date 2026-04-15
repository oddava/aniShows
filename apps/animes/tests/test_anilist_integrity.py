from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import TestCase

from ..models import Anime, Staff
from ..services.anilist import AniListService
from ..tasks.metadata import MetadataEnrichmentTask


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

    def test_handle_extended_info_persists_staff_descriptions(self):
        anime = Anime.objects.create(
            title="Staff Description Guard",
            slug="staff-description-guard",
            synopsis="resolver",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            anilist_id=45678,
        )
        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())

        item = {
            "characterPreview": {
                "edges": [
                    {
                        "role": "MAIN",
                        "node": {
                            "id": 901,
                            "name": {"full": "Test Character", "native": "テスト"},
                            "image": {"large": "https://example.com/character.jpg"},
                            "description": "Character description",
                        },
                        "voiceActors": [
                            {
                                "id": 902,
                                "name": {"full": "Test Voice Actor", "native": "声優"},
                                "image": {"large": "https://example.com/va.jpg"},
                                "description": "Voice actor bio",
                            }
                        ],
                    }
                ]
            },
            "staffPreview": {
                "edges": [
                    {
                        "role": "Director",
                        "node": {
                            "id": 903,
                            "name": {"full": "Test Director", "native": "監督"},
                            "image": {"large": "https://example.com/director.jpg"},
                            "description": "Director bio",
                        },
                    }
                ]
            },
            "openings": None,
            "endings": None,
        }

        async_to_sync(service._handle_extended_info_async)(anime, item)

        voice_actor = Staff.objects.get(anilist_id=902)
        staff_member = Staff.objects.get(anilist_id=903)
        self.assertEqual(voice_actor.description, "Voice actor bio")
        self.assertEqual(staff_member.description, "Director bio")

    def test_prepare_anime_data_includes_normalized_non_spoiler_tags(self):
        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(lambda: async_to_sync(service.close)())

        data = service._prepare_anime_data(
            {
                "format": "TV",
                "status": "FINISHED",
                "episodes": 12,
                "duration": 24,
                "tags": [
                    {"name": "Time Loop", "isMediaSpoiler": False, "isGeneralSpoiler": False},
                    {"name": "Female Protagonist", "isMediaSpoiler": False, "isGeneralSpoiler": False},
                    {"name": "Time Loop", "isMediaSpoiler": False, "isGeneralSpoiler": False},
                    {"name": "Final Battle", "isMediaSpoiler": True, "isGeneralSpoiler": False},
                ],
            },
            "Tag Test",
            "",
            "tag-test",
        )

        self.assertEqual(data["tags"], ["time loop", "female protagonist"])

    def test_metadata_backfill_can_target_anime_with_missing_tags_only(self):
        missing_tags = Anime.objects.create(
            title="Missing Tags",
            slug="missing-tags",
            synopsis="Complete synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=1234,
            tags=[],
        )
        Anime.objects.create(
            title="Has Tags",
            slug="has-tags",
            synopsis="Complete synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=5678,
            tags=["magic"],
        )

        service = SimpleNamespace(
            call_cache=None,
            refresh_anime_metadata=AsyncMock(return_value=True),
        )
        task = MetadataEnrichmentTask()

        @asynccontextmanager
        async def fake_service_context(**_kwargs):
            yield service

        task.service_context = fake_service_context
        task._resolve_media_for_anime = AsyncMock(return_value={"id": 1234})

        result = async_to_sync(task._enrich_batch)(
            batch_size=10,
            filters=None,
            priority_field="-popularity_rank",
            anime_ids=None,
            missing_tags_only=True,
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["updated"], 1)
        self.assertTrue(result["missing_tags_only"])
        task._resolve_media_for_anime.assert_awaited_once_with(service, missing_tags)
        service.refresh_anime_metadata.assert_awaited_once()

    @patch("apps.animes.services.anilist.logger.warning")
    @patch("apps.animes.services.anilist.logger.info")
    def test_untrusted_image_domains_log_at_info(self, mock_info, mock_warning):
        resolved = AniListService.resolve_fetchable_image_url("https://media.kitsu.app/poster.jpg")

        self.assertEqual(resolved, "")
        mock_info.assert_called_once()
        mock_warning.assert_not_called()
