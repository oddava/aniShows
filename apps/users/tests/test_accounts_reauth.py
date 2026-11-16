"""Re-auth for passwordless accounts and security notices (A06, A32)."""

import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth import login as django_login
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import AccessToken

from ..auth_cookies import REFRESH_COOKIE_NAME
from ..serializers.social_auth import SocialLoginSerializer
from ..services.auth_service import REAUTH_MAX_AGE_SECONDS, issue_refresh_token
from ..services.email_service import mask_email
from ..tokens import EmailChangeTokenGenerator

User = get_user_model()

XHR = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


def _bearer(user, *, age_seconds):
    refresh = issue_refresh_token(user, auth_time=int(time.time()) - age_seconds)
    return {"HTTP_AUTHORIZATION": f"Bearer {refresh.access_token}"}


class AuthTimeClaimTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="timed", email="timed@example.com", password="securepass123"
        )

    def test_password_login_and_refresh_carry_the_same_auth_time(self):
        before = int(time.time())
        login = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "timed", "password": "securepass123"},
            format="json",
            **XHR,
        )
        auth_time = AccessToken(login.data["access"])["auth_time"]
        self.assertGreaterEqual(auth_time, before)

        refreshed = self.client.post(reverse("token_refresh"), **XHR)
        self.assertEqual(refreshed.status_code, status.HTTP_200_OK)
        self.assertEqual(AccessToken(refreshed.data["access"])["auth_time"], auth_time)

    def test_google_login_carries_auth_time(self):
        user = self.user

        def validate(serializer, attrs):
            request = serializer.context["request"]._request
            django_login(request, user, backend="django.contrib.auth.backends.ModelBackend")
            return {**attrs, "user": user}

        with patch.object(SocialLoginSerializer, "validate", autospec=True, side_effect=validate):
            response = self.client.post("/api/v1/auth/google/", {"code": "c"}, format="json", **XHR)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertAlmostEqual(
            AccessToken(response.data["access"])["auth_time"], time.time(), delta=5
        )


class PasswordlessReauthTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="googly", email="googly@example.com")
        self.user.set_unusable_password()
        self.user.save()

    def _stale(self):
        return _bearer(self.user, age_seconds=REAUTH_MAX_AGE_SECONDS + 60)

    def _fresh(self):
        return _bearer(self.user, age_seconds=30)

    def test_stale_sign_in_gets_403_reauth_required_on_every_sensitive_action(self):
        actions = (
            ("post", reverse("change_password"), {"new_password": "N3w-Passphrase!"}),
            ("post", reverse("change_email"), {"new_email": "new@example.com"}),
            ("delete", reverse("delete_account"), {}),
        )
        for method, url, body in actions:
            with self.subTest(url=url):
                response = getattr(self.client, method)(url, body, format="json", **self._stale())
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(response.data["code"], "reauth_required")
        self.user.refresh_from_db()
        self.assertFalse(self.user.has_usable_password())
        self.assertEqual(self.user.email, "googly@example.com")
        self.assertEqual(mail.outbox, [])

    def test_token_without_auth_time_counts_as_stale(self):
        token = AccessToken.for_user(self.user)  # no auth_time claim
        response = self.client.delete(
            reverse("delete_account"), {}, format="json", HTTP_AUTHORIZATION=f"Bearer {token}"
        )
        self.assertEqual(response.data["code"], "reauth_required")

    def test_fresh_sign_in_may_set_a_password(self):
        response = self.client.post(
            reverse("change_password"),
            {"new_password": "N3w-Passphrase!"},
            format="json",
            **self._fresh(),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("N3w-Passphrase!"))

    def test_fresh_sign_in_may_change_email_and_delete(self):
        response = self.client.post(
            reverse("change_email"),
            {"new_email": "new@example.com"},
            format="json",
            **self._fresh(),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.delete(reverse("delete_account"), {}, format="json", **self._fresh())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())


class PasswordAccountTests(APITestCase):
    """Accounts with a password prove themselves with it, however old the sign-in."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="classic", email="classic@example.com", password="securepass123"
        )

    def test_old_sign_in_with_the_password_is_enough(self):
        response = self.client.post(
            reverse("change_email"),
            {"new_email": "new@example.com", "password": "securepass123"},
            format="json",
            **_bearer(self.user, age_seconds=86400),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_change_password_keeps_this_device_and_its_auth_time(self):
        auth = _bearer(self.user, age_seconds=120)
        original = AccessToken(auth["HTTP_AUTHORIZATION"].split()[1])["auth_time"]
        response = self.client.post(
            reverse("change_password"),
            {"old_password": "securepass123", "new_password": "N3w-Passphrase!"},
            format="json",
            **auth,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(AccessToken(response.data["access"])["auth_time"], original)
        self.assertTrue(response.cookies[REFRESH_COOKIE_NAME].value)


class SecurityNoticeTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="noticed", email="old@example.com", password="securepass123"
        )
        self.auth = _bearer(self.user, age_seconds=10)

    def _to(self, address):
        return [message for message in mail.outbox if message.to == [address]]

    def test_email_change_request_notifies_the_current_address(self):
        self.client.post(
            reverse("change_email"),
            {"new_email": "new@example.com", "password": "securepass123"},
            format="json",
            **self.auth,
        )
        notices = self._to("old@example.com")
        self.assertEqual(len(notices), 1)
        self.assertIn(mask_email("new@example.com"), notices[0].body)
        self.assertNotIn("new@example.com", notices[0].body)
        self.assertEqual(len(self._to("new@example.com")), 1)  # the confirmation link

    def test_confirmed_change_notifies_the_old_address_and_revokes_sessions(self):
        issue_refresh_token(self.user)  # another device
        token = EmailChangeTokenGenerator("new@example.com").make_token(self.user)
        response = self.client.post(
            reverse("confirm_email_change"),
            {
                "uid": urlsafe_base64_encode(force_bytes(self.user.pk)),
                "token": token,
                "new_email": urlsafe_base64_encode(force_bytes("new@example.com")),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(self._to("old@example.com")), 1)
        live = OutstandingToken.objects.filter(user=self.user, blacklistedtoken__isnull=True)
        self.assertFalse(live.exists())

    def test_password_change_notifies(self):
        self.client.post(
            reverse("change_password"),
            {"old_password": "securepass123", "new_password": "N3w-Passphrase!"},
            format="json",
            **self.auth,
        )
        self.assertEqual(len(self._to("old@example.com")), 1)
        self.assertIn("password", mail.outbox[0].subject.lower())

    def test_password_reset_notifies(self):
        response = self.client.post(
            reverse("password_reset_confirm"),
            {
                "uid": urlsafe_base64_encode(force_bytes(self.user.pk)),
                "token": default_token_generator.make_token(self.user),
                "password": "N3w-Passphrase!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(self._to("old@example.com")), 1)

    def test_mask_email(self):
        self.assertEqual(mask_email("alice@example.com"), "a***@example.com")
        self.assertEqual(mask_email("nope"), "***")
        self.assertEqual(mask_email(""), "***")
