import ipaddress
from unittest.mock import patch

import httpx
from django.core.cache import cache
from django.test import SimpleTestCase

from ..services.metadata_service import MetadataService
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


PUBLIC_IP = [ipaddress.ip_address("93.184.216.34")]


@patch.object(URLValidator, "_resolve_public_ips", return_value=PUBLIC_IP)
class URLValidatorNormalizationTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_rejects_embedded_credentials(self, _resolve):
        validator = URLValidator()
        for url in (
            "https://youtube.com@evil.example/",
            "https://user:pass@github.com/",
            "youtube.com@evil.example",
        ):
            with self.subTest(url=url):
                is_valid, error, _ = validator.validate(url)
                self.assertFalse(is_valid)
                self.assertIn("credentials", error)

    def test_port_normalization_does_not_mangle_host(self, _resolve):
        validator = URLValidator()
        self.assertEqual(
            validator._normalize_url("https://Example.com:4433/a"), "https://example.com:4433/a"
        )
        self.assertEqual(validator._normalize_url("https://example.com:443/a"), "https://example.com/a")

    def test_platform_detected_from_host_not_netloc(self, _resolve):
        is_valid, _, metadata = URLValidator().validate("https://github.com:443/me")
        self.assertTrue(is_valid)
        self.assertEqual(metadata["platform"], "github")

    def test_unexpected_errors_are_not_cached(self, resolve):
        validator = URLValidator()
        resolve.side_effect = RuntimeError("resolver crashed")
        self.assertFalse(validator.validate("https://github.com/me")[0])

        resolve.side_effect = None
        self.assertTrue(validator.validate("https://github.com/me")[0])


class MetadataServiceTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def _fetch(self, handler):
        service = MetadataService()
        transport = httpx.MockTransport(handler)
        real_client = httpx.Client

        def client_factory(**kwargs):
            return real_client(transport=transport, **kwargs)

        with (
            patch.object(URLValidator, "_resolve_public_ips", return_value=PUBLIC_IP),
            patch("apps.core.services.metadata_service.httpx.Client", side_effect=client_factory),
        ):
            return service._scrape_metadata("https://example.com/")

    def test_scraped_urls_must_be_http(self):
        html = (
            '<html><head><title>Page</title><link rel="icon" href="javascript:alert(1)">'
            '<meta property="og:image" content="javascript:alert(1)"></head></html>'
        )
        metadata = self._fetch(lambda request: httpx.Response(200, text=html))
        self.assertEqual(metadata["title"], "Page")  # the page itself was parsed
        self.assertIsNone(metadata["image"])
        self.assertTrue(metadata["favicon"].startswith("https://"))

    def test_body_is_capped(self):
        huge = "<html><head><title>Hi</title></head>" + "x" * (4 * MetadataService.MAX_BODY_BYTES)
        metadata = self._fetch(lambda request: httpx.Response(200, text=huge))
        self.assertEqual(metadata["title"], "Hi")

    def test_redirect_to_private_address_is_blocked(self):
        def handler(request):
            return httpx.Response(302, headers={"location": "https://127.0.0.1/admin"})

        metadata = self._fetch(handler)
        self.assertEqual(metadata["title"], "example.com")  # fallback, nothing fetched
