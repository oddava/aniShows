import ipaddress
from typing import cast
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from ...users.views.notifications import EmailUnsubscribeView
from ..models import Notification, PushSubscription
from ..services import notification_preferences
from ..services.notification_email import make_unsubscribe_token
from ..services.url_validator import URLValidator

User = get_user_model()
TYPES = Notification.NotificationType
PUBLIC_IP = [ipaddress.ip_address("142.250.1.1")]


def _make(user, notification_type=TYPES.NEW_FOLLOWER, **kwargs):
    return Notification.objects.create(
        user=user,
        notification_type=notification_type,
        title=kwargs.pop("title", "t"),
        message=kwargs.pop("message", "m"),
        **kwargs,
    )


class NotificationFeedApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("owner", "o@example.com", "pw-123456")
        self.other = User.objects.create_user("other", "x@example.com", "pw-123456")
        self.client.force_authenticate(self.user)

    def test_other_users_rows_are_404_on_mark_read_and_delete(self):
        foreign = _make(self.other)
        mark = reverse("notifications-mark-read", args=[foreign.pk])
        self.assertEqual(self.client.patch(mark).status_code, 404)
        self.assertEqual(
            self.client.delete(reverse("notifications-detail", args=[foreign.pk])).status_code, 404
        )
        foreign.refresh_from_db()
        self.assertFalse(foreign.is_read)

    def test_non_integer_ids_are_404_not_500(self):
        self.assertEqual(self.client.patch("/api/v1/notifications/abc/mark_read/").status_code, 404)
        self.assertEqual(self.client.delete("/api/v1/notifications/abc/").status_code, 404)

    def test_is_read_must_be_a_boolean(self):
        url = reverse("notifications-list")
        self.assertEqual(self.client.get(url, {"is_read": "maybe"}).status_code, 400)
        _make(self.user, is_read=True)
        _make(self.user)
        self.assertEqual(self.client.get(url, {"is_read": "false"}).json()["count"], 1)

    def test_category_and_comma_separated_type_filters(self):
        _make(self.user, TYPES.FORUM_REPLY)
        _make(self.user, TYPES.FORUM_MENTION)
        _make(self.user, TYPES.REVIEW_LIKE)
        _make(self.user, TYPES.NEW_EPISODE)
        url = reverse("notifications-list")

        replies = self.client.get(url, {"category": "replies"}).json()
        self.assertEqual(replies["count"], 2)
        self.assertEqual({r["category"] for r in replies["results"]}, {"replies"})
        both = self.client.get(url, {"type": "review_like,new_episode"}).json()
        self.assertEqual(both["count"], 2)
        self.assertEqual(self.client.get(url, {"category": "nope"}).status_code, 400)
        self.assertEqual(self.client.get(url, {"type": "new_episode,bogus"}).status_code, 400)

    def test_rows_carry_url_and_actor(self):
        _make(
            self.user,
            TYPES.NEW_FOLLOWER,
            actor=self.other,
            data={"follower_username": "other", "follower_id": self.other.pk},
        )
        row = self.client.get(reverse("notifications-list")).json()["results"][0]
        self.assertEqual(row["url"], "/u/other")
        self.assertEqual(row["actor"]["username"], "other")
        self.assertEqual(row["category"], "follows")

    def test_a_30_item_page_with_actors_costs_at_most_5_queries(self):
        actors = [
            User.objects.create_user(f"actor{i}", f"a{i}@example.com", "pw-123456")
            for i in range(5)
        ]
        for i in range(30):
            _make(self.user, TYPES.NEW_FOLLOWER, actor=actors[i % 5])
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(reverse("notifications-list"), {"page_size": 30})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 30)
        self.assertLessEqual(len(ctx.captured_queries), 5)


class PushApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("pusher", "p@example.com", "pw-123456")
        self.other = User.objects.create_user("other", "x@example.com", "pw-123456")
        self.client.force_authenticate(self.user)

    def _subscribe(self, endpoint, **extra):
        with patch.object(URLValidator, "_resolve_public_ips", return_value=PUBLIC_IP):
            return self.client.post(
                reverse("push_subscribe"),
                {"endpoint": endpoint, "p256dh": "key", "auth": "auth", **extra},
                format="json",
            )

    def test_push_config_reports_disabled_without_keys(self):
        with override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY=""):
            body = self.client.get(reverse("push_config")).json()
        self.assertEqual(body, {"enabled": False, "public_key": ""})
        with override_settings(VAPID_PUBLIC_KEY="pub", VAPID_PRIVATE_KEY="priv"):
            body = self.client.get(reverse("push_config")).json()
        self.assertEqual(body, {"enabled": True, "public_key": "pub"})

    def test_a_long_endpoint_subscribes(self):
        endpoint = "https://updates.push.services.mozilla.com/wpush/v2/" + "a" * 300
        response = self._subscribe(endpoint, device_info={"label": "Firefox on Linux", "x": 1})
        self.assertEqual(response.status_code, 201)
        row = PushSubscription.objects.get()
        self.assertEqual(row.endpoint, endpoint)
        self.assertEqual(row.device_info, {"label": "Firefox on Linux"})

    def test_same_endpoint_moves_to_the_last_account(self):
        endpoint = "https://fcm.googleapis.com/fcm/send/shared"
        self._subscribe(endpoint)
        self.client.force_authenticate(self.other)
        self.assertEqual(self._subscribe(endpoint).status_code, 201)
        row = PushSubscription.objects.get()
        self.assertEqual(row.user, self.other)

    def test_re_subscribing_reactivates_a_dropped_device(self):
        endpoint = "https://fcm.googleapis.com/fcm/send/again"
        self._subscribe(endpoint)
        PushSubscription.objects.update(is_active=False, failure_count=7)
        self.assertEqual(self._subscribe(endpoint).status_code, 201)
        row = PushSubscription.objects.get()
        self.assertTrue(row.is_active)
        self.assertEqual(row.failure_count, 0)

    def test_list_hides_endpoints(self):
        self._subscribe("https://fcm.googleapis.com/fcm/send/a")
        rows = self.client.get(reverse("push_subscribe")).json()
        self.assertEqual(len(rows), 1)
        self.assertNotIn("endpoint", rows[0])

    def test_unsubscribe_deletes_the_row(self):
        endpoint = "https://fcm.googleapis.com/fcm/send/a"
        self._subscribe(endpoint)
        response = self.client.delete(
            reverse("push_unsubscribe"), {"endpoint": endpoint}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(PushSubscription.objects.exists())

    def test_device_delete_is_owner_scoped(self):
        mine = PushSubscription.objects.create(
            user=self.user, endpoint="https://p.example.com/1", p256dh="k", auth="a"
        )
        theirs = PushSubscription.objects.create(
            user=self.other, endpoint="https://p.example.com/2", p256dh="k", auth="a"
        )
        url = reverse("push_subscription_detail", args=[theirs.pk])
        self.assertEqual(self.client.delete(url).status_code, 404)
        url = reverse("push_subscription_detail", args=[mine.pk])
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(list(PushSubscription.objects.values_list("pk", flat=True)), [theirs.pk])


class EmailUnsubscribeApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("mail", "m@example.com", "pw-123456")
        self.url = reverse("notification_email_unsubscribe")

    def _email_on(self):
        return notification_preferences.get_preferences(self.user.pk)["episodes"]["email"]

    def test_valid_token_in_the_query_turns_episode_email_off(self):
        token = make_unsubscribe_token(self.user.pk)
        # RFC 8058 one-click: a form POST with the token in the URL, no auth, no CSRF.
        response = self.client.post(
            f"{self.url}?token={token}", {"List-Unsubscribe": "One-Click"}, format="multipart"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "unsubscribed", "category": "episodes"})
        self.assertFalse(self._email_on())

    def test_token_in_the_body_works(self):
        token = make_unsubscribe_token(self.user.pk)
        self.assertEqual(self.client.post(self.url, {"token": token}).status_code, 200)

    def test_tampered_or_missing_tokens_are_400(self):
        token = make_unsubscribe_token(self.user.pk)
        for bad in (token[:-2] + "xx", "garbage", ""):
            with self.subTest(token=bad):
                self.assertEqual(
                    self.client.post(self.url, {"token": bad}, format="json").status_code, 400
                )
        self.assertTrue(self._email_on())

    def test_a_non_object_body_is_400_not_500(self):
        for body in ([], "x", 3):
            with self.subTest(body=body):
                self.assertEqual(self.client.post(self.url, body, format="json").status_code, 400)

    def test_get_never_unsubscribes(self):
        token = make_unsubscribe_token(self.user.pk)
        self.assertEqual(self.client.get(f"{self.url}?token={token}").status_code, 405)
        self.assertTrue(self._email_on())

    def test_view_is_throttled(self):
        self.assertIn(ScopedRateThrottle, EmailUnsubscribeView.throttle_classes)
        self.assertEqual(EmailUnsubscribeView.throttle_scope, "notification_email_unsubscribe")
        from django.conf import settings

        rates = cast("dict[str, str]", settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"])
        self.assertIn("notification_email_unsubscribe", rates)
