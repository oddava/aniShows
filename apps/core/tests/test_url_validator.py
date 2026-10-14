from django.core.cache import cache
from django.test import SimpleTestCase

from ..services.url_validator import URLValidator


class URLValidatorSecurityTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_platform_detection_uses_host_boundaries(self):
        validator = URLValidator()

        self.assertEqual(validator._detect_platform("github.com"), "github")
        self.assertEqual(validator._detect_platform("profiles.github.com"), "github")
        self.assertIsNone(validator._detect_platform("github.com.evil.test"))

    def test_safe_browsing_failure_is_fail_closed_by_default(self):
        class FailingSafeBrowsingClient:
            def threatMatches(self):  # noqa: N802 - mirrors the Google API client
                raise RuntimeError("api unavailable")

        validator = URLValidator(google_safe_browsing_api_key="key")
        validator._safe_browsing_client = FailingSafeBrowsingClient()

        result = validator._check_safe_browsing("https://example.com")

        self.assertFalse(result["safe"])
        self.assertEqual(result["threat"], "validation unavailable")

    def test_safe_browsing_failure_can_be_configured_fail_open(self):
        class FailingSafeBrowsingClient:
            def threatMatches(self):  # noqa: N802 - mirrors the Google API client
                raise RuntimeError("api unavailable")

        validator = URLValidator(
            google_safe_browsing_api_key="key",
            safe_browsing_fail_open=True,
        )
        validator._safe_browsing_client = FailingSafeBrowsingClient()

        result = validator._check_safe_browsing("https://example.com")

        self.assertTrue(result["safe"])
        self.assertIsNone(result["threat"])
