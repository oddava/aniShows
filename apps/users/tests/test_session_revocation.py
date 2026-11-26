"""Revoking sessions voids access tokens already issued, not only refresh tokens."""

from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ..services.auth_service import SESSION_VERSION_CLAIM, issue_refresh_token, revoke_all_sessions

User = get_user_model()
ME_URL = "/api/v1/users/me/"


class SessionRevocationTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="revokee", email="revokee@example.com", password="securepass123"
        )

    def _client(self, user=None) -> APIClient:
        access = issue_refresh_token(user or self.user).access_token
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return client

    def test_an_issued_access_token_stops_working_after_revocation(self):
        client = self._client()
        self.assertEqual(client.get(ME_URL).status_code, status.HTTP_200_OK)

        revoke_all_sessions(self.user)

        self.assertEqual(client.get(ME_URL).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_token_from_the_same_second_is_refused_and_a_new_one_works(self):
        # Revocation is a version, not a timestamp, so the same clock second
        # cannot slip an old token through.
        with mock.patch("time.time", return_value=1_795_642_962):
            old = self._client()
            revoke_all_sessions(self.user)
            new = self._client()
        self.assertEqual(old.get(ME_URL).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(new.get(ME_URL).status_code, status.HTTP_200_OK)

    def test_revocation_is_durable_without_the_cache(self):
        client = self._client()
        revoke_all_sessions(self.user)
        with mock.patch("django.core.cache.cache.get", side_effect=ConnectionError("cache down")):
            self.assertEqual(client.get(ME_URL).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_stale_user_instance_still_mints_tokens_under_the_new_version(self):
        stale = User.objects.get(pk=self.user.pk)
        revoke_all_sessions(self.user)
        token = issue_refresh_token(stale)
        self.assertEqual(token[SESSION_VERSION_CLAIM], 1)
        self.assertEqual(self._client(stale).get(ME_URL).status_code, status.HTTP_200_OK)

    def test_other_users_are_untouched(self):
        other = User.objects.create_user(
            username="bystander", email="b@example.com", password="x" * 12
        )
        client = self._client(other)
        revoke_all_sessions(self.user)
        self.assertEqual(client.get(ME_URL).status_code, status.HTTP_200_OK)

    def test_tokens_from_before_the_claim_count_as_version_zero(self):
        access = issue_refresh_token(self.user).access_token
        del access[SESSION_VERSION_CLAIM]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(client.get(ME_URL).status_code, status.HTTP_200_OK)
        revoke_all_sessions(self.user)
        self.assertEqual(client.get(ME_URL).status_code, status.HTTP_401_UNAUTHORIZED)
