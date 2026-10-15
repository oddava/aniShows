"""Refresh-cookie auth flow, slim JWT claims and WebSocket tickets."""

from unittest.mock import patch

from asgiref.sync import async_to_sync, sync_to_async
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from root import ws_auth

from ..auth_cookies import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH
from ..services.ws_ticket_service import consume_ws_ticket, issue_ws_ticket
from ..views.social_auth import SocialLoginView

User = get_user_model()

XHR = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class RefreshCookieFlowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="cookieuser",
            email="cookie@example.com",
            password="securepass123",
            is_staff=True,
            is_superuser=True,
        )
        self.login_url = reverse("token_obtain_pair")
        self.refresh_url = reverse("token_refresh")
        self.logout_url = reverse("token_logout")

    def _login(self):
        response = self.client.post(
            self.login_url, {"username": "cookieuser", "password": "securepass123"}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response

    def test_login_sets_httponly_refresh_cookie_and_keeps_it_out_of_the_body(self):
        response = self._login()

        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)
        cookie = response.cookies[REFRESH_COOKIE_NAME]
        self.assertTrue(cookie.value)
        self.assertTrue(cookie["httponly"])
        self.assertTrue(cookie["secure"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertEqual(cookie["path"], REFRESH_COOKIE_PATH)
        self.assertGreater(int(cookie["max-age"]), 0)

    @override_settings(JWT_REFRESH_COOKIE_SECURE=False)
    def test_cookie_is_not_secure_when_disabled_for_dev(self):
        response = self._login()
        self.assertFalse(response.cookies[REFRESH_COOKIE_NAME]["secure"])

    def test_access_token_carries_no_email_or_role_claims(self):
        token = AccessToken(self._login().data["access"])

        self.assertEqual(str(token["user_id"]), str(self.user.id))
        self.assertEqual(token["username"], "cookieuser")
        for claim in ("email", "is_staff", "is_superuser"):
            self.assertNotIn(claim, token.payload)

    def test_refresh_rotates_cookie_and_blacklists_the_old_token(self):
        self._login()
        old_refresh = self.client.cookies[REFRESH_COOKIE_NAME].value

        response = self.client.post(self.refresh_url, **XHR)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)
        new_refresh = response.cookies[REFRESH_COOKIE_NAME].value
        self.assertTrue(new_refresh)
        self.assertNotEqual(new_refresh, old_refresh)

        self.client.cookies[REFRESH_COOKIE_NAME] = old_refresh
        replay = self.client.post(self.refresh_url, **XHR)
        self.assertEqual(replay.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_requires_the_csrf_header(self):
        self._login()
        response = self.client.post(self.refresh_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_refresh_rejects_foreign_origin(self):
        self._login()
        response = self.client.post(self.refresh_url, HTTP_ORIGIN="https://evil.example", **XHR)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_refresh_accepts_same_origin(self):
        self._login()
        response = self.client.post(self.refresh_url, HTTP_ORIGIN="http://testserver", **XHR)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_refresh_without_cookie_is_401(self):
        response = self.client.post(self.refresh_url, **XHR)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_ignores_a_token_in_the_body(self):
        refresh = self._login().cookies[REFRESH_COOKIE_NAME].value
        del self.client.cookies[REFRESH_COOKIE_NAME]

        response = self.client.post(self.refresh_url, {"refresh": refresh}, **XHR)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_invalid_refresh_cookie_is_401_and_cleared(self):
        self.client.cookies[REFRESH_COOKIE_NAME] = "not-a-jwt"

        response = self.client.post(self.refresh_url, **XHR)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        cleared = response.cookies[REFRESH_COOKIE_NAME]
        self.assertEqual(cleared.value, "")
        self.assertEqual(cleared["path"], REFRESH_COOKIE_PATH)

    def test_logout_blacklists_refresh_token_and_clears_cookie(self):
        refresh = self._login().cookies[REFRESH_COOKIE_NAME].value

        response = self.client.post(self.logout_url, **XHR)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(response.cookies[REFRESH_COOKIE_NAME].value, "")

        self.client.cookies[REFRESH_COOKIE_NAME] = refresh
        replay = self.client.post(self.refresh_url, **XHR)
        self.assertEqual(replay.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_is_under_the_cookie_path(self):
        self.assertTrue(self.logout_url.startswith(REFRESH_COOKIE_PATH))

    def test_logout_requires_the_csrf_header(self):
        self._login()
        response = self.client.post(self.logout_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_logout_without_cookie_still_succeeds(self):
        response = self.client.post(self.logout_url, **XHR)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)


class GoogleLoginCookieTests(APITestCase):
    def test_google_login_moves_refresh_token_into_cookie(self):
        def fake_post(view, request, *args, **kwargs):
            view.refresh_token = "google-refresh-token"
            return Response({"access": "google-access", "refresh": "", "user": {"pk": 1}})

        with patch.object(SocialLoginView, "post", autospec=True, side_effect=fake_post):
            # Not reverse("google_login"): allauth registers the same URL name.
            response = self.client.post("/api/v1/auth/google/", {"code": "abc"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["access"], "google-access")
        self.assertNotIn("refresh", response.data)
        cookie = response.cookies[REFRESH_COOKIE_NAME]
        self.assertEqual(cookie.value, "google-refresh-token")
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], REFRESH_COOKIE_PATH)


class WebSocketTicketTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="wsuser", email="ws@example.com", password="securepass123"
        )
        self.url = reverse("ws_ticket")

    def test_ticket_requires_authentication(self):
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_ticket_is_issued_for_access_token_and_single_use(self):
        access = str(AccessToken.for_user(self.user))
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

        response = self.client.post(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ticket = response.data["ticket"]
        self.assertGreater(len(ticket), 30)
        self.assertEqual(consume_ws_ticket(ticket), self.user.id)
        self.assertIsNone(consume_ws_ticket(ticket))

    def test_unknown_ticket_is_rejected(self):
        self.assertIsNone(consume_ws_ticket("nope"))
        self.assertIsNone(consume_ws_ticket(""))

    def _scope_user(self, query_string: bytes):
        captured = {}

        async def inner(scope, receive, send):
            captured["user"] = scope["user"]

        # Plain sync_to_async still runs the lookup on this thread (inside the
        # test transaction) but, unlike database_sync_to_async, does not close
        # the test's DB connection.
        middleware = ws_auth.WSTicketAuthMiddleware(inner)
        with patch.object(ws_auth, "get_user_from_ticket", sync_to_async(ws_auth.user_for_ticket)):
            async_to_sync(middleware)({"type": "websocket", "query_string": query_string}, None, None)
        return captured["user"]

    def test_middleware_authenticates_with_ticket_once(self):
        ticket = issue_ws_ticket(self.user)

        self.assertEqual(self._scope_user(f"ticket={ticket}".encode()), self.user)
        self.assertTrue(self._scope_user(f"ticket={ticket}".encode()).is_anonymous)

    def test_middleware_ignores_jwt_in_query_string(self):
        access = str(AccessToken.for_user(self.user))
        self.assertTrue(self._scope_user(f"token={access}".encode()).is_anonymous)

    def test_middleware_rejects_ticket_of_inactive_user(self):
        ticket = issue_ws_ticket(self.user)
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])

        self.assertTrue(self._scope_user(f"ticket={ticket}".encode()).is_anonymous)
