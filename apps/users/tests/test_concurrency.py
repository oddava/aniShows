import threading
import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from ..auth_cookies import REFRESH_COOKIE_NAME
from ..models import UserFollow, UserProfile

User = get_user_model()


class FollowToggleRaceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fan", email="f@example.com", password="x")
        self.target = User.objects.create_user(username="idol", email="i@example.com", password="x")
        UserProfile.objects.filter(user=self.user).update(email_verified=True)
        self.client.force_authenticate(user=self.user)

    def test_follow_then_unfollow(self):
        url = "/api/v1/follows/toggle/"
        first = self.client.post(url, {"username": "idol"}, format="json")
        self.assertEqual((first.status_code, first.data["is_following"]), (201, True))
        second = self.client.post(url, {"username": "idol"}, format="json")
        self.assertEqual((second.status_code, second.data["is_following"]), (200, False))

    def test_losing_a_double_click_race_reports_followed_not_500(self):
        UserFollow.objects.create(follower=self.user, following=self.target)

        with patch.object(UserFollow.objects, "get_or_create", side_effect=IntegrityError):
            response = self.client.post("/api/v1/follows/toggle/", {"username": "idol"}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["is_following"])
        self.assertTrue(UserFollow.objects.filter(follower=self.user, following=self.target).exists())


class RefreshRotationRaceTests(TransactionTestCase):
    def test_one_refresh_token_cannot_be_rotated_twice_concurrently(self):
        user = User.objects.create_user(username="tabs", email="t@example.com", password="x")
        token = str(RefreshToken.for_user(user))
        real_blacklist = RefreshToken.blacklist

        def slow_blacklist(self):
            time.sleep(0.3)  # widen the check-then-blacklist window
            return real_blacklist(self)

        statuses = []

        def refresh():
            try:
                client = APIClient()
                client.cookies[REFRESH_COOKIE_NAME] = token
                response = client.post(reverse("token_refresh"), HTTP_X_REQUESTED_WITH="XMLHttpRequest")
                statuses.append(response.status_code)
            finally:
                connection.close()

        with patch.object(RefreshToken, "blacklist", slow_blacklist):
            threads = [threading.Thread(target=refresh) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

        self.assertEqual(sorted(statuses), [200, 401])
