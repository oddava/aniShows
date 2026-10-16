from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from ..models import UserProfile

User = get_user_model()


class UserActivityTrackingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="active", email="active@example.com", password="securepass123"
        )

    def _last_activity(self):
        return UserProfile.objects.get(user=self.user).last_activity

    def test_jwt_request_records_last_activity(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")

        response = self.client.get(reverse("user_profile"))

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(self._last_activity())

    def test_anonymous_and_failed_requests_are_not_activity(self):
        self.client.get(reverse("user_profile"))
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
        self.client.get(reverse("user_profile"))

        self.assertIsNone(self._last_activity())
