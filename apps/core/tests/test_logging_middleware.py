"""Which requests the logging middleware keeps, and who it attributes them to (G6 P0-1/P0-5)."""

from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings

from ...admin_api.tests.helpers import bearer_client, make_user
from ..middleware import logging_middleware
from ..middleware.logging_middleware import LoggingMiddleware
from ..models import SystemLog


def _decide(method, path, status, *, sample_rate=0.0):
    with override_settings(REQUEST_LOG_SUCCESS_SAMPLE_RATE=sample_rate):
        middleware = LoggingMiddleware(lambda request: None)
    return middleware._should_log_request(method, path, status)


class LoggingRulesTests(SimpleTestCase):
    def test_excluded_paths_are_never_logged(self):
        middleware = LoggingMiddleware(lambda request: None)
        for path in (
            "/api/v1/health/",
            "/api/v1/health/ready/",
            "/metrics",
            "/api/v1/admin/logs/",
            "/api/v1/admin/logs/stats/",
            "/static/app.js",
            "/media/x.png",
        ):
            with self.subTest(path=path):
                self.assertTrue(middleware._is_excluded_path(path))

    def test_always_logged(self):
        for method, path, status in (
            ("POST", "/api/v1/admin/users/1/suspend/", 200),
            ("DELETE", "/api/v1/admin/genres/2/", 200),
            ("POST", "/api/v1/auth/login/", 200),
            ("GET", "/api/v1/anime/", 500),
            ("GET", "/api/v1/anime/", 403),
            ("GET", "/api/v1/anime/", 429),
        ):
            with self.subTest(method=method, path=path, status=status):
                self.assertTrue(_decide(method, path, status))

    def test_admin_reads_and_401_404_are_only_sampled(self):
        for method, path, status in (
            ("GET", "/api/v1/admin/users/", 200),
            ("GET", "/api/v1/admin/dashboard/", 200),
            ("GET", "/api/v1/users/me/", 401),
            ("GET", "/wp-login.php", 404),
            ("GET", "/api/v1/auth/me/", 200),
        ):
            with self.subTest(method=method, path=path, status=status):
                self.assertFalse(_decide(method, path, status, sample_rate=0.0))
                self.assertTrue(_decide(method, path, status, sample_rate=1.0))


@override_settings(REQUEST_LOG_SUCCESS_SAMPLE_RATE=0.0)
class LoggingAttributionTests(TestCase):
    def test_jwt_request_is_attributed_to_the_user(self):
        staff = make_user("log-staff", role="staff")

        response = bearer_client(staff).post(
            "/api/v1/admin/genres/", {"name": "Logged"}, format="json"
        )

        self.assertEqual(response.status_code, 403)  # staff cannot create; still logged (403)
        row = SystemLog.objects.get(path="/api/v1/admin/genres/")
        self.assertEqual((row.user, row.status_code, row.log_type), (staff, 403, "ADMIN"))

    def test_logs_endpoint_and_admin_reads_write_no_rows(self):
        root = make_user("log-root", role="superuser")
        client = bearer_client(root)
        client.get("/api/v1/admin/logs/")
        client.get("/api/v1/admin/users/")

        self.assertFalse(SystemLog.objects.exists())

    def test_user_is_read_after_the_view(self):
        user = make_user("late-user")
        request = RequestFactory().post("/api/v1/admin/genres/")

        def view(req):
            req.user = user
            return SimpleNamespace(status_code=201)

        with patch.object(logging_middleware.log_request_async, "delay") as delay:
            LoggingMiddleware(view)(request)

        self.assertEqual(delay.call_args.args[0]["user_id"], user.id)
