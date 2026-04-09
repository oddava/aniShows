from django.test import SimpleTestCase
from django.utils import timezone

from ..models import CeleryTaskResult
from ..views.admin_import_jobs import (
    OFFLINE_RECONCILE_TASK,
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
