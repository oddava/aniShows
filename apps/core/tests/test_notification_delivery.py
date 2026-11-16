from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail, signing
from django.core.cache import cache
from django.test import TestCase, override_settings

from ..models import Notification, PushSubscription
from ..services import notification_delivery
from ..services.notification_email import (
    build_episode_email,
    make_unsubscribe_token,
    read_unsubscribe_token,
)

User = get_user_model()
TYPES = Notification.NotificationType
EMAIL = "apps.users.services.email_service.send_email_task.delay"


# These tests cover email delivery, so their users have episode emails on
# (D-4 makes them opt-in for new users; see test_notification_preferences).
@override_settings(FRONTEND_URL="https://anishows.example", NEW_USER_EMAIL_EPISODES=True)
class EpisodeEmailTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("viewer", "viewer@example.com", "pw-123456")
        profile = self.user.userprofile
        profile.email_verified = True
        profile.save(update_fields=["email_verified"])

    def _episode_row(self, **data):
        return Notification.objects.create(
            user=self.user,
            notification_type=TYPES.NEW_EPISODE,
            title="New Episode",
            message=data.pop("message", "Episode 3 of <script>alert(1)</script> aired."),
            data={"anime_slug": "show", **data},
            is_push_sent=True,
            is_email_sent=False,
        )

    @patch(EMAIL)
    def test_verified_active_user_gets_one_email_with_unsubscribe_headers(self, send):
        notification = self._episode_row()
        notification_delivery.deliver([notification.pk])
        notification_delivery.deliver([notification.pk])

        send.assert_called_once()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["recipient_list"], ["viewer@example.com"])
        self.assertIn("List-Unsubscribe", kwargs["headers"])
        self.assertTrue(
            kwargs["headers"]["List-Unsubscribe"].startswith("<https://anishows.example/api/v1/")
        )
        self.assertEqual(kwargs["headers"]["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click")

    @patch(EMAIL)
    def test_unverified_or_inactive_users_get_no_email(self, send):
        profile = self.user.userprofile
        profile.email_verified = False
        profile.save(update_fields=["email_verified"])
        notification_delivery.deliver([self._episode_row().pk])

        profile.email_verified = True
        profile.save(update_fields=["email_verified"])
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        notification_delivery.deliver([self._episode_row().pk])

        send.assert_not_called()
        self.assertFalse(Notification.objects.filter(is_email_sent=False).exists())

    @patch(EMAIL)
    def test_email_turned_off_after_notify_is_not_sent(self, send):
        from ..services import notification_preferences

        notification_preferences.update_preferences(self.user.pk, {"episodes": {"email": False}})
        notification_delivery.deliver([self._episode_row().pk])
        send.assert_not_called()

    def test_html_is_escaped_and_has_both_parts(self):
        email = build_episode_email(self._episode_row())
        self.assertNotIn("<script>", email["html_message"])
        self.assertIn("&lt;script&gt;", email["html_message"])
        self.assertIn("<script>", email["message"])  # plain text is plain text
        self.assertIn("https://anishows.example/settings?tab=notifications", email["html_message"])
        self.assertIn("https://anishows.example/notifications/unsubscribe?token=", email["message"])
        self.assertIn("https://anishows.example/anime/show", email["html_message"])

    def test_email_goes_through_the_email_task_end_to_end(self):
        # Eager Celery + locmem backend in tests: nothing leaves the process.
        notification_delivery.deliver([self._episode_row().pk])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["viewer@example.com"])
        self.assertIn("List-Unsubscribe", mail.outbox[0].extra_headers)

    def test_unsubscribe_tokens_round_trip_and_reject_tampering(self):
        token = make_unsubscribe_token(self.user.pk)
        self.assertEqual(read_unsubscribe_token(token), (self.user.pk, "episodes"))
        with self.assertRaises(signing.BadSignature):
            read_unsubscribe_token(token + "x")
        forged = signing.dumps(
            {"u": self.user.pk, "c": "likes"}, salt="core.notifications.email-unsubscribe"
        )
        with self.assertRaises(signing.BadSignature):
            read_unsubscribe_token(forged)


class PushDeliveryGatingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("pushy", "pushy@example.com", "pw-123456")
        PushSubscription.objects.create(
            user=self.user, endpoint="https://push.example.com/a", p256dh="k", auth="a"
        )
        self.notification = Notification.objects.create(
            user=self.user,
            notification_type=TYPES.NEW_FOLLOWER,
            title="t",
            message="m",
            is_push_sent=False,
            is_email_sent=True,
        )

    @override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="")
    @patch("apps.core.services.push_service.webpush")
    def test_nothing_is_sent_or_retried_without_vapid_keys(self, webpush):
        notification_delivery.deliver([self.notification.pk])
        webpush.assert_not_called()
        self.notification.refresh_from_db()
        self.assertTrue(self.notification.is_push_sent)

    @override_settings(VAPID_PUBLIC_KEY="pub", VAPID_PRIVATE_KEY="priv")
    def test_enqueue_survives_a_broker_outage(self):
        with patch(
            "apps.core.tasks.notifications.deliver_notifications.delay",
            side_effect=ConnectionError("broker down"),
        ):
            notification_delivery.enqueue_delivery([self.notification.pk])  # no exception
