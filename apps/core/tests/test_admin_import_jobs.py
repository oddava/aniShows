from django.test import SimpleTestCase
from django.utils import timezone

from apps.core.models import CeleryTaskResult
from apps.core.views.admin_import_jobs import (
    AdminImportJobViewSet,
    OFFLINE_RECONCILE_TASK,
)


class AdminImportJobViewSetTests(SimpleTestCase):
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
