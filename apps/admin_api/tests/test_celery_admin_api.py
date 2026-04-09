from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from ...core.models import CeleryTaskResult, CeleryTaskSchedule

User = get_user_model()


class CeleryAdminApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="celery-admin",
            email="celery-admin@example.com",
            password="password123",
            is_staff=True,
        )
        self.client.force_authenticate(user=self.admin)

    def test_task_result_list_uses_serialized_summary_fields(self):
        CeleryTaskResult.objects.create(
            task_id="task-1",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.FAILURE,
            error_message="x" * 300,
            triggered_by=self.admin,
        )

        response = self.client.get("/api/v1/admin/celery/tasks/results/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = response.data["results"][0]
        self.assertEqual(item["task_name_short"], "sync_anime_catalog")
        self.assertEqual(item["status_display"], "Failure")
        self.assertEqual(item["triggered_by"]["username"], self.admin.username)
        self.assertEqual(len(item["error_message"]), 200)

    @patch("apps.core.services.celery_admin_service.current_app.send_task")
    def test_run_now_creates_task_result_via_service(self, mock_send_task):
        mock_send_task.return_value = SimpleNamespace(id="queued-task-1")
        schedule = CeleryTaskSchedule.objects.create(
            name="Sync nightly",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            schedule_type=CeleryTaskSchedule.ScheduleType.CRONTAB,
            queue="default",
            status=CeleryTaskSchedule.TaskStatus.ENABLED,
        )

        response = self.client.post(f"/api/v1/admin/celery/tasks/schedules/{schedule.id}/run_now/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["task_id"], "queued-task-1")
        self.assertTrue(CeleryTaskResult.objects.filter(task_id="queued-task-1").exists())
        schedule.refresh_from_db()
        self.assertEqual(schedule.total_run_count, 1)
