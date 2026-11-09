"""Phase 2a: unexpected errors go through one handler; client errors keep their status."""

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from ..api_errors import api_exception_handler


class _BrokenView:
    pass


class UnhandledExceptionTests(SimpleTestCase):
    def test_returns_json_500_without_leaking_the_message(self):
        with mock.patch("apps.core.api_errors.logger") as logger:
            try:
                raise RuntimeError("secret connection string")
            except RuntimeError as exc:  # DRF calls the handler inside its except block
                response = api_exception_handler(exc, {"view": _BrokenView()})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.data,
            {"detail": "Internal server error", "code": "internal_server_error"},
        )
        self.assertNotIn("secret", str(response.data))
        logger.exception.assert_called_once_with("Unhandled error in %s", "_BrokenView")


class AdminBadgeErrorStatusTests(TestCase):
    def setUp(self):
        admin = get_user_model().objects.create_superuser(
            username="badge-admin", email="badge-admin@example.com", password="unused-pass-123"
        )
        self.client = APIClient()
        self.client.force_authenticate(admin)

    def test_invalid_create_is_a_400_not_a_500(self):
        response = self.client.post("/api/v1/admin/badges/", {"name": "No description"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")
        self.assertIn("description", response.data["errors"])

    def test_grant_on_missing_badge_is_a_404_not_a_500(self):
        response = self.client.post(
            "/api/v1/admin/badges/999999/grant/", {"user_ids": [1]}, format="json"
        )
        self.assertEqual(response.status_code, 404)
