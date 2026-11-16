"""Email changes wait on the profile; links carry no address (A14, P1-3)."""

from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import UserProfile
from ..tokens import EmailChangeTokenGenerator

User = get_user_model()


class PendingEmailTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="mover", email="old@example.com", password="securepass123"
        )
        self.client.force_authenticate(self.user)

    def _request(self, address="new@example.com"):
        return self.client.post(
            reverse("change_email"),
            {"new_email": address, "password": "securepass123"},
            format="json",
        )

    def _profile(self):
        return UserProfile.objects.get(user=self.user)

    def _link_parts(self):
        message = next(m for m in mail.outbox if m.to == ["new@example.com"])
        link = message.body.split("/confirm-email-change/")[1].split()[0]
        return link.strip("/").split("/")

    def _confirm(self, uid, token, **extra):
        self.client.force_authenticate(user=None)
        return self.client.post(
            reverse("confirm_email_change"), {"uid": uid, "token": token, **extra}, format="json"
        )

    def test_request_stores_the_pending_address_and_reports_it(self):
        response = self._request("New@Example.com")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["pending_email"], "new@example.com")
        profile = self._profile()
        self.assertEqual(profile.pending_email, "new@example.com")
        self.assertIsNotNone(profile.pending_email_requested_at)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "old@example.com")

    def test_link_has_uid_and_token_only(self):
        self._request()
        parts = self._link_parts()
        self.assertEqual(len(parts), 2)
        message = next(m for m in mail.outbox if m.to == ["new@example.com"])
        link = message.body.split("/confirm-email-change/")[1].split()[0]
        self.assertNotIn(urlsafe_base64_encode(force_bytes("new@example.com")), link)

    def test_confirm_with_uid_and_token_switches_and_clears_pending(self):
        self._request()
        uid, token = self._link_parts()

        response = self._confirm(uid, token)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "new@example.com")
        profile = self._profile()
        self.assertEqual(profile.pending_email, "")
        self.assertIsNone(profile.pending_email_requested_at)
        self.assertTrue(profile.email_verified)
        # Single use.
        self.assertEqual(self._confirm(uid, token).status_code, status.HTTP_400_BAD_REQUEST)

    def test_users_me_shows_the_pending_address(self):
        self.assertIsNone(self.client.get(reverse("user_profile")).data["pending_email"])
        with self.captureOnCommitCallbacks(execute=True):  # the cached payload is dropped
            self._request()
        self.assertEqual(
            self.client.get(reverse("user_profile")).data["pending_email"], "new@example.com"
        )

    def test_cancel_kills_sent_links(self):
        self._request()
        uid, token = self._link_parts()

        with self.captureOnCommitCallbacks(execute=True):
            cancel = self.client.post(reverse("cancel_email_change"), format="json")

        self.assertEqual(cancel.status_code, status.HTTP_200_OK)
        self.assertIsNone(cancel.data["pending_email"])
        self.assertEqual(self._profile().pending_email, "")
        self.assertIsNone(self.client.get(reverse("user_profile")).data["pending_email"])
        self.assertEqual(self._confirm(uid, token).status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_newer_request_replaces_the_older_link(self):
        self._request()
        uid, old_token = self._link_parts()
        self._request("other@example.com")

        self.assertEqual(self._confirm(uid, old_token).status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "old@example.com")

    def test_resend_sends_the_link_again(self):
        self._request()
        mail.outbox.clear()

        response = self.client.post(reverse("resend_email_change"), format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([m.to for m in mail.outbox], [["new@example.com"]])
        uid, token = self._link_parts()
        self.assertEqual(self._confirm(uid, token).status_code, status.HTTP_200_OK)

    def test_resend_without_a_pending_change_is_400(self):
        response = self.client.post(reverse("resend_email_change"), format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resend_and_cancel_need_a_signed_in_user(self):
        self.client.force_authenticate(user=None)
        for name in ("resend_email_change", "cancel_email_change"):
            with self.subTest(name=name):
                response = self.client.post(reverse(name), format="json")
                self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_legacy_three_segment_link_must_match_the_pending_address(self):
        UserProfile.objects.filter(user=self.user).update(pending_email="new@example.com")
        self.user.refresh_from_db()
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = EmailChangeTokenGenerator("new@example.com").make_token(self.user)

        wrong = self._confirm(
            uid, token, new_email=urlsafe_base64_encode(force_bytes("evil@example.com"))
        )
        right = self._confirm(
            uid, token, new_email=urlsafe_base64_encode(force_bytes("new@example.com"))
        )

        self.assertEqual(wrong.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(right.status_code, status.HTTP_200_OK)

    def test_a_token_without_any_pending_change_is_rejected(self):
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = EmailChangeTokenGenerator("new@example.com").make_token(self.user)
        self.assertEqual(self._confirm(uid, token).status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_string_body_values_are_400(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            reverse("confirm_email_change"), {"uid": {"a": 1}, "token": 5}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cancelled_link_stays_dead_when_the_same_address_is_requested_again(self):
        self._request()
        uid, old_token = self._link_parts()
        self.client.post(reverse("cancel_email_change"), format="json")
        self.client.force_authenticate(self.user)
        mail.outbox.clear()
        self._request()  # same address, new request
        _uid, new_token = self._link_parts()

        self.assertEqual(self._confirm(uid, old_token).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._confirm(uid, new_token).status_code, status.HTTP_200_OK)

    def test_confirm_locks_the_user_and_rechecks_on_fresh_rows(self):
        from unittest.mock import patch

        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from ..tokens import EmailChangeTokenGenerator

        self._request()
        uid, token = self._link_parts()
        real_check = EmailChangeTokenGenerator.check_token
        calls = []

        def check_then_supersede(generator, user, value):
            calls.append(1)
            ok = real_check(generator, user, value)
            if len(calls) == 1:
                # A second submit of the link committed between the checks.
                UserProfile.objects.filter(user=self.user).update(pending_email="")
            return ok

        self.client.force_authenticate(user=None)
        with (
            patch.object(EmailChangeTokenGenerator, "check_token", check_then_supersede),
            CaptureQueriesContext(connection) as queries,
        ):
            response = self.client.post(
                reverse("confirm_email_change"), {"uid": uid, "token": token}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(
            any(
                "FOR UPDATE" in q["sql"] and '"users_customuser"' in q["sql"]
                for q in queries.captured_queries
            )
        )
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "old@example.com")
