"""Maintenance mode lets staff through with a session or a JWT (G6 P0-4, M9)."""

from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from ...admin_api.tests.helpers import bearer_client, make_user
from ..middleware.site_control_middleware import SiteControlMiddleware
from ..models import AdminPanelSettings

PUBLIC_URL = "/api/v1/genres/"


class MaintenanceBypassTests(TestCase):
    def setUp(self):
        self.staff = make_user("maint-staff", role="staff")
        self.member = make_user("maint-member")

    def _maintenance(self, on: bool):
        AdminPanelSettings.objects.update_or_create(
            key="global", defaults={"data": {"general": {"maintenanceMode": on}}}
        )
        cache.clear()

    def test_anonymous_gets_503_with_retry_after(self):
        self._maintenance(True)

        response = APIClient().get(PUBLIC_URL)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "300")

    def test_staff_with_a_bearer_token_get_through(self):
        self._maintenance(True)
        self.assertEqual(bearer_client(self.staff).get(PUBLIC_URL).status_code, 200)

    def test_staff_with_a_session_get_through(self):
        self._maintenance(True)
        client = APIClient()
        client.force_login(self.staff)
        self.assertEqual(client.get(PUBLIC_URL).status_code, 200)

    def test_regular_users_and_bad_tokens_get_503(self):
        self._maintenance(True)
        bad = APIClient()
        bad.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")

        self.assertEqual(bearer_client(self.member).get(PUBLIC_URL).status_code, 503)
        self.assertEqual(bad.get(PUBLIC_URL).status_code, 503)

    def test_suspended_staff_token_gets_503(self):
        client = bearer_client(self.staff)
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        self._maintenance(True)

        self.assertEqual(client.get(PUBLIC_URL).status_code, 503)

    def test_exempt_paths_stay_open(self):
        self._maintenance(True)
        self.assertEqual(APIClient().get("/api/v1/health/").status_code, 200)

    def test_no_jwt_decode_when_maintenance_is_off(self):
        self._maintenance(False)
        with patch.object(SiteControlMiddleware, "_is_jwt_staff") as decode:
            response = bearer_client(self.member).get(PUBLIC_URL)

        self.assertEqual(response.status_code, 200)
        decode.assert_not_called()

    def test_no_jwt_decode_for_session_staff(self):
        self._maintenance(True)
        client = APIClient()
        client.force_login(self.staff)
        with patch.object(SiteControlMiddleware, "_is_jwt_staff") as decode:
            client.get(PUBLIC_URL)
        decode.assert_not_called()
