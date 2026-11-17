"""With the cache (Redis) down, credential and mail endpoints fail closed cleanly.

Login, sign-up, password reset (and the other limits that guard credentials or
mail) cannot count attempts without Redis, so they refuse with a 503, the
usual JSON error envelope and ``Retry-After``: never a 500, never unlimited
guessing. Throttles that only smooth load keep failing open.
"""

from contextlib import ExitStack
from typing import Any
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from redis.exceptions import ConnectionError as RedisConnectionError
from rest_framework import status
from rest_framework.test import APITestCase

from apps.shared import throttling as shared_throttling
from apps.users import throttling

User = get_user_model()

XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}
CACHE_METHODS = ("get", "get_many", "set", "add", "delete", "incr", "decr")


class CacheOutageMixin:
    def setUp(self):
        super().setUp()  # type: ignore[misc]
        # warn_cache_outage logs once a minute per source; start each test fresh.
        shared_throttling._last_outage_log.clear()

    def cache_down(self) -> ExitStack:
        stack = ExitStack()
        down = RedisConnectionError("cache down")
        for method in CACHE_METHODS:
            stack.enter_context(patch.object(cache, method, side_effect=down))
        return stack


class AuthEndpointsFailClosedTests(CacheOutageMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="outage", email="outage@example.com", password="securepass123"
        )

    def _assert_refused(self, response):
        self.assertEqual(
            response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE, response.content
        )
        self.assertEqual(response["Content-Type"], "application/json")
        body = response.json()
        self.assertEqual(body["code"], "rate_limit_unavailable")
        self.assertTrue(body["detail"])
        self.assertEqual(response["Retry-After"], "30")

    def test_login_register_and_password_reset_answer_503_with_retry_after(self):
        requests = {
            "login": (
                reverse("token_obtain_pair"),
                {"username": "outage", "password": "securepass123"},
            ),
            "register": (
                reverse("register"),
                {
                    "username": "newcomer",
                    "email": "newcomer@example.com",
                    "password": "Str0ng-pass-phrase",
                    "password2": "Str0ng-pass-phrase",
                },
            ),
            "password reset": (reverse("password_reset"), {"email": "outage@example.com"}),
            "password reset confirm": (
                reverse("password_reset_confirm"),
                {"uid": "x", "token": "y", "new_password": "Str0ng-pass-phrase"},
            ),
            "resend verification": (
                reverse("resend_verification"),
                {"email": "outage@example.com"},
            ),
        }
        for name, (url, payload) in requests.items():
            with self.subTest(endpoint=name), self.cache_down():
                self._assert_refused(self.client.post(url, payload, format="json", **XHR))
        self.assertFalse(User.objects.filter(username="newcomer").exists())

    def test_the_outage_is_logged_as_a_warning(self):
        # Test settings disable logging, so the logger itself is checked.
        with self.cache_down(), patch.object(shared_throttling, "logger") as logger:
            response = self.client.post(
                reverse("token_obtain_pair"),
                {"username": "outage", "password": "securepass123"},
                format="json",
                **XHR,
            )
        self._assert_refused(response)
        messages = [call.args[0] % call.args[1:] for call in logger.warning.call_args_list]
        self.assertTrue(
            any("LoginRateThrottle" in m and "fails closed" in m for m in messages),
            messages,
        )

    def test_the_identifier_lock_fails_closed_on_its_own(self):
        """The per-IP limit answered, then the cache failed: still a 503, no password check."""
        with (
            patch.object(
                throttling.LoginIdentifierThrottle,
                "begin_attempt",
                side_effect=RedisConnectionError("cache down"),
            ),
            patch(
                "apps.users.views.auth.TokenObtainPairView.post",
                side_effect=AssertionError("the password must not be checked"),
            ),
        ):
            response = self.client.post(
                reverse("token_obtain_pair"),
                {"username": "outage", "password": "securepass123"},
                format="json",
                **XHR,
            )
        self._assert_refused(response)

    def test_a_cache_failure_after_a_good_login_still_signs_in(self):
        """Releasing the slot is best effort: the login itself succeeded."""
        with patch.object(
            throttling.LoginIdentifierThrottle,
            "release_attempt",
            side_effect=RedisConnectionError("cache down"),
        ):
            response = self.client.post(
                reverse("token_obtain_pair"),
                {"username": "outage", "password": "securepass123"},
                format="json",
                **XHR,
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        self.assertIn("access", response.json())

    def test_change_email_fails_closed_for_a_signed_in_user(self):
        self.client.force_authenticate(self.user)
        with self.cache_down():
            response = self.client.post(
                reverse("change_email"),
                {"new_email": "else@example.com", "password": "securepass123"},
                format="json",
            )
        self._assert_refused(response)

    def test_with_the_cache_up_login_works(self):
        response = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "outage", "password": "securepass123"},
            format="json",
            **XHR,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)


class ThrottleClassPolicyTests(CacheOutageMixin, APITestCase):
    """Each throttle class picks a side explicitly; security limits fail closed."""

    FAIL_CLOSED = {
        "LoginRateThrottle",
        "RegisterRateThrottle",
        "PasswordResetRateThrottle",
        "ResendVerificationRateThrottle",
        "StrictUserRateThrottle",
        "ChangeEmailRateThrottle",
    }

    def test_every_throttle_class_has_a_cache_outage_policy(self):
        from rest_framework.throttling import SimpleRateThrottle

        classes = {
            name: value
            for name, value in vars(throttling).items()
            if isinstance(value, type)
            and issubclass(value, SimpleRateThrottle)
            and value.__module__ == throttling.__name__
        }
        self.assertTrue(classes)
        for name, throttle_class in classes.items():
            with self.subTest(throttle=name):
                if name in self.FAIL_CLOSED:
                    self.assertTrue(
                        issubclass(throttle_class, shared_throttling.FailClosedOnCacheErrors)
                    )
                else:
                    self.assertTrue(
                        issubclass(throttle_class, shared_throttling.FailOpenOnCacheErrors)
                    )

    def test_a_load_throttle_lets_requests_through(self):
        from django.contrib.auth.models import AnonymousUser
        from rest_framework.test import APIRequestFactory
        from rest_framework.views import APIView

        request = APIRequestFactory().get("/api/v1/anime/", REMOTE_ADDR="198.51.100.9")
        request.user = AnonymousUser()
        with self.cache_down():
            self.assertTrue(
                throttling.PublicAnimeListRateThrottle().allow_request(request, APIView())
            )
