"""Google login: JWT only, no Django session left behind (A05, D-1)."""

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

XHR = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}
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
        self.assertIn(SESSION, settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"])


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
                settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"], session_enabled=False
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
