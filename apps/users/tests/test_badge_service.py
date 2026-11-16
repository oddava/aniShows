"""badge_service (G5 contract) grants and revokes like the admin badge views."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from ...core.models import Notification
from ..models import Badge, UserBadge
from ..services.badge_service import MAX_FEATURED_BADGES, grant_badge, revoke_badge

User = get_user_model()


class BadgeServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("holder", "holder@example.com", "pw-123456")
        self.admin = User.objects.create_superuser("boss", "boss@example.com", "pw-123456")
        self.badge = Badge.objects.create(name="Veteran", description="Long time member")

    def test_featured_limit(self):
        self.assertEqual(MAX_FEATURED_BADGES, 3)

    def test_grant_creates_notifies_and_invalidates(self):
        with patch("apps.users.services.badge_service.invalidate_user_caches") as invalidate:
            grant = grant_badge(self.user, self.badge, granted_by=self.admin, reason="Thanks")
        assert grant is not None
        self.assertEqual((grant.granted_by, grant.reason), (self.admin, "Thanks"))
        invalidate.assert_called_once_with(
            self.user.id, self.user.username, trigger_stats_update=False
        )
        notification = Notification.objects.get(user=self.user)
        self.assertEqual(
            notification.notification_type, Notification.NotificationType.BADGE_AWARDED
        )

    def test_second_grant_is_a_no_op(self):
        grant_badge(self.user, self.badge)
        self.assertIsNone(grant_badge(self.user, self.badge))
        self.assertEqual(UserBadge.objects.count(), 1)
        self.assertEqual(Notification.objects.count(), 1)

    def test_revoke(self):
        grant_badge(self.user, self.badge)
        self.assertTrue(revoke_badge(self.user, self.badge))
        self.assertFalse(revoke_badge(self.user, self.badge))
        self.assertFalse(UserBadge.objects.exists())
