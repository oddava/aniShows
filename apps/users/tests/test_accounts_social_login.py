"""Google login: JWT only, no Django session left behind (A05, D-1)."""

from typing import Any, cast
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import SESSION_KEY, get_user_model
from django.contrib.auth import login as django_login
from django.contrib.auth.tokens import default_token_generator
from django.test import SimpleTestCase
from django.urls import reverse
from django.utils.module_loading import import_string
from rest_framework import status
from rest_framework.test import APITestCase

from root.settings.features.accounts import _authentication_classes

from ..auth_cookies import REFRESH_COOKIE_NAME
from ..serializers.social_auth import SocialLoginSerializer
from ..tokens import email_verification_token_generator
from ..views.users import UserProfileView

User = get_user_model()

# Any-valued so mypy does not map it onto APIClient.post(follow: bool).
XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}
GOOGLE_URL = "/api/v1/auth/google/"  # not reverse(): allauth registers the same name
JWT = "rest_framework_simplejwt.authentication.JWTAuthentication"
SESSION = "rest_framework.authentication.SessionAuthentication"


class GoogleLoginSessionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="googler", email="googler@example.com", password=None
        )

    def _validate_like_allauth(self):
        user = self.user

        def validate(serializer, attrs):
            # allauth's complete_social_login performs a Django session login.
            request = serializer.context["request"]._request
            django_login(request, user, backend="django.contrib.auth.backends.ModelBackend")
            attrs["user"] = user
            return attrs

        return patch.object(SocialLoginSerializer, "validate", autospec=True, side_effect=validate)

    def test_google_login_leaves_no_django_session(self):
        with self._validate_like_allauth():
            response = self.client.post(GOOGLE_URL, {"code": "abc"}, format="json", **XHR)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertTrue(response.cookies[REFRESH_COOKIE_NAME].value)
        session_cookie = response.cookies.get(settings.SESSION_COOKIE_NAME)
        self.assertTrue(session_cookie is None or not session_cookie.value)
        self.assertNotIn(SESSION_KEY, self.client.session)

    def test_after_logout_cookies_alone_do_not_authenticate(self):
        with self._validate_like_allauth():
            self.client.post(GOOGLE_URL, {"code": "abc"}, format="json", **XHR)
        self.client.post(reverse("token_logout"), **XHR)

        response = self.client.get(reverse("user_profile"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_ends_an_existing_django_session(self):
        self.client.force_login(self.user)
        self.assertIn(SESSION_KEY, self.client.session)

        response = self.client.post(reverse("token_logout"), **XHR)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertNotIn(SESSION_KEY, self.client.session)

    def test_a_dead_refresh_cookie_also_ends_the_django_session(self):
        self.client.force_login(self.user)
        self.client.cookies[REFRESH_COOKIE_NAME] = "not-a-token"

        response = self.client.post(reverse("token_refresh"), **XHR)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn(SESSION_KEY, self.client.session)


class SessionAuthFlagTests(SimpleTestCase):
    """API_SESSION_AUTH_ENABLED switches DRF's SessionAuthentication (D-1)."""

    def test_enabled_keeps_todays_classes(self):
        self.assertEqual(
            _authentication_classes([JWT, SESSION], session_enabled=True), [JWT, SESSION]
        )
        self.assertEqual(_authentication_classes([JWT], session_enabled=True), [JWT, SESSION])

    def test_disabled_drops_session_authentication(self):
        self.assertEqual(_authentication_classes([JWT, SESSION], session_enabled=False), [JWT])

    def test_default_is_on(self):
        self.assertTrue(settings.API_SESSION_AUTH_ENABLED)
        self.assertIn(
            SESSION, cast("list[str]", settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"])
        )


class SessionAuthFlagBehaviourTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="sessioned", email="sessioned@example.com", password="securepass123"
        )
        self.client.force_login(self.user)

    def test_session_cookie_authenticates_while_the_flag_is_on(self):
        self.assertEqual(self.client.get(reverse("user_profile")).status_code, status.HTTP_200_OK)

    def test_session_cookie_is_ignored_when_the_flag_is_off(self):
        # DRF binds APIView.authentication_classes at import, so the flag acts at
        # process start; apply the flag-off list to the view the same way.
        classes = [
            import_string(name)
            for name in _authentication_classes(
                cast("list[str]", settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]),
                session_enabled=False,
            )
        ]
        with patch.object(UserProfileView, "authentication_classes", classes):
            response = self.client.get(reverse("user_profile"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class LastLoginTests(APITestCase):
    """UPDATE_LAST_LOGIN (A33): a sign-in retires older reset links, not verify links."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="returning", email="returning@example.com", password="securepass123"
        )

    def _login(self):
        response = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "returning", "password": "securepass123"},
            format="json",
            **XHR,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()

    def test_login_updates_last_login_and_retires_reset_links(self):
        reset_token = default_token_generator.make_token(self.user)
        self.assertIsNone(self.user.last_login)

        self._login()

        self.assertIsNotNone(self.user.last_login)
        self.assertFalse(default_token_generator.check_token(self.user, reset_token))

    def test_login_before_verifying_keeps_the_verification_link_valid(self):
        verify_token = email_verification_token_generator.make_token(self.user)

        self._login()

        self.assertTrue(email_verification_token_generator.check_token(self.user, verify_token))


class GoogleCodeFlowOnlyTests(APITestCase):
    """A raw provider token from the client is never accepted (A07)."""

    def test_access_token_without_code_is_400_code_required(self):
        for body in (
            {"access_token": "ya29.token-minted-for-another-app"},
            {"id_token": "eyJ..."},
            {"access_token": "ya29.x", "code": ""},
            {"code": 5},
            {},
        ):
            with self.subTest(body=body):
                response = self.client.post(GOOGLE_URL, body, format="json", **XHR)
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(response.data["code"], "code_required")

    def test_serializer_has_no_token_fields(self):
        fields = SocialLoginSerializer().fields
        self.assertEqual(set(fields), {"code"})
        self.assertTrue(fields["code"].required)


class LoginCsrfTests(APITestCase):
    """Login-style endpoints set the refresh cookie, so they need the CSRF check (A08)."""

    def setUp(self):
        User.objects.create_user(username="victim", email="v@example.com", password="pw-12345678")

    def _assert_rejected(self, url, body, **headers):
        response = self.client.post(url, body, format="json", **headers)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "csrf_failed")
        self.assertNotIn(REFRESH_COOKIE_NAME, response.cookies)

    def test_endpoints_reject_a_missing_header_and_a_foreign_origin(self):
        cases: tuple[tuple[str, dict[str, Any]], ...] = (
            (reverse("token_obtain_pair"), {"username": "victim", "password": "pw-12345678"}),
            (GOOGLE_URL, {"code": "abc"}),
            ("/api/v1/verify-email/MQ/token/", {}),
        )
        for url, body in cases:
            with self.subTest(url=url, case="no header"):
                self._assert_rejected(url, body)
            with self.subTest(url=url, case="foreign origin"):
                self._assert_rejected(url, body, HTTP_ORIGIN="https://evil.example", **XHR)

    def test_form_encoded_cross_site_post_is_rejected(self):
        response = self.client.post(
            reverse("token_obtain_pair"), {"username": "victim", "password": "pw-12345678"}
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_same_origin_login_with_the_header_still_works(self):
        response = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "victim", "password": "pw-12345678"},
            format="json",
            HTTP_ORIGIN="http://testserver",
            **XHR,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class GoogleBadBodyTests(APITestCase):
    def test_a_json_array_body_is_400_not_500(self):
        response = self.client.post(GOOGLE_URL, ["code"], format="json", **XHR)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "code_required")
