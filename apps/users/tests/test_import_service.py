from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase

from apps.animes.models import Anime
from apps.users.models import UserActivity, UserImportJob
from apps.users.services.import_service.anilist import AniListImporter
from apps.users.services.import_service.mal_xml import MyAnimeListXMLImporter

User = get_user_model()


class AniListImporterTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="importer-user", email="importer@example.com", password="password123"
        )
        self.job = UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.anilist,
            source_identifier="importer-user",
        )
        cache.clear()

    @patch("apps.users.services.import_service.anilist.time.sleep", return_value=None)
    @patch("apps.users.services.import_service.anilist.requests.post")
    def test_fetch_user_list_retries_after_rate_limit(self, mock_post, _mock_sleep):
        rate_limited = Mock(status_code=429, headers={"Retry-After": "0"}, text="rate limited")
        rate_limited.json.return_value = {"errors": [{"message": "Too Many Requests"}]}

        success = Mock(status_code=200, headers={})
        success.raise_for_status.return_value = None
        success.json.return_value = {
            "data": {
                "MediaListCollection": {
                    "lists": [
                        {
                            "name": "Watching",
                            "entries": [
                                {
                                    "id": 1,
                                    "mediaId": 16498,
                                    "status": "CURRENT",
                                    "score": 80,
                                    "progress": 6,
                                    "media": {
                                        "id": 16498,
                                        "idMal": 5114,
                                        "title": {
                                            "romaji": "Shingeki no Kyojin",
                                            "english": "Attack on Titan",
                                            "native": "進撃の巨人",
                                        },
                                        "episodes": 25,
                                    },
                                }
                            ],
                        }
                    ]
                }
            }
        }

        mock_post.side_effect = [rate_limited, success]

        importer = AniListImporter(job=self.job, username="importer-user")
        entries = importer.fetch_user_list()

        self.assertEqual(mock_post.call_count, 2)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["anilist_id"], 16498)
        self.assertEqual(entries[0]["mal_id"], 5114)

    def test_get_or_fetch_skips_external_lookup_without_stable_ids(self):
        importer = MyAnimeListXMLImporter(job=self.job, xml_content="<myanimelist></myanimelist>")

        with patch.object(importer, "_get_anilist_service") as mock_get_service:
            anime = importer.get_or_fetch_anime_sync(
                mal_id=None,
                anilist_id=None,
                title="Unknown Missing Anime",
                allow_title_search=False,
            )

        self.assertIsNone(anime)
        mock_get_service.assert_not_called()

    def test_get_or_fetch_uses_missing_id_cache(self):
        importer = MyAnimeListXMLImporter(job=self.job, xml_content="<myanimelist></myanimelist>")
        missing_anilist_id = 9999999
        cache.delete(f"import:missing:anilist:{missing_anilist_id}")

        class DummyAniListService:
            def __init__(self):
                self.calls = 0

            async def get_anime_by_id(self, _anilist_id):
                self.calls += 1
                return None

            async def search_by_mal_id(self, _mal_id):
                return None

            async def search_anime(self, _query_string):
                return []

        service = DummyAniListService()

        with patch.object(importer, "_get_anilist_service", return_value=service):
            first = importer.get_or_fetch_anime_sync(
                anilist_id=missing_anilist_id,
                title="Missing Anime",
            )
            second = importer.get_or_fetch_anime_sync(
                anilist_id=missing_anilist_id,
                title="Missing Anime",
            )

        importer._cleanup()
        self.assertIsNone(first)
        self.assertIsNone(second)
        self.assertEqual(service.calls, 1)


class ImportSaveEntryTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="save-entry-user", email="save-entry@example.com", password="password123"
        )
        self.job = UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.myanimelist_xml,
            source_identifier="sample.xml",
        )
        self.anime = Anime.objects.create(
            title="Import Save Entry Anime",
            slug="import-save-entry-anime",
            synopsis="Test synopsis",
            status=Anime.AnimeStatus.finished,
        )

    @patch("apps.animes.signals._schedule_recommendations_debounced")
    @patch("apps.animes.signals.update_user_stats_and_cache")
    def test_save_entry_does_not_create_activity_records(
        self, mock_update_stats, mock_schedule_recommendations
    ):
        importer = MyAnimeListXMLImporter(job=self.job, xml_content="<myanimelist></myanimelist>")
        success, _message = importer.save_entry(
            anime=self.anime,
            status="Watching",
            score=8,
            episodes_watched=5,
        )

        self.assertTrue(success)
        self.assertFalse(
            UserActivity.objects.filter(user=self.user, anime=self.anime).exists(),
        )
        mock_update_stats.assert_not_called()
        mock_schedule_recommendations.assert_not_called()
