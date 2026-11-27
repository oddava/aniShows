"""Signed-in devices, "sign out everywhere else" and the expired-token flush (A20, P1-11)."""

from datetime import timedelta
from typing import Any

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from ..auth_cookies import REFRESH_COOKIE_NAME
from ..services.auth_service import flush_expired_tokens, issue_refresh_token
from ..tasks import flush_expired_auth_tokens

User = get_user_model()

# Any-valued so mypy does not map it onto APIClient.post(follow: bool).
XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class DeviceSessionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="multi", email="multi@example.com", password="securepass123"
        )

    def _signed_in_client(self):
        client = APIClient()
        response = client.post(
            reverse("token_obtain_pair"),
            {"username": "multi", "password": "securepass123"},
            format="json",
            **XHR,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return client

    def test_sessions_counts_live_devices(self):
        this_device = self._signed_in_client()
        self._signed_in_client()
        self._signed_in_client()

        response = this_device.get(reverse("auth_sessions"), **XHR)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["active"], 3)
        self.assertIsNotNone(response.data["current_since"])

    def test_a_refresh_does_not_add_a_device(self):
        this_device = self._signed_in_client()
        this_device.post(reverse("token_refresh"), **XHR)
        self.assertEqual(this_device.get(reverse("auth_sessions"), **XHR).data["active"], 1)

    def test_revoke_others_keeps_this_device_and_ends_the_rest(self):
        this_device = self._signed_in_client()
        other = self._signed_in_client()

        response = this_device.post(reverse("auth_sessions_revoke_others"), **XHR)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {"revoked": 1, "active": 1})
        self.assertEqual(
            this_device.post(reverse("token_refresh"), **XHR).status_code, status.HTTP_200_OK
        )
        self.assertEqual(
            other.post(reverse("token_refresh"), **XHR).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_endpoints_need_the_csrf_header(self):
        client = self._signed_in_client()
        self.assertEqual(
            client.get(reverse("auth_sessions")).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(
            client.post(reverse("auth_sessions_revoke_others")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_endpoints_need_a_live_cookie(self):
        self.assertEqual(
            self.client.get(reverse("auth_sessions"), **XHR).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        client = self._signed_in_client()
        client.post(reverse("token_logout"), **XHR)
        # Logout cleared the cookie; replay the revoked token by hand.
        revoked = OutstandingToken.objects.filter(user=self.user).first()
        assert revoked is not None
        client.cookies[REFRESH_COOKIE_NAME] = revoked.token
        self.assertEqual(
            client.post(reverse("auth_sessions_revoke_others"), **XHR).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_endpoints_live_under_the_cookie_path(self):
        self.assertTrue(reverse("auth_sessions").startswith("/api/v1/auth/refresh/"))
        self.assertTrue(reverse("auth_sessions_revoke_others").startswith("/api/v1/auth/refresh/"))


class FlushExpiredTokensTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="old", email="old@example.com", password="x")

    def _token(self, *, expired: bool, blacklisted: bool = False):
        issue_refresh_token(self.user)
        token = OutstandingToken.objects.filter(user=self.user).order_by("-id").first()
        assert token is not None
        if expired:
            OutstandingToken.objects.filter(pk=token.pk).update(
                expires_at=timezone.now() - timedelta(minutes=1)
            )
        if blacklisted:
            BlacklistedToken.objects.create(token=token)
        return token

    def test_deletes_only_expired_rows_and_their_blacklist_entries(self):
        live = self._token(expired=False)
        live_blacklisted = self._token(expired=False, blacklisted=True)
        self._token(expired=True)
        self._token(expired=True, blacklisted=True)

        deleted = flush_expired_tokens(batch_size=1)

        self.assertEqual(deleted, 2)
        self.assertEqual(
            set(OutstandingToken.objects.values_list("pk", flat=True)),
            {live.pk, live_blacklisted.pk},
        )
        self.assertEqual(BlacklistedToken.objects.count(), 1)

    def test_task_reports_the_count(self):
        self._token(expired=True)
        result = flush_expired_auth_tokens.apply(kwargs={"batch_size": 5000}).get()
        self.assertEqual(result, {"deleted": 1})


class SessionLockOrderTests(APITestCase):
    """Rotation and revocation take the user row lock first (no surviving token)."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="locker", email="lk@example.com", password="x"
        )

    def test_refresh_and_revocations_lock_the_user_row(self):
        from unittest.mock import patch

        from ..services import auth_service

        client = APIClient()
        client.cookies[REFRESH_COOKIE_NAME] = str(issue_refresh_token(self.user))
        real_lock = auth_service.lock_user_sessions
        with (
            patch.object(auth_service, "lock_user_sessions", wraps=real_lock) as lock,
            patch("apps.users.views.auth.lock_user_sessions", wraps=real_lock) as view_lock,
        ):
            self.assertEqual(client.post(reverse("token_refresh"), **XHR).status_code, 200)
            auth_service.revoke_other_sessions(self.user, keep_jti="none")
            auth_service.revoke_all_sessions(self.user)
        view_lock.assert_called_once_with(self.user.pk)
        self.assertEqual(lock.call_count, 2)


class SessionLockSqlOrderTests(APITestCase):
    """The users row is locked before the token row in a refresh (the race fix)."""

    def test_refresh_locks_the_user_row_first(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        user = User.objects.create_user(username="sqlorder", email="so@example.com", password="x")
        client = APIClient()
        client.cookies[REFRESH_COOKIE_NAME] = str(issue_refresh_token(user))
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(client.post(reverse("token_refresh"), **XHR).status_code, 200)
        locks = [q["sql"] for q in queries.captured_queries if "FOR UPDATE" in q["sql"]]
        self.assertGreaterEqual(len(locks), 2)
        self.assertIn('"users_customuser"', locks[0])
        self.assertIn("outstandingtoken", locks[1])


class RevokeOthersRaceTests(APITestCase):
    def test_a_rotated_cookie_gets_409_and_revokes_nothing(self):
        from unittest.mock import patch

        user = User.objects.create_user(username="rotated", email="r@example.com", password="x")
        other = issue_refresh_token(user)
        client = APIClient()
        client.cookies[REFRESH_COOKIE_NAME] = str(issue_refresh_token(user))
        # Another tab rotates this device's token after the view validated it.
        with patch("apps.users.views.auth.revoke_other_sessions", return_value=None):
            response = client.post(reverse("auth_sessions_revoke_others"), **XHR)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "session_changed")
        self.assertFalse(BlacklistedToken.objects.filter(token__jti=other["jti"]).exists())

    def test_service_returns_none_when_the_kept_token_is_gone(self):
        from ..services.auth_service import revoke_other_sessions

        user = User.objects.create_user(username="gone", email="g@example.com", password="x")
        issue_refresh_token(user)
        self.assertIsNone(revoke_other_sessions(user, keep_jti="not-live"))
        self.assertEqual(BlacklistedToken.objects.count(), 0)


FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
)


class PerDeviceSessionTests(APITestCase):
    """BUG-008: devices listed one by one, signed out one by one, no pile-up."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="devices", email="devices@example.com", password="securepass123"
        )

    def _sign_in(self, client=None, agent=FIREFOX_WINDOWS, username="devices"):
        client = client or APIClient()
        response = client.post(
            reverse("token_obtain_pair"),
            {"username": username, "password": "securepass123"},
            format="json",
            HTTP_USER_AGENT=agent,
            **XHR,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return client

    def _sessions(self, client):
        response = client.get(reverse("auth_sessions"), **XHR)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_signing_in_again_in_the_same_browser_adds_no_device(self):
        browser = self._sign_in()
        for _ in range(3):
            self._sign_in(browser)

        data = self._sessions(browser)

        self.assertEqual(data["active"], 1)
        self.assertEqual(len(data["sessions"]), 1)

    def test_devices_are_labelled_and_the_current_one_comes_first(self):
        self._sign_in(agent=SAFARI_IPHONE)
        laptop = self._sign_in(agent=FIREFOX_WINDOWS)

        sessions = self._sessions(laptop)["sessions"]

        self.assertEqual(
            [s["device"] for s in sessions], ["Firefox on Windows", "Safari on iPhone"]
        )
        self.assertEqual([s["current"] for s in sessions], [True, False])
        for session in sessions:
            self.assertEqual(
                set(session), {"id", "device", "signed_in_at", "last_active_at", "current"}
            )

    def test_a_refresh_keeps_the_device_row(self):
        laptop = self._sign_in()
        before = self._sessions(laptop)["sessions"][0]["id"]

        self.assertEqual(laptop.post(reverse("token_refresh"), **XHR).status_code, 200)

        after = self._sessions(laptop)["sessions"]
        self.assertEqual([s["id"] for s in after], [before])

    def test_one_device_can_be_signed_out(self):
        phone = self._sign_in(agent=SAFARI_IPHONE)
        tablet = self._sign_in(agent=SAFARI_IPHONE)
        laptop = self._sign_in()
        sessions = self._sessions(laptop)["sessions"]
        phone_id = next(
            s["id"] for s in sessions if not s["current"]
        )  # the most recent other device: the tablet

        response = laptop.post(
            reverse("auth_session_revoke", kwargs={"session_id": phone_id}), **XHR
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["active"], 2)
        self.assertEqual(tablet.post(reverse("token_refresh"), **XHR).status_code, 401)
        self.assertEqual(phone.post(reverse("token_refresh"), **XHR).status_code, 200)
        self.assertEqual(laptop.post(reverse("token_refresh"), **XHR).status_code, 200)

    def test_this_device_is_not_revoked_from_the_list(self):
        laptop = self._sign_in()
        current = self._sessions(laptop)["sessions"][0]

        response = laptop.post(
            reverse("auth_session_revoke", kwargs={"session_id": current["id"]}), **XHR
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(laptop.post(reverse("token_refresh"), **XHR).status_code, 200)

    def test_another_users_device_is_not_found(self):
        User.objects.create_user(
            username="someone", email="someone@example.com", password="securepass123"
        )
        theirs = self._sign_in(username="someone")
        their_id = self._sessions(theirs)["sessions"][0]["id"]
        mine = self._sign_in()

        response = mine.post(reverse("auth_session_revoke", kwargs={"session_id": their_id}), **XHR)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(theirs.post(reverse("token_refresh"), **XHR).status_code, 200)

    def test_revoke_needs_the_csrf_header_and_a_cookie(self):
        laptop = self._sign_in()
        session_id = self._sessions(laptop)["sessions"][0]["id"]
        url = reverse("auth_session_revoke", kwargs={"session_id": session_id})

        self.assertEqual(laptop.post(url).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(APIClient().post(url, **XHR).status_code, 401)
        self.assertTrue(url.startswith("/api/v1/auth/refresh/"))

    def test_devices_signed_in_before_rows_existed_are_listed(self):
        laptop = self._sign_in()
        issue_refresh_token(self.user)  # a token with no device row

        sessions = self._sessions(laptop)["sessions"]

        self.assertEqual(len(sessions), 2)
        self.assertEqual(sessions[1]["device"], "Unknown device")

    def test_logout_and_sign_out_everywhere_forget_the_rows(self):
        from ..models import UserSession

        laptop = self._sign_in()
        self._sign_in(agent=SAFARI_IPHONE)
        laptop.post(reverse("auth_sessions_revoke_others"), **XHR)
        self.assertEqual(UserSession.objects.filter(user=self.user).count(), 1)

        laptop.post(reverse("token_logout"), **XHR)
        self.assertEqual(UserSession.objects.filter(user=self.user).count(), 0)


class DeviceLabelTests(APITestCase):
    def test_labels(self):
        from ..services.device_sessions import device_label

        self.assertEqual(device_label(FIREFOX_WINDOWS), "Firefox on Windows")
        self.assertEqual(device_label(SAFARI_IPHONE), "Safari on iPhone")
        self.assertEqual(
            device_label(
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0 Mobile Safari/537.36"
            ),
            "Chrome on Android",
        )
        self.assertEqual(
            device_label(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0"
            ),
            "Edge on macOS",
        )
        self.assertEqual(device_label(""), "Unknown device")
        self.assertEqual(device_label(None), "Unknown device")
