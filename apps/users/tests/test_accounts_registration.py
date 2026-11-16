"""Registration needs an email; auth-flow bodies never 500 on odd input (A01, A02)."""

from typing import Any

from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

# Any-valued so mypy does not map it onto APIClient.post(follow: bool).
XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class RegistrationEmailTests(APITestCase):
    def setUp(self):
        self.url = reverse("register")

    def test_missing_email_is_400_and_creates_nobody(self):
        response = self.client.post(
            self.url, {"username": "noemail", "password": "securepass123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.data["errors"])
        self.assertFalse(User.objects.filter(username="noemail").exists())

    def test_blank_email_is_400_and_creates_nobody(self):
        response = self.client.post(
            self.url,
            {"username": "blankemail", "email": "", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.data["errors"])
        self.assertFalse(User.objects.filter(username="blankemail").exists())

    def test_email_is_stored_lowercase(self):
        response = self.client.post(
            self.url,
            {"username": "casey", "email": " Casey@Example.COM ", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(User.objects.get(username="casey").email, "casey@example.com")


class AuthFlowBodyTests(APITestCase):
    """Non-string JSON values are a 400, never a 500 (``.strip()`` on a dict)."""

    BAD_VALUES = ({"email": "a@b.c"}, 5, ["a@b.c"], True, "", "   ", None)

    def setUp(self):
        self.user = User.objects.create_user(
            username="pending", email="pending@example.com", password="securepass123"
        )

    def test_resend_verification_rejects_non_strings(self):
        for value in self.BAD_VALUES:
            with self.subTest(value=value):
                response = self.client.post(
                    reverse("resend_verification"), {"email": value}, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_reset_rejects_non_strings(self):
        for value in self.BAD_VALUES:
            with self.subTest(value=value):
                response = self.client.post(
                    reverse("password_reset"), {"email": value}, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resend_verification_with_a_string_is_generic_200(self):
        known = self.client.post(
            reverse("resend_verification"), {"email": " Pending@Example.com "}, format="json"
        )
        unknown = self.client.post(
            reverse("resend_verification"), {"email": "nobody@example.com"}, format="json"
        )
        self.assertEqual(known.status_code, status.HTTP_200_OK)
        self.assertEqual(known.data, unknown.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["pending@example.com"])

    def test_password_reset_confirm_rejects_non_strings(self):
        for body in (
            {"uid": {"a": 1}, "token": "t", "password": "newsecurepass123"},
            {"uid": "MQ", "token": 5, "password": "newsecurepass123"},
            {"uid": "MQ", "token": "t", "password": ["x"]},
        ):
            with self.subTest(body=body):
                response = self.client.post(reverse("password_reset_confirm"), body, format="json")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_verify_email_with_a_garbage_link_is_400(self):
        response = self.client.post("/api/v1/verify-email/x/y/", {}, format="json", **XHR)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class VerifyEmailBodyRouteTests(APITestCase):
    """POST verify-email/ with {uid, token} keeps the token out of access logs (A14)."""

    def test_body_route_verifies(self):
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        from ..tokens import email_verification_token_generator

        user = User.objects.create_user(username="bodyv", email="bv@example.com", password="x")
        response = self.client.post(
            reverse("verify_email_body"),
            {
                "uid": urlsafe_base64_encode(force_bytes(user.pk)),
                "token": email_verification_token_generator.make_token(user),
            },
            format="json",
            **XHR,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

    def test_body_route_with_bad_values_is_400(self):
        response = self.client.post(
            reverse("verify_email_body"), {"uid": 5, "token": ["x"]}, format="json", **XHR
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
