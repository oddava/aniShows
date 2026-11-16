"""POST auth/login/ never 500s and does not reveal which identifiers exist (A35, S-3)."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import MD5PasswordHasher
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

XHR = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class LoginIdentifierTests(APITestCase):
    def setUp(self):
        self.url = reverse("token_obtain_pair")
        self.user = User.objects.create_user(
            username="Known", email="known@example.com", password="securepass123"
        )

    def _post(self, payload):
        return self.client.post(self.url, payload, format="json", **XHR)

    def test_missing_identifier_is_400_on_username(self):
        response = self._post({"password": "securepass123"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["errors"]["username"], ["Enter a username or email."])
        self.assertEqual(response.data["code"], "validation_error")

    def test_blank_identifiers_are_400(self):
        response = self._post({"username": "  ", "email": "", "password": "x"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data["errors"])

    def test_non_string_fields_are_400_not_500(self):
        for payload in (
            {"username": 5, "password": "securepass123"},
            {"username": {"a": 1}, "password": "securepass123"},
            {"username": ["Known"], "password": "securepass123"},
            {"email": 5, "password": "securepass123"},
            {"username": "Known", "password": 12345678},
            {"username": "Known", "password": None},
            {"username": True, "password": "securepass123"},
        ):
            with self.subTest(payload=payload):
                response = self._post(payload)
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_email_fails_like_a_wrong_password(self):
        unknown_email = self._post({"email": "nobody@example.com", "password": "securepass123"})
        unknown_username = self._post({"username": "nobody", "password": "securepass123"})
        wrong_password = self._post({"username": "Known", "password": "wrong-password"})
        unknown_email_in_username = self._post(
            {"username": "nobody@example.com", "password": "securepass123"}
        )

        for response in (unknown_email, unknown_username, unknown_email_in_username):
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(response.data, wrong_password.data)
        self.assertEqual(wrong_password.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(wrong_password.data["code"], "no_active_account")

    def test_known_email_still_logs_in(self):
        for payload in (
            {"email": "KNOWN@example.com", "password": "securepass123"},
            {"username": "known@example.com", "password": "securepass123"},
            {"username": " known ", "password": "securepass123"},
            {"username": "Known", "email": "", "password": "securepass123"},
        ):
            with self.subTest(payload=payload):
                response = self._post(payload)
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertIn("access", response.data)

    def test_unknown_and_known_accounts_hash_the_same_number_of_times(self):
        """Both 401 paths run the password hasher equally often (no timing oracle)."""
        real_encode = MD5PasswordHasher.encode

        def count_hashes(payload):
            calls = []

            def spy(hasher, password, salt):
                calls.append(1)
                return real_encode(hasher, password, salt)

            with patch.object(MD5PasswordHasher, "encode", spy):
                self._post(payload)
            return len(calls)

        wrong_password = count_hashes({"username": "Known", "password": "wrong-password"})
        unknown_email = count_hashes({"email": "nobody@example.com", "password": "x"})
        unknown_username = count_hashes({"username": "nobody", "password": "x"})

        self.assertGreater(wrong_password, 0)
        self.assertEqual(unknown_email, wrong_password)
        self.assertEqual(unknown_username, wrong_password)
