from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core.services.admin_import_jobs_service import (
    ANILIST_SYNC_TASK,
    FULL_CATALOG_LIMIT,
    TRENDING_REFRESH_TASK,
    trigger_anilist_import,
    trigger_metadata_enrichment,
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
