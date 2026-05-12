from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from ..models import CeleryTaskResult
from ..views.admin_import_jobs import (
    OFFLINE_RECONCILE_TASK,
    AdminImportJobFilter,
    AdminImportJobViewSet,
)


class AdminImportJobViewSetTests(SimpleTestCase):
    def test_trending_catalog_sync_uses_jikan_source_label(self):
        result = CeleryTaskResult(
            id=8111,
            task_id="task-trending-1",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={"sync_type": "trending", "limit": 10},
            result_data={"records_processed": 7},
        )

        payload = AdminImportJobViewSet()._format_task_result(result)

        assert payload["source"] == "Jikan (self-hosted)"
        assert payload["source_type"] == "Trending"
        assert payload["processed_items"] == 7
        assert payload["total_items"] == 10

    def test_metadata_enrichment_uses_jikan_source_label(self):
        result = CeleryTaskResult(
            id=8123,
            task_id="task-meta-1",
            task_name="apps.animes.tasks.metadata.enrich_metadata",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={"mode": "backfill", "batch_size": 10},
            result_data={"total": 8, "updated": 5, "no_results": 2, "errors": 1},
        )

        payload = AdminImportJobViewSet()._format_task_result(result)

        assert payload["source"] == "Jikan (self-hosted)"
        assert payload["source_type"] == "Metadata Enrichment"
        assert payload["processed_items"] == 8
        assert payload["total_items"] == 8
        assert payload["error_count"] == 1

    def test_offline_reconcile_progress_counts_quarantined_as_terminal(self):
        result = CeleryTaskResult(
            id=7453,
            task_id="task-123",
            task_name=OFFLINE_RECONCILE_TASK,
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={},
            result_data={
                "pending": 3,
                "complete": 58,
                "quarantined_count": 39,
                "blocked_without_ids": 0,
            },
        )

        payload = AdminImportJobViewSet()._format_task_result(result)

        assert payload["processed_items"] == 97
        assert payload["total_items"] == 100

    def test_catalog_business_failure_is_displayed_as_failed(self):
        result = CeleryTaskResult(
            id=8124,
            task_id="task-empty-sync",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={"sync_type": "trending", "limit": 50},
            result_data={
                "status": "no_data",
                "sync_type": "trending",
                "records_processed": 0,
                "fetched": 0,
            },
        )

        payload = AdminImportJobViewSet()._format_task_result(result)

        assert payload["status"] == "failed"
        assert payload["error_count"] == 1
        assert payload["total_items"] == 50
        assert "no usable data" in payload["error_message"]

    @patch("apps.core.views.admin_import_jobs.trigger_offline_import")
    def test_trigger_defaults_to_offline_catalog(self, mock_trigger_offline_import):
        mock_trigger_offline_import.return_value = SimpleNamespace(
            payload={"job_id": "job-offline"},
            status_code=202,
        )
        request = SimpleNamespace(data={}, user=SimpleNamespace(is_authenticated=True))

        response = AdminImportJobViewSet().trigger(request)

        assert response.status_code == 202
        assert response.data == {"job_id": "job-offline"}
        mock_trigger_offline_import.assert_called_once_with(request.data, request.user)


class AdminImportJobFilterTests(TestCase):
    def test_failed_filter_includes_business_failure_success_rows(self):
        failed = CeleryTaskResult.objects.create(
            task_id="task-business-failed",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "no_data"},
        )
        completed = CeleryTaskResult.objects.create(
            task_id="task-success",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "success"},
        )

        queryset = AdminImportJobFilter(
            {"status": "failed"},
            queryset=CeleryTaskResult.objects.all(),
        ).qs

        self.assertIn(failed, queryset)
        self.assertNotIn(completed, queryset)

    def test_completed_filter_excludes_business_failure_success_rows(self):
        failed = CeleryTaskResult.objects.create(
            task_id="task-business-failed",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "source_unhealthy"},
        )
        completed = CeleryTaskResult.objects.create(
            task_id="task-success",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "success"},
        )

        queryset = AdminImportJobFilter(
            {"status": "completed"},
            queryset=CeleryTaskResult.objects.all(),
        ).qs

        self.assertIn(completed, queryset)
        self.assertNotIn(failed, queryset)
