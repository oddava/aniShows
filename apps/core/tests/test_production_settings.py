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


def _production_setting(expression: str):
    code = (
        "import json, django; django.setup(); from django.conf import settings; "
        f"print(json.dumps({expression}))"
    )
    env = {**os.environ, **PRODUCTION_ENV}
    env.pop("SENTRY_DSN", None)
    # A fresh interpreter: production settings must not leak into this process.
    output = subprocess.run(  # noqa: S603 - fixed interpreter and code
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    ).stdout
    return json.loads(output.strip().splitlines()[-1])


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
