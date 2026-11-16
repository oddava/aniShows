import json
import os
import subprocess
import sys

from django.conf import settings
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory
from rest_framework.throttling import AnonRateThrottle

PRODUCTION_ENV = {
    "DJANGO_SETTINGS_MODULE": "root.settings.production",
    "DJANGO_SECRET_KEY": "x",
    "CORS_ALLOWED_ORIGINS": "https://example.com",
    "CSRF_TRUSTED_ORIGINS": "https://example.com",
}


# Variables these tests vary; dropped from the inherited environment first.
_VARIED = (
    "SENTRY_DSN",
    "LOG_FORMAT",
    "DB_SSLMODE",
    "DB_SSLROOTCERT",
    "SECURE_HSTS_SECONDS",
    "SECURE_HSTS_INCLUDE_SUBDOMAINS",
    "SECURE_HSTS_PRELOAD",
)


def _run_production(code: str, extra_env: dict | None = None) -> subprocess.CompletedProcess:
    env = {**os.environ, **PRODUCTION_ENV}
    for name in _VARIED:
        env.pop(name, None)
    env.update(extra_env or {})
    # A fresh interpreter: production settings must not leak into this process.
    return subprocess.run(  # noqa: S603 - fixed interpreter and code
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=False
    )


def _production_setting(expression: str, extra_env: dict | None = None):
    code = (
        "import json, django; django.setup(); from django.conf import settings; "
        f"print(json.dumps({expression}))"
    )
    result = _run_production(code, extra_env)
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout.strip().splitlines()[-1])


class ProductionThrottleIdentityTests(SimpleTestCase):
    def test_production_trusts_exactly_one_proxy(self):
        self.assertEqual(_production_setting('settings.REST_FRAMEWORK["NUM_PROXIES"]'), 1)

    def test_spoofed_forwarded_for_entries_do_not_change_the_identity(self):
        rest_framework = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}
        factory = APIRequestFactory()
        with override_settings(REST_FRAMEWORK=rest_framework):
            idents = {
                AnonRateThrottle().get_ident(
                    factory.post("/", HTTP_X_FORWARDED_FOR=f"{spoof}, 203.0.113.9")
                )
                for spoof in ("1.1.1.1", "2.2.2.2", "9.9.9.9")
            }
        self.assertEqual(idents, {"203.0.113.9"})


class ProductionLoggingTests(SimpleTestCase):
    def test_application_info_logs_are_kept(self):
        # Root is at WARNING in production; the app logger must be configured
        # by the name the code actually uses or its INFO lines are dropped.
        level = _production_setting(
            '__import__("logging").getLogger("anishows.celery").getEffectiveLevel()'
        )
        self.assertEqual(level, 20)


class ProductionHstsTests(SimpleTestCase):
    def test_defaults_are_the_previous_values(self):
        self.assertEqual(
            _production_setting(
                "[settings.SECURE_HSTS_SECONDS, settings.SECURE_HSTS_INCLUDE_SUBDOMAINS, "
                "settings.SECURE_HSTS_PRELOAD]"
            ),
            [31536000, True, True],
        )

    def test_header_is_byte_identical_with_no_env(self):
        code = (
            "import django; django.setup(); "
            "from django.http import HttpResponse; from django.test import RequestFactory; "
            "from django.middleware.security import SecurityMiddleware; "
            "r = RequestFactory().get('/', secure=True); "
            "print(SecurityMiddleware(lambda req: HttpResponse())(r)['Strict-Transport-Security'])"
        )
        result = _run_production(code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip().splitlines()[-1], "max-age=31536000; includeSubDomains; preload"
        )

    def test_env_turns_preload_and_subdomains_off(self):
        self.assertEqual(
            _production_setting(
                "[settings.SECURE_HSTS_SECONDS, settings.SECURE_HSTS_INCLUDE_SUBDOMAINS, "
                "settings.SECURE_HSTS_PRELOAD]",
                {
                    "SECURE_HSTS_SECONDS": "86400",
                    "SECURE_HSTS_INCLUDE_SUBDOMAINS": "False",
                    "SECURE_HSTS_PRELOAD": "false",
                },
            ),
            [86400, False, False],
        )


class ProductionLogFormatTests(SimpleTestCase):
    def test_json_is_the_default(self):
        formatter = _production_setting('settings.LOGGING["formatters"]["default"]')
        self.assertEqual(formatter, {"()": "root.log_formatting.JsonFormatter"})

    def test_text_keeps_a_plain_format(self):
        formatter = _production_setting(
            'settings.LOGGING["formatters"]["default"]', {"LOG_FORMAT": "text"}
        )
        self.assertIn("{message}", formatter["format"])

    def test_unknown_format_fails_loudly(self):
        result = _run_production("import django; django.setup()", {"LOG_FORMAT": "xml"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("LOG_FORMAT", result.stderr)

    def test_every_console_line_carries_the_request_id(self):
        self.assertEqual(
            _production_setting('settings.LOGGING["handlers"]["console"]["filters"]'),
            ["request_id"],
        )

    def test_a_json_line_is_written_for_app_logs(self):
        code = (
            "import django; django.setup(); import logging; "
            "logging.getLogger('anishows.test').info('hello', extra={'k': 1})"
        )
        result = _run_production(code)
        line = json.loads(result.stderr.strip().splitlines()[-1])
        self.assertEqual((line["message"], line["k"], line["request_id"]), ("hello", 1, "-"))

    def test_request_id_middleware_runs_first(self):
        self.assertEqual(
            _production_setting("settings.MIDDLEWARE[0]"), "root.request_id.RequestIdMiddleware"
        )

    def test_celery_keeps_djangos_handlers(self):
        self.assertIs(_production_setting("settings.CELERY_WORKER_HIJACK_ROOT_LOGGER"), False)


class DatabaseSslModeTests(SimpleTestCase):
    def test_sslmode_only_when_set(self):
        options = _production_setting('settings.DATABASES["default"]["OPTIONS"]')
        self.assertNotIn("sslmode", options)
        options = _production_setting(
            'settings.DATABASES["default"]["OPTIONS"]',
            {"DB_SSLMODE": "require", "DB_SSLROOTCERT": "/certs/ca.pem"},
        )
        self.assertEqual((options["sslmode"], options["sslrootcert"]), ("require", "/certs/ca.pem"))
        # The search option from base.py survives.
        self.assertIn("pg_trgm.word_similarity_threshold", options["options"])

    def test_invalid_sslmode_fails_loudly(self):
        result = _run_production("import django; django.setup()", {"DB_SSLMODE": "yes"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DB_SSLMODE", result.stderr)


class SentryDefaultsTests(SimpleTestCase):
    def test_filter_scrubs_and_drops_noise(self):
        code = (
            "import json, django; django.setup(); "
            "from root.settings import production as p; "
            "kept = p._filter_sentry_event({'request': {'url': '/verify-email/a/b', "
            "'headers': {'Authorization': 'x'}}}, {}); "
            "dropped = p._filter_sentry_event({'logger': 'django.security.DisallowedHost'}, {}); "
            "tx = p._filter_sentry_transaction({'transaction': '/api/v1/health/ready/'}, {}); "
            "print(json.dumps([kept, dropped, tx]))"
        )
        result = _run_production(code)
        self.assertEqual(result.returncode, 0, result.stderr)
        kept, dropped, tx = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(kept["request"], {"url": "/verify-email/<redacted>", "headers": {}})
        self.assertIsNone(dropped)
        self.assertIsNone(tx)
