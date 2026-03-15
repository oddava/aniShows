from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from apps.core.models import Notification
from apps.core.services.notification_service import NotificationService

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
