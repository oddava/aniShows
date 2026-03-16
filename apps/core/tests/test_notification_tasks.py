from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.core.models import Notification
from apps.core.tasks.notifications import send_pending_notifications

User = get_user_model()


class TestSendPendingNotifications(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="notif_task_user",
            email="notif-task@example.com",
            password="password123",
        )

    @patch("apps.core.tasks.notifications.send_email_task.delay")
    @patch("apps.core.tasks.notifications.PushService.send_to_user")
    def test_push_notifications_are_not_resent_on_subsequent_runs(
        self, mock_send_push, mock_send_email
    ):
        mock_send_push.return_value = 1
        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_FOLLOWER,
            title="New Follower",
            message="Someone followed you",
            is_email_sent=False,
            is_push_sent=False,
        )

        send_pending_notifications()
        notification.refresh_from_db()
        self.assertTrue(notification.is_push_sent)
        self.assertTrue(notification.is_email_sent)
        self.assertEqual(mock_send_push.call_count, 1)
        self.assertEqual(mock_send_email.call_count, 0)

        # Running the task again should not re-send.
        send_pending_notifications()
        self.assertEqual(mock_send_push.call_count, 1)
        self.assertEqual(mock_send_email.call_count, 0)

