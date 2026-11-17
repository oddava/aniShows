"""System and audit log endpoints (G6 P1-5, P1-8)."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from ...core.models import AuditLog, SystemLog
from .helpers import bearer_client, make_user


class LogStatsTests(TestCase):
    def setUp(self):
        self.root = bearer_client(make_user("logs-root", role="superuser"))
        now = timezone.now()
        for minutes, level in ((1, "INFO"), (2, "INFO"), (3, "INFO"), (4, "ERROR")):
            row = SystemLog.objects.create(level=level, log_type="REQUEST", message="m")
            SystemLog.objects.filter(pk=row.pk).update(timestamp=now - timedelta(minutes=minutes))
        old = SystemLog.objects.create(level="INFO", log_type="REQUEST", message="old")
        SystemLog.objects.filter(pk=old.pk).update(timestamp=now - timedelta(days=3))

    def test_counts_group_by_level_whatever_the_list_ordering(self):
        for ordering in ("", "-timestamp", "timestamp"):
            with self.subTest(ordering=ordering):
                data = self.root.get("/api/v1/admin/logs/stats/", {"ordering": ordering}).data
                self.assertEqual(data["by_level"], {"INFO": 3, "ERROR": 1})
                self.assertEqual(data["by_type"], {"REQUEST": 4})
                self.assertEqual((data["total"], data["window"]), (4, "24h"))

    def test_filters_widen_the_window_to_the_filtered_rows(self):
        data = self.root.get("/api/v1/admin/logs/stats/", {"level": "INFO"}).data

        self.assertEqual(data["by_level"], {"INFO": 4})
        self.assertEqual(data["window"], "filtered")

    def test_request_logs_are_superuser_only_but_audit_logs_are_staff(self):
        staff = bearer_client(make_user("logs-staff", role="staff"))
        AuditLog.objects.create(action="UPDATE", entity_type="User", entity_id="1")

        self.assertEqual(staff.get("/api/v1/admin/logs/").status_code, 403)
        self.assertEqual(staff.get("/api/v1/admin/logs/stats/").status_code, 403)
        audit = staff.get("/api/v1/admin/audit-logs/", {"entity_type": "User", "entity_id": "1"})
        self.assertEqual((audit.status_code, audit.data["count"]), (200, 1))
