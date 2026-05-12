from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from ..models import CeleryTaskResult
from ..services.admin_import_jobs_service import (
    ANILIST_SYNC_TASK,
    FULL_CATALOG_LIMIT,
    OFFLINE_IMPORT_TASK,
    TRENDING_REFRESH_TASK,
    create_pending_job,
    trigger_anilist_import,
    trigger_metadata_enrichment,
    trigger_offline_import,
)


class AdminImportJobsServiceTests(SimpleTestCase):
    @patch("apps.core.services.admin_import_jobs_service.create_pending_job")
    def test_full_catalog_defaults_to_broader_limit(self, mock_create_pending_job):
        mock_create_pending_job.return_value = SimpleNamespace(id="job-123")
        user = SimpleNamespace(is_authenticated=True)

        result = trigger_anilist_import(
            {"source": "anilist_sync", "sync_type": "full_catalog"},
            user,
        )

        self.assertEqual(result.status_code, 202)
        mock_create_pending_job.assert_called_once_with(
            user=user,
            task_path=ANILIST_SYNC_TASK,
            task_module="apps.animes.tasks.sync",
            kwargs={"sync_type": "full_catalog", "limit": FULL_CATALOG_LIMIT},
            queue="default",
        )

    @patch("apps.core.services.admin_import_jobs_service.create_pending_job")
    def test_trending_routes_to_jikan_backed_catalog_sync(self, mock_create_pending_job):
        mock_create_pending_job.return_value = SimpleNamespace(id="job-456")
        user = SimpleNamespace(is_authenticated=False)

        trigger_anilist_import(
            {"source": "anilist_sync", "sync_type": "trending"},
            user,
        )

        mock_create_pending_job.assert_called_once_with(
            user=user,
            task_path=TRENDING_REFRESH_TASK,
            task_module="apps.animes.tasks.sync",
            kwargs={"sync_type": "trending", "limit": 50},
            queue="high_priority",
        )

    @patch("apps.core.services.admin_import_jobs_service.create_pending_job")
    def test_seasonal_routes_to_local_catalog_sync(self, mock_create_pending_job):
        mock_create_pending_job.return_value = SimpleNamespace(id="job-789")
        user = SimpleNamespace(is_authenticated=True)

        trigger_anilist_import(
            {"source": "anilist_sync", "sync_type": "seasonal"},
            user,
        )

        mock_create_pending_job.assert_called_once_with(
            user=user,
            task_path=ANILIST_SYNC_TASK,
            task_module="apps.animes.tasks.sync",
            kwargs={"sync_type": "seasonal", "limit": 50},
            queue="default",
        )

    @patch("apps.core.services.admin_import_jobs_service.create_pending_job")
    def test_metadata_enrichment_uses_jikan_task(self, mock_create_pending_job):
        mock_create_pending_job.return_value = SimpleNamespace(id="job-321")
        user = SimpleNamespace(is_authenticated=True)

        result = trigger_metadata_enrichment(
            {"source": "jikan_enrichment", "batch_size": 25},
            user,
        )

        self.assertEqual(result.status_code, 202)
        mock_create_pending_job.assert_called_once_with(
            user=user,
            task_path="apps.animes.tasks.metadata.enrich_metadata",
            task_module="apps.animes.tasks.metadata",
            kwargs={"mode": "backfill", "batch_size": 25, "missing_tags_only": False},
            queue="batch",
        )

    @patch("apps.core.services.admin_import_jobs_service.create_pending_job")
    def test_offline_import_defaults_to_resume(self, mock_create_pending_job):
        mock_create_pending_job.return_value = SimpleNamespace(id="job-offline")
        user = SimpleNamespace(is_authenticated=True)

        result = trigger_offline_import({"source": "offline_catalog"}, user)

        self.assertEqual(result.status_code, 202)
        mock_create_pending_job.assert_called_once_with(
            user=user,
            task_path=OFFLINE_IMPORT_TASK,
            task_module="apps.animes.tasks.offline_catalog",
            kwargs={
                "release_tag": "latest",
                "asset_name": "anime-offline-database.jsonl.zst",
                "source_url": None,
                "source_path": None,
                "limit": None,
                "resume": True,
                "enqueue_enrichment": True,
                "enforce_full_sync": True,
                "batch_size": 250,
                "enrichment_chunk_size": 100,
            },
            queue="batch",
        )


class CreatePendingJobTests(TestCase):
    @patch("apps.core.services.admin_import_jobs_service.current_app.send_task")
    def test_create_pending_job_reuses_worker_created_tracking_row(self, mock_send_task):
        mock_send_task.return_value = SimpleNamespace(id="task-race")
        existing = CeleryTaskResult.objects.create(
            task_id="task-race",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.STARTED,
        )

        job = create_pending_job(
            user=None,
            task_path="apps.animes.tasks.sync.sync_anime_catalog",
            task_module="apps.animes.tasks.sync",
            kwargs={"sync_type": "trending", "limit": 50},
            queue="high_priority",
        )

        self.assertEqual(job.id, existing.id)
        self.assertEqual(job.status, CeleryTaskResult.TaskStatus.STARTED)
        self.assertEqual(job.task_kwargs, {"sync_type": "trending", "limit": 50})
        self.assertEqual(job.queue, "high_priority")
