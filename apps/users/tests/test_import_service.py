from unittest.mock import Mock, patch

from celery.exceptions import Retry
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.utils import OperationalError
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ...animes.models import Anime
from ..models import UserActivity, UserImportJob, UserProfile
from ..services.import_job_service import (
    create_anilist_import_job,
    create_mal_import_job,
    create_mal_xml_import_job,
)
from ..services.import_service.anilist import AniListImporter
from ..services.import_service.mal_api import MyAnimeListAPIImporter
from ..services.import_service.mal_xml import MyAnimeListXMLImporter
from ..tasks import process_import_job

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

        with patch.object(importer, "_get_sync_service") as mock_get_service:
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

        class DummyJikanService:
            def __init__(self):
                self.get_calls = 0
                self.search_calls = 0

            async def get_anime_by_id(self, _anilist_id):
                self.get_calls += 1
                return None

            async def search_by_mal_id(self, _mal_id):
                return None

            async def search_anime(self, _query_string):
                self.search_calls += 1
                return []

        service = DummyJikanService()

        with patch.object(importer, "_get_sync_service", return_value=service):
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
        self.assertEqual(service.get_calls, 0)
        self.assertEqual(service.search_calls, 1)


class MyAnimeListImporterTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="mal-importer-user",
            email="mal-importer@example.com",
            password="password123",
        )
        self.job = UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier="mal-importer-user",
        )

    @patch("apps.users.services.import_service.mal_api.time.sleep", return_value=None)
    @patch("apps.users.services.import_service.mal_api.requests.get")
    def test_fetch_user_list_fails_after_rate_limit_retry_budget(self, mock_get, _mock_sleep):
        rate_limited = Mock(status_code=429, headers={"Retry-After": "0"})
        rate_limited.raise_for_status.return_value = None
        mock_get.return_value = rate_limited

        importer = MyAnimeListAPIImporter(
            job=self.job,
            username="mal-importer-user",
            client_id="test-client",
        )

        with self.assertRaisesMessage(ValueError, "MyAnimeList is rate limiting imports right now."):
            importer.fetch_user_list()


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
    @patch("apps.animes.services.user_list_side_effects.update_user_stats_and_cache")
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


class ImportJobServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="import-job-user",
            email="import-job@example.com",
            password="password123",
        )

    @patch("apps.users.services.import_job_service.process_import_job.apply_async")
    @patch("apps.users.services.import_job_service.transaction.on_commit")
    def test_create_mal_import_job_queues_task_on_commit(self, mock_on_commit, mock_delay):
        result = create_mal_import_job(self.user, "sample-user")

        self.assertEqual(mock_delay.call_count, 0)
        self.assertEqual(mock_on_commit.call_count, 1)
        callback = mock_on_commit.call_args.args[0]
        callback()

        self.assertEqual(result.status_code, 202)
        self.assertEqual(mock_delay.call_count, 1)

    def test_create_mal_import_job_rejects_active_import(self):
        UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier="existing-user",
            status=UserImportJob.ImportStatus.pending,
        )

        result = create_mal_import_job(self.user, "sample-user")

        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.payload["code"], "import_already_running")

    @override_settings(MAX_IMPORT_JOBS_PER_DAY=1)
    def test_create_mal_import_job_rejects_daily_quota(self):
        UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier="completed-user",
            status=UserImportJob.ImportStatus.completed,
        )

        result = create_mal_import_job(self.user, "sample-user")

        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.payload["code"], "daily_import_limit_reached")

    @override_settings(MAX_IMPORT_TASK_PAYLOAD_BYTES=64)
    def test_create_mal_xml_import_job_rejects_oversized_task_payload(self):
        result = create_mal_xml_import_job(
            self.user,
            "large.xml",
            "<myanimelist>" + ("x" * 200),
        )

        self.assertEqual(result.status_code, 400)
        self.assertEqual(result.payload["code"], "import_payload_too_large")

    @patch(
        "apps.users.services.import_job_service.process_import_job.apply_async",
        side_effect=RuntimeError("broker down"),
    )
    def test_create_mal_import_job_marks_job_failed_when_enqueue_fails(self, _mock_delay):
        with self.captureOnCommitCallbacks(execute=True):
            result = create_mal_import_job(self.user, "sample-user")

        job = UserImportJob.objects.get(id=result.payload["job_id"])
        self.assertEqual(job.status, UserImportJob.ImportStatus.failed)
        self.assertIn("Failed to queue import job", job.errors)


    @patch("apps.users.services.import_job_service.process_import_job.apply_async")
    def test_anilist_token_is_sent_to_worker_but_not_stored(self, mock_apply_async):
        with self.captureOnCommitCallbacks(execute=True):
            create_anilist_import_job(self.user, "sample-user", "secret-bearer-token")

        call = mock_apply_async.call_args.kwargs
        self.assertEqual(call["kwargs"]["access_token"], "secret-bearer-token")
        self.assertNotIn("secret-bearer-token", call["kwargsrepr"])

    def test_prerun_signal_stores_redacted_kwargs(self):
        from ...core.celery_signals import on_task_prerun
        from ...core.models import CeleryTaskResult

        on_task_prerun(
            task_id="redaction-test",
            task=process_import_job,
            args=(),
            kwargs={"job_id": 1, "access_token": "secret-bearer-token", "xml_content": "<x/>"},
        )

        stored = CeleryTaskResult.objects.get(task_id="redaction-test").task_kwargs
        self.assertEqual(
            stored, {"job_id": 1, "access_token": "[redacted]", "xml_content": "[4 characters]"}
        )


    def test_importer_for_requeued_job_uses_stored_username(self):
        """Admin retry re-queues with only the job id."""
        from ..services.import_service import ImportService

        job = UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.anilist,
            source_identifier="stored-name",
        )

        importer = ImportService.create_importer(job)

        self.assertEqual(importer.username, "stored-name")


class ImportTaskWrapperTests(TestCase):
    @patch("apps.users.tasks.UserTaskService.mark_import_job_failed")
    @patch("apps.users.tasks.UserTaskService.process_import_job", side_effect=OperationalError("db down"))
    @patch("apps.users.tasks._can_retry", return_value=True)
    @patch.object(process_import_job, "retry", side_effect=Retry())
    def test_process_import_job_does_not_mark_failed_before_retry(
        self,
        _mock_retry,
        _mock_can_retry,
        _mock_process,
        mock_mark_failed,
    ):
        with self.assertRaises(Retry):
            process_import_job.run(job_id=123)

        mock_mark_failed.assert_not_called()

    @patch("apps.users.tasks.UserTaskService.mark_import_job_failed")
    @patch("apps.users.tasks.UserTaskService.process_import_job", side_effect=OperationalError("db down"))
    @patch("apps.users.tasks._can_retry", return_value=False)
    def test_process_import_job_marks_failed_after_retry_budget_exhausted(
        self,
        _mock_can_retry,
        _mock_process,
        mock_mark_failed,
    ):
        with self.assertRaises(OperationalError):
            process_import_job.run(job_id=123)

        mock_mark_failed.assert_called_once()


class ImportExportApiSecurityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="api-import-user",
            email="api-import@example.com",
            password="password123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _set_email_verified(self, verified=True):
        UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"email_verified": verified},
        )
        # Drop the profile cached on the authenticated user by the creation signal.
        self.user.refresh_from_db()

    def test_mal_import_requires_verified_email(self):
        self._set_email_verified(False)

        response = self.client.post(
            reverse("import_mal"),
            {"username": "sample-user"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "email_verification_required")

    @patch("apps.users.services.import_job_service.transaction.on_commit")
    def test_verified_user_can_start_mal_import(self, mock_on_commit):
        self._set_email_verified(True)

        response = self.client.post(
            reverse("import_mal"),
            {"username": "sample-user"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(response.data["status"], "pending")
        self.assertEqual(mock_on_commit.call_count, 1)

    @override_settings(MAX_IMPORT_XML_ENTRIES=1)
    @patch("apps.users.services.import_job_service.transaction.on_commit")
    def test_mal_xml_import_rejects_too_many_entries(self, mock_on_commit):
        self._set_email_verified(True)
        upload = SimpleUploadedFile(
            "list.xml",
            b"<myanimelist><anime /><anime /></myanimelist>",
            content_type="application/xml",
        )

        response = self.client.post(
            reverse("import_mal_xml"),
            {"file": upload},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "xml_entry_limit_exceeded")
        mock_on_commit.assert_not_called()
