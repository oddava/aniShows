"""GOOGLE_SAFE_BROWSING_API_KEY is read from the environment and its absence is flagged.

The key used to be fetched with ``getattr(settings, ..., None)`` but never set in
settings, so the Safe Browsing check could not run even with the key exported.
"""

import os
import subprocess
import sys

from django.test import SimpleTestCase, override_settings

from apps.core.checks import safe_browsing_key_check
from apps.core.services.social_links_service import SocialLinksService


class SafeBrowsingKeyTests(SimpleTestCase):
    def test_key_comes_from_the_environment(self):
        code = "from root.settings import base; print(repr(base.GOOGLE_SAFE_BROWSING_API_KEY))"
        env = {
            **os.environ,
            "DJANGO_SECRET_KEY": "x",
            "GOOGLE_SAFE_BROWSING_API_KEY": " test-key ",
        }
        env.pop("SENTRY_DSN", None)
        output = subprocess.run(  # noqa: S603 - fixed interpreter and code
            [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
        ).stdout
        self.assertEqual(output.strip().splitlines()[-1], "'test-key'")

    @override_settings(GOOGLE_SAFE_BROWSING_API_KEY="test-key")
    def test_validator_gets_the_key(self):
        service = SocialLinksService()
        self.assertEqual(service.validator.google_safe_browsing_api_key, "test-key")

    @override_settings(GOOGLE_SAFE_BROWSING_API_KEY="")
    def test_missing_key_is_a_deploy_warning(self):
        self.assertIsNone(SocialLinksService().validator.google_safe_browsing_api_key)
        warnings = safe_browsing_key_check(None)
        self.assertEqual([warning.id for warning in warnings], ["core.W001"])

    @override_settings(GOOGLE_SAFE_BROWSING_API_KEY="test-key")
    def test_configured_key_passes_the_check(self):
        self.assertEqual(safe_browsing_key_check(None), [])
