"""WHOIS and Safe Browsing run after the save, not inside PATCH /users/me/ (A16, A34)."""

import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ...users.models import UserProfile
from ...users.services.cache import get_user_profile_cache_key
from ..services.social_links_service import SocialLinksService
from ..services.url_validator import URLValidator
from ..tasks import fetch_multiple_link_metadata

User = get_user_model()


def _public_ips(self, hostname, *args, **kwargs):
    import ipaddress

    return [ipaddress.ip_address("93.184.216.34")]


@patch.object(URLValidator, "_resolve_public_ips", _public_ips)
class SaveWithoutSlowChecksTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fast", email="f@example.com", password="x")
        self.client.force_authenticate(self.user)

    @patch.object(URLValidator, "_check_safe_browsing")
    @patch.object(URLValidator, "_get_domain_age")
    def test_patch_with_an_unknown_domain_runs_no_whois_or_safe_browsing(self, age, safe):
        with self.settings(GOOGLE_SAFE_BROWSING_API_KEY="key"):
            response = self.client.patch(
                reverse("user_profile"),
                {"social_links": '[{"platform": "website", "value": "https://brand-new.example"}]'},
                format="multipart",
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        age.assert_not_called()
        safe.assert_not_called()
        links = UserProfile.objects.get(user=self.user).social_links
        self.assertEqual(links[0]["url"], "https://brand-new.example")


@patch.object(URLValidator, "_resolve_public_ips", _public_ips)
class ReputationTaskTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="later", email="l@example.com", password="x")
        UserProfile.objects.filter(user=self.user).update(
            social_links=[
                {
                    "platform": "website",
                    "url": url,
                    "value": url,
                    "trust_level": "unknown",
                    "metadata": {},
                    "metadata_pending": True,
                    "validation": {"subdomain_count": 0},
                }
                for url in ("https://young.example", "https://github.com/later")
            ]
        )

    def _links(self):
        return {link["url"]: link for link in UserProfile.objects.get(user=self.user).social_links}

    @patch("apps.core.services.celery_tasks.MetadataService.fetch_metadata", return_value={"t": 1})
    @patch.object(URLValidator, "_get_domain_age", return_value=2)
    def test_new_domain_is_flagged_not_fetched_and_the_rest_get_metadata(self, _age, fetch):
        result = fetch_multiple_link_metadata.apply(
            args=[["https://young.example", "https://github.com/later"], self.user.id]
        ).get()

        self.assertEqual(result["flagged"], 1)
        fetch.assert_called_once_with("https://github.com/later")
        links = self._links()
        young = links["https://young.example"]
        self.assertEqual(young["trust_level"], "suspicious")
        self.assertFalse(young["metadata_pending"])
        self.assertIn("too new", young["validation"]["warning"])
        self.assertEqual(young["validation"]["subdomain_count"], 0)
        self.assertEqual(links["https://github.com/later"]["metadata"], {"t": 1})
        self.assertEqual(links["https://github.com/later"]["trust_level"], "unknown")

    @patch.object(URLValidator, "_get_domain_age", return_value=None)
    @patch.object(
        URLValidator, "_check_safe_browsing", return_value={"safe": False, "threat": "MALWARE"}
    )
    def test_safe_browsing_match_is_flagged(self, _safe, _age):
        service = SocialLinksService()
        service.validator.google_safe_browsing_api_key = "key"
        problems = service.reputation_problems(["https://young.example"])
        self.assertIn("MALWARE", problems["https://young.example"])
        self.assertEqual(service.flag_suspicious_links(self.user.id, problems), 1)

    @patch("apps.core.services.celery_tasks.MetadataService.fetch_metadata", return_value={"t": 1})
    @patch.object(URLValidator, "_get_domain_age", return_value=400)
    def test_own_profile_cache_is_dropped_after_the_task(self, _age, _fetch):
        key = get_user_profile_cache_key(self.user.id)
        cache.set(key, {"stale": True}, 300)

        fetch_multiple_link_metadata.apply(args=[["https://github.com/later"], self.user.id]).get()

        self.assertIsNone(cache.get(key))


class WhoisTimeoutTests(TestCase):
    def test_slow_whois_gives_up_after_the_timeout(self):
        def slow_whois(_domain):
            time.sleep(2)
            raise AssertionError("should have timed out first")

        validator = URLValidator()
        with (
            patch.object(URLValidator, "WHOIS_TIMEOUT_SECONDS", 0.2),
            patch("apps.core.services.url_validator.whois.whois", side_effect=slow_whois),
        ):
            started = time.monotonic()
            self.assertIsNone(validator._get_domain_age("slow.example"))
        self.assertLess(time.monotonic() - started, 1.5)

    def test_full_validate_still_runs_the_reputation_checks_by_default(self):
        with (
            patch.object(URLValidator, "_resolve_public_ips", _public_ips),
            patch.object(URLValidator, "_get_domain_age", return_value=1) as age,
        ):
            valid, message, _meta = URLValidator().validate("https://fresh.example")
        self.assertFalse(valid)
        self.assertIn("too new", message)
        age.assert_called_once()
