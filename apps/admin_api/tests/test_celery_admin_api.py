from types import SimpleNamespace
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APITestCase

from ...core.models import AuditLog, CeleryTaskResult
from .helpers import bearer_client, make_user

SYNC_TASK = "apps.animes.tasks.sync.sync_anime_catalog"


class CeleryAdminApiTests(APITestCase):
    def setUp(self):
        self.staff = make_user("celery-admin", role="staff")
        self.superuser = make_user("celery-root", role="superuser")
        self.root = bearer_client(self.superuser)

    def test_task_result_list_uses_serialized_summary_fields(self):
        CeleryTaskResult.objects.create(
            task_id="task-1",
            task_name=SYNC_TASK,
            status=CeleryTaskResult.TaskStatus.FAILURE,
            error_message="x" * 300,
            triggered_by=self.staff,
        )

        response = self.root.get("/api/v1/admin/celery/tasks/results/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = response.data["results"][0]
        self.assertEqual(item["task_name_short"], "sync_anime_catalog")
        self.assertEqual(item["status_display"], "Failure")
        self.assertEqual(item["triggered_by"]["username"], self.staff.username)
        self.assertEqual(len(item["error_message"]), 200)

    def test_staff_cannot_read_task_results_which_hold_task_payloads(self):
        response = bearer_client(self.staff).get("/api/v1/admin/celery/tasks/results/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_cannot_trigger_or_control_tasks(self):
        staff = bearer_client(self.staff)
        trigger = staff.post(
            "/api/v1/admin/celery/tasks/trigger/",
            {"task": SYNC_TASK, "kwargs": {"sync_type": "trending"}},
            format="json",
        )
        control = staff.post(
            "/api/v1/admin/celery/tasks/control/",
            {"task_id": "task-1", "action": "revoke"},
            format="json",
        )

        self.assertEqual(trigger.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(control.status_code, status.HTTP_403_FORBIDDEN)

    @patch("apps.core.services.celery_admin_service.current_app.send_task")
    def test_trigger_ignores_queue_and_follows_task_routes(self, mock_send_task):
        mock_send_task.return_value = SimpleNamespace(id="queued-1")

        response = self.root.post(
            "/api/v1/admin/celery/tasks/trigger/",
            {"task": SYNC_TASK, "kwargs": {"sync_type": "trending"}, "queue": "typo-queue"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertNotIn("queue", mock_send_task.call_args.kwargs)
        row = CeleryTaskResult.objects.get(task_id=response.data["task_id"])
        self.assertEqual(mock_send_task.call_args.kwargs["task_id"], row.task_id)
        self.assertEqual(row.queue, "high_priority")  # root.celery task_routes
        audit = AuditLog.objects.get(action=AuditLog.ActionType.TRIGGER)
        self.assertEqual((audit.user, audit.entity_repr), (self.superuser, SYNC_TASK))

    @patch("apps.core.services.celery_admin_service.current_app.send_task")
    def test_trigger_failure_does_not_echo_the_exception(self, mock_send_task):
        mock_send_task.side_effect = RuntimeError("redis://:secret@broker:6379 refused")

        response = self.root.post(
            "/api/v1/admin/celery/tasks/trigger/",
            {"task": SYNC_TASK, "kwargs": {"sync_type": "trending"}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertNotIn("secret", str(response.data))
        self.assertFalse(AuditLog.objects.exists())

    @patch("apps.core.services.celery_admin_service.current_app.control.revoke")
    def test_revoke_is_audited(self, mock_revoke):
        CeleryTaskResult.objects.create(task_id="task-9", task_name=SYNC_TASK)

        response = self.root.post(
            "/api/v1/admin/celery/tasks/control/",
            {"task_id": "task-9", "action": "revoke", "terminate": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_revoke.assert_called_once_with("task-9", terminate=True)
        self.assertEqual(CeleryTaskResult.objects.get(task_id="task-9").status, "REVOKED")
        self.assertEqual(AuditLog.objects.get().action, AuditLog.ActionType.CONTROL)

    def test_removed_celery_routes_are_gone(self):
        for url in (
            "/api/v1/admin/celery/dashboard/",
            "/api/v1/admin/celery/workers/",
            "/api/v1/admin/celery/workers/control/",
            "/api/v1/admin/celery/tasks/schedules/",
            "/api/v1/admin/celery/tasks/results/stats/",
        ):
            with self.subTest(url=url):
                get = self.root.get(url)
                post = self.root.post(url, {"action": "shutdown"}, format="json")
                self.assertIn(get.status_code, (404, 405))
                self.assertIn(post.status_code, (404, 405))

    def test_bulk_delete_validates_ids_and_is_audited(self):
        rows = [
            CeleryTaskResult.objects.create(task_id=f"t-{index}", task_name=SYNC_TASK)
            for index in range(3)
        ]

        bad = self.root.post(
            "/api/v1/admin/celery/tasks/results/bulk_delete/", {"ids": ["x"]}, format="json"
        )
        good = self.root.post(
            "/api/v1/admin/celery/tasks/results/bulk_delete/",
            {"ids": [rows[0].id, rows[1].id]},
            format="json",
        )

        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(good.status_code, status.HTTP_200_OK)
        self.assertEqual(good.data["deleted"], 2)
        self.assertEqual(AuditLog.objects.get().action, AuditLog.ActionType.BULK_ACTION)
