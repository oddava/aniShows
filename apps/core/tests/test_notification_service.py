from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from unittest.mock import Mock, patch
from allauth.socialaccount.models import SocialAccount

from apps.core.models import Notification
from apps.core.services.notification_service import NotificationService
from apps.users.models import UserProfile

User = get_user_model()


class TestNotificationUnreadCountCache(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="notif_user",
            email="notif@example.com",
            password="password123",
        )

    def test_get_unread_count_populates_cache(self):
        count = NotificationService.get_unread_count_for_user_id(self.user.id)
        self.assertEqual(count, 0)

        cache_key = NotificationService._unread_count_cache_key(self.user.id)
        self.assertEqual(int(cache.get(cache_key)), 0)

    def test_mark_as_read_updates_cached_counter(self):
        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test",
            message="Message",
        )

        self.assertEqual(NotificationService.get_unread_count(self.user), 1)
        self.assertTrue(NotificationService.mark_as_read(notification.id, self.user))
        self.assertEqual(NotificationService.get_unread_count(self.user), 0)

    def test_mark_all_as_read_resets_cache(self):
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test 1",
            message="Message 1",
        )
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test 2",
            message="Message 2",
        )

        self.assertEqual(NotificationService.get_unread_count(self.user), 2)
        self.assertEqual(NotificationService.mark_all_as_read(self.user), 2)
        self.assertEqual(NotificationService.get_unread_count(self.user), 0)

    @patch("apps.core.services.notification_service.async_to_sync")
    @patch("apps.core.services.notification_service.get_channel_layer")
    def test_mark_as_read_broadcasts_unread_count_update(self, mock_get_channel_layer, mock_async_to_sync):
        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test",
            message="Message",
        )
        mock_layer = Mock()
        mock_get_channel_layer.return_value = mock_layer
        mock_sender = Mock()
        mock_async_to_sync.return_value = mock_sender

        self.assertTrue(NotificationService.mark_as_read(notification.id, self.user))

        mock_sender.assert_called_with(
            f"notifications_user_{self.user.id}",
            {"type": "notification.count_update", "count": 0},
        )

    def test_new_follower_notification_uses_google_avatar_fallback(self):
        follower = User.objects.create_user(
            username="notJony",
            email="notjony@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=follower, defaults={"email_verified": True})
        google_avatar = "https://lh3.googleusercontent.com/a/notjony-notif=s96-c"
        SocialAccount.objects.create(
            user=follower,
            provider="google",
            uid="google-notjony-notif",
            extra_data={"picture": google_avatar},
        )

        notification = NotificationService.create_new_follower_notification(self.user, follower)

        self.assertIsNotNone(notification)
        self.assertEqual(notification.data["follower_avatar"], google_avatar)

    @patch("apps.core.services.notification_service.async_to_sync")
    @patch("apps.core.services.notification_service.get_channel_layer")
    def test_mark_all_as_read_broadcasts_unread_count_update(self, mock_get_channel_layer, mock_async_to_sync):
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test 1",
            message="Message 1",
        )
        mock_layer = Mock()
        mock_get_channel_layer.return_value = mock_layer
        mock_sender = Mock()
        mock_async_to_sync.return_value = mock_sender

        NotificationService.mark_all_as_read(self.user)

        mock_sender.assert_called_with(
            f"notifications_user_{self.user.id}",
            {"type": "notification.count_update", "count": 0},
        )
