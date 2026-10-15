import ipaddress
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from ..models import PushSubscription
from ..services.push_service import PushService
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


class PushPayloadTests(APITestCase):
    @patch("apps.core.services.push_service.webpush")
    def test_payload_is_valid_json_with_apostrophes_and_booleans(self, mock_webpush):
        user = User.objects.create_user(username="json", email="j@example.com", password="x")
        subscription = PushSubscription.objects.create(
            user=user, endpoint=FCM, p256dh="k", auth="a", is_active=True
        )

        PushService.send_push_notification(
            subscription, "JoJo's Bizarre Adventure", "It's out", {"spoiler": True, "x": None}
        )

        payload = json.loads(mock_webpush.call_args.kwargs["data"])
        self.assertEqual(payload["title"], "JoJo's Bizarre Adventure")
        self.assertEqual(payload["data"], {"spoiler": True, "x": None})
