"""record_admin_action (G6 contract) writes today's AuditLog row."""

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from ...core.models import AuditLog
from ..services.audit import record_admin_action

User = get_user_model()


class RecordAdminActionTests(TestCase):
    def test_writes_one_row_and_marks_the_request(self):
        staff = User.objects.create_user("mod", "mod@example.com", "pw-123456", is_staff=True)
        request = RequestFactory().post("/api/v1/admin/x/", REMOTE_ADDR="203.0.113.7")
        request.user = staff

        entry = record_admin_action(
            request,
            action=AuditLog.ActionType.UPDATE,
            entity_type="User",
            entity_id=12,
            entity_repr="x" * 300,
            previous={"is_active": True},
            new={"is_active": False},
            metadata={"source": "test"},
            reason="Spam",
        )

        self.assertEqual(AuditLog.objects.count(), 1)
        self.assertEqual((entry.user, entry.user_ip, entry.entity_id), (staff, "203.0.113.7", "12"))
        self.assertEqual(len(entry.entity_repr), 200)
        self.assertEqual(entry.metadata, {"source": "test", "reason": "Spam"})
        self.assertEqual(entry.changes, {"is_active": {"old": True, "new": False}})
        self.assertTrue(getattr(request, "_admin_audited", False))
