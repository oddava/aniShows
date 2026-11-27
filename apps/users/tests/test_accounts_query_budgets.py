"""Query budgets for G1's hot endpoints, pinned at the measured value (spec 1 test plan).

Counts include the per-request middleware and DRF auth queries of the test
settings (admin runtime settings are read uncached there). A higher count is a
regression to explain in the council packet, not a number to bump silently.
"""

from typing import Any

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

User = get_user_model()

# Any-valued so mypy does not map it onto APIClient.post(follow: bool).
XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}

BUDGETS = {
    "login": 13,  # includes UPDATE_LAST_LOGIN's UPDATE; +1: the device row (BUG-008)
    "refresh": 25,  # includes the user-row lock that serializes rotation with revocation
    "me_cold": 28,  # +1: the live list totals (P1, one stats calculation)
    "me_warm": 1,  # the JWT user lookup only; the payload comes from the cache
    "public_cold": 23,  # +1: the live list totals (P1, one stats calculation)
    "patch_bio": 7,
}


class AccountQueryBudgetTests(APITestCase):
    def setUp(self):
        User.objects.create_user(username="budget", email="b@example.com", password="pw-12345678")
        User.objects.create_user(username="other", email="o@example.com", password="x")
        self.api = APIClient()

    def _count(self, call):
        with CaptureQueriesContext(connection) as queries:
            response = call()
        return response, len(queries)

    def assert_within(self, name, count):
        self.assertLessEqual(count, BUDGETS[name], f"{name}: {count} queries > {BUDGETS[name]}")

    def test_budgets(self):
        login, count = self._count(
            lambda: self.api.post(
                reverse("token_obtain_pair"),
                {"username": "budget", "password": "pw-12345678"},
                format="json",
                **XHR,
            )
        )
        self.assertEqual(login.status_code, 200)
        self.assert_within("login", count)

        refreshed, count = self._count(lambda: self.api.post(reverse("token_refresh"), **XHR))
        self.assertEqual(refreshed.status_code, 200)
        self.assert_within("refresh", count)

        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access']}")
        _, count = self._count(lambda: self.api.get(reverse("user_profile")))
        self.assert_within("me_cold", count)
        _, count = self._count(lambda: self.api.get(reverse("user_profile")))
        self.assert_within("me_warm", count)

        public, count = self._count(lambda: self.api.get("/api/v1/users/other/"))
        self.assertEqual(public.status_code, 200)
        self.assert_within("public_cold", count)

        patched, count = self._count(
            lambda: self.api.patch(reverse("user_profile"), {"bio": "hi"}, format="json")
        )
        self.assertEqual(patched.status_code, 200)
        self.assert_within("patch_bio", count)
