"""SystemLog/AuditLog retention runs inside the daily cleanup task (G6 P0-5c)."""

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from ..models import AuditLog, SystemLog
from ..services import celery_tasks
from ..services.celery_tasks import CoreTaskService
from ..tasks.cleanup_tasks import cleanup_old_task_results


def _aged(model, days, **fields):
    row = model.objects.create(**fields)
    model.objects.filter(pk=row.pk).update(timestamp=timezone.now() - timedelta(days=days))
    return row.pk


class LogRetentionTests(TestCase):
    def setUp(self):
        self.kept = {
            _aged(SystemLog, 13, level="INFO", message="recent info"),
            _aged(SystemLog, 29, level="ERROR", message="recent error"),
            _aged(AuditLog, 364, action="UPDATE", entity_type="User"),
        }
        self.pruned_system = {
            _aged(SystemLog, 15, level="INFO", message="old info"),
            _aged(SystemLog, 15, level="WARNING", message="old warning"),
            _aged(SystemLog, 31, level="CRITICAL", message="old critical"),
        }
        self.pruned_audit = {_aged(AuditLog, 366, action="DELETE", entity_type="User")}
        _aged(SystemLog, 20, level="ERROR", message="error inside its 30 days")

    def test_prune_applies_each_rule(self):
        result = CoreTaskService.prune_admin_records()

        self.assertEqual(result, {"system_logs": 2, "system_log_errors": 1, "audit_logs": 1})
        remaining = set(SystemLog.objects.values_list("pk", flat=True)) | set(
            AuditLog.objects.values_list("pk", flat=True)
        )
        self.assertTrue(self.kept <= remaining)
        self.assertFalse(self.pruned_system & set(SystemLog.objects.values_list("pk", flat=True)))
        self.assertFalse(self.pruned_audit & set(AuditLog.objects.values_list("pk", flat=True)))

    def test_prune_deletes_in_batches(self):
        for _ in range(5):
            _aged(SystemLog, 40, level="INFO", message="bulk")
        with patch.object(
            celery_tasks, "_delete_in_batches", wraps=celery_tasks._delete_in_batches
        ) as batches:
            result = CoreTaskService.prune_admin_records(batch_size=2)

        self.assertEqual(result["system_logs"], 7)
        self.assertEqual(batches.call_count, 3)

    def test_daily_cleanup_task_also_prunes(self):
        result = cleanup_old_task_results.apply(kwargs={"days": 7, "batch_size": 1000}).get()

        self.assertEqual(result["pruned"]["audit_logs"], 1)
        self.assertEqual(result["pruned"]["system_logs"], 2)
