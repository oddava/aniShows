import base64
import ipaddress
import json
from datetime import timedelta
from unittest.mock import patch

import requests  # type: ignore[import-untyped, unused-ignore]
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from pywebpush import WebPushException
from rest_framework.test import APITestCase

from ..models import Notification, PushSubscription
from ..services.push_service import PushResult, PushService, build_payload
from ..services.url_validator import URLValidator

User = get_user_model()

FCM = "https://fcm.googleapis.com/fcm/send/abc123"


class PushSubscriptionEndpointTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="pusher", email="p@example.com", password="x")
        self.client.force_authenticate(user=self.user)

    def _subscribe(self, endpoint):
        return self.client.post(
            reverse("push_subscribe"),
            {"endpoint": endpoint, "p256dh": "key", "auth": "auth"},
            format="json",
        )

    def test_internal_and_plaintext_endpoints_are_rejected(self):
        """The worker POSTs to the endpoint, so it must not reach internal hosts."""
        with patch.object(URLValidator, "_resolve_public_ips", return_value=[]):
            for endpoint in (
                "http://fcm.googleapis.com/fcm/send/x",
                "https://169.254.169.254/latest/meta-data/",
                "https://minio:9000/anishows-media/",
            ):
                with self.subTest(endpoint=endpoint):
                    self.assertEqual(self._subscribe(endpoint).status_code, 400)
        self.assertFalse(PushSubscription.objects.exists())

    def test_public_https_endpoint_is_stored_verbatim(self):
        public = [ipaddress.ip_address("142.250.1.1")]
        with patch.object(URLValidator, "_resolve_public_ips", return_value=public):
            response = self._subscribe(FCM)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(PushSubscription.objects.get().endpoint, FCM)


def _http_error(status):
    response = requests.Response()
    response.status_code = status
    return WebPushException(f"Push failed: {status}", response=response)


@override_settings(VAPID_PUBLIC_KEY="pub", VAPID_PRIVATE_KEY="priv")
class PushTransportTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="json", email="j@example.com", password="x")
        self.subscription = PushSubscription.objects.create(
            user=self.user, endpoint=FCM, p256dh="k", auth="a", is_active=True
        )
        self.notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
            title="JoJo's Bizarre Adventure",
            message="It's out " + "x" * 2000,
            data={"anime_id": 7, "anime_slug": "jojo"},
        )

    def _send(self):
        return PushService.send_notification(self.notification, unread_count=3)

    @patch("apps.core.services.push_service.webpush")
    def test_payload_v1_is_small_json_with_a_same_origin_url(self, mock_webpush):
        self.assertIs(self._send(), PushResult.SENT)

        raw = mock_webpush.call_args.kwargs["data"]
        self.assertLessEqual(len(raw.encode()), 1024)
        payload = json.loads(raw)
        self.assertEqual(payload["v"], 1)
        self.assertEqual(payload["title"], "JoJo's Bizarre Adventure")
        self.assertLessEqual(len(payload["body"]), 180)
        self.assertEqual(payload["url"], "/anime/jojo")
        self.assertEqual(payload["notification_id"], self.notification.pk)
        self.assertEqual(payload["unread_count"], 3)
        self.assertEqual(payload["tag"], "ep7")

    @patch("apps.core.services.push_service.webpush")
    def test_ttl_timeout_urgency_and_topic_are_passed(self, mock_webpush):
        self._send()
        kwargs = mock_webpush.call_args.kwargs
        self.assertEqual(kwargs["ttl"], 86400)
        self.assertEqual(kwargs["timeout"], 10)
        self.assertEqual(kwargs["headers"], {"Urgency": "normal", "Topic": "ep7"})
        self.subscription.refresh_from_db()
        self.assertIsNotNone(self.subscription.last_used)

    def _failing_for(self, hours):
        PushSubscription.objects.filter(pk=self.subscription.pk).update(
            failing_since=timezone.now() - timedelta(hours=hours)
        )

    @patch("apps.core.services.push_service.webpush")
    def test_gone_endpoints_are_deactivated_at_once(self, mock_webpush):
        for status in (410, 404):
            with self.subTest(status=status):
                PushSubscription.objects.filter(pk=self.subscription.pk).update(is_active=True)
                mock_webpush.side_effect = _http_error(status)
                self.assertIs(self._send(), PushResult.FAILED)
                self.subscription.refresh_from_db()
                self.assertFalse(self.subscription.is_active)

    @patch("apps.core.services.push_service.webpush")
    def test_rejections_are_not_retried_and_do_not_drop_a_device_at_once(self, mock_webpush):
        for status in (400, 403, 413):
            with self.subTest(status=status):
                mock_webpush.side_effect = _http_error(status)
                self.assertIs(self._send(), PushResult.FAILED)
                self.subscription.refresh_from_db()
                self.assertTrue(self.subscription.is_active)
        self.assertEqual(self.subscription.failure_count, 2)  # 413 is the payload's fault

    @patch("apps.core.services.push_service.webpush")
    def test_a_burst_of_429s_never_drops_a_device_however_rarely_used(self, mock_webpush):
        PushSubscription.objects.filter(pk=self.subscription.pk).update(
            last_used=timezone.now() - timedelta(days=30)
        )
        mock_webpush.side_effect = _http_error(429)
        for _ in range(8):
            self.assertIs(self._send(), PushResult.RETRY)
        self.subscription.refresh_from_db()
        self.assertTrue(self.subscription.is_active)
        self.assertEqual(self.subscription.failure_count, 8)

    @patch("apps.core.services.push_service.webpush")
    def test_a_device_failing_for_over_a_day_is_dropped_after_five(self, mock_webpush):
        mock_webpush.side_effect = _http_error(429)
        self.assertIs(self._send(), PushResult.RETRY)
        self._failing_for(hours=25)
        for attempt in range(2, 5):
            self.assertIs(self._send(), PushResult.RETRY)
            self.subscription.refresh_from_db()
            self.assertEqual(self.subscription.failure_count, attempt)
            self.assertTrue(self.subscription.is_active)
        self.assertIs(self._send(), PushResult.FAILED)
        self.subscription.refresh_from_db()
        self.assertFalse(self.subscription.is_active)

    @patch("apps.core.services.push_service.webpush")
    def test_timeouts_and_5xx_are_transient_and_success_resets_the_count(self, mock_webpush):
        mock_webpush.side_effect = requests.Timeout()
        self.assertIs(self._send(), PushResult.RETRY)
        mock_webpush.side_effect = _http_error(503)
        self.assertIs(self._send(), PushResult.RETRY)
        mock_webpush.side_effect = None
        self.assertIs(self._send(), PushResult.SENT)
        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.failure_count, 0)
        self.assertIsNone(self.subscription.failing_since)

    @override_settings(VAPID_SUBJECT="", DEFAULT_FROM_EMAIL="AniShows <hello@anishows.example>")
    def test_vapid_sub_is_parsed_from_a_display_name_address(self):
        self.assertEqual(PushService.get_vapid_claims(), {"sub": "mailto:hello@anishows.example"})

    @override_settings(VAPID_SUBJECT="mailto:ops@anishows.example")
    def test_vapid_subject_setting_wins(self):
        self.assertEqual(PushService.get_vapid_claims(), {"sub": "mailto:ops@anishows.example"})

    def test_payload_falls_back_when_the_url_is_huge(self):
        self.notification.data = {"anime_id": 7, "anime_slug": "a" * 2000}
        payload = json.loads(build_payload(self.notification, unread_count=0))
        self.assertEqual(payload["url"], "/notifications")

    def test_multibyte_text_is_trimmed_to_the_byte_budget(self):
        self.notification.title = "🎉" * 300
        self.notification.message = "日本語🎌" * 400
        raw = build_payload(self.notification, unread_count=1)
        self.assertLessEqual(len(raw.encode()), 1024)
        payload = json.loads(raw)
        self.assertTrue(payload["title"])
        self.assertEqual(payload["url"], "/anime/jojo")

    @override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="")
    def test_not_configured_without_keys(self):
        self.assertFalse(PushService.is_configured())


class GenerateVapidKeysTests(TestCase):
    def test_prints_a_usable_key_pair(self):
        from io import StringIO

        from django.core.management import call_command
        from py_vapid import Vapid

        def b64urldecode(value: str) -> bytes:
            return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

        out = StringIO()
        call_command("generate_vapid_keys", stdout=out)
        lines = dict(
            line.split("=", 1) for line in out.getvalue().splitlines() if line.startswith("VAPID_")
        )
        public = b64urldecode(lines["VAPID_PUBLIC_KEY"])
        self.assertEqual(len(public), 65)  # uncompressed P-256 point
        self.assertEqual(public[0], 4)
        private = lines["VAPID_PRIVATE_KEY"]
        self.assertEqual(len(b64urldecode(private)), 32)
        # pywebpush reads the private key in exactly this form.
        self.assertIsNotNone(Vapid.from_string(private).private_key)
