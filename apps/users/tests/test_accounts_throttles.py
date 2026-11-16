"""Throttles on account endpoints (A03, A09)."""

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import UserProfile

User = get_user_model()

STORED_LINKS = [
    {
        "platform": platform,
        "url": url,
        "value": url,
        "normalized_url": url,
        "domain": domain,
        "detected_platform": platform,
        "trust_level": "verified",
        "metadata": {},
        "metadata_pending": False,
    }
    for platform, url, domain in (
        ("twitter", "https://twitter.com/someone", "twitter.com"),
        ("github", "https://github.com/someone", "github.com"),
        ("youtube", "https://youtube.com/@someone", "youtube.com"),
    )
]


class SocialLinksThrottleTests(APITestCase):
    """The 5/day social-links throttle (live in test settings) counts real changes only."""

    def setUp(self):
        # date_joined is now, so the stricter new-account rate (5/day) applies.
        self.user = User.objects.create_user(
            username="linker", email="linker@example.com", password="securepass123"
        )
        UserProfile.objects.filter(user=self.user).update(social_links=STORED_LINKS)
        self.client.force_authenticate(self.user)
        self.url = reverse("user_profile")

    def _form_links(self):
        # What Settings sends back: {platform, value} built from the stored links.
        return json.dumps([{"platform": link["platform"], "value": link["url"]} for link in STORED_LINKS])

    @patch("apps.core.services.url_validator.URLValidator.validate")
    def test_bio_saves_resending_unchanged_links_skip_validation_and_throttle(self, validate):
        for attempt in range(6):
            with self.subTest(attempt=attempt):
                response = self.client.patch(
                    self.url,
                    {"bio": f"bio {attempt}", "social_links": self._form_links()},
                    format="multipart",
                )
                self.assertEqual(response.status_code, status.HTTP_200_OK)
        validate.assert_not_called()
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.bio, "bio 5")
        self.assertEqual(profile.social_links, STORED_LINKS)

    @patch(
        "apps.users.services.profile_update_service.SocialLinksService.validate_and_process",
        side_effect=lambda links: [
            {**link, "url": link["value"], "normalized_url": link["value"]} for link in links
        ],
    )
    def test_real_link_changes_are_throttled_after_five(self, _validate):
        statuses = []
        for attempt in range(6):
            body = json.dumps([{"platform": "website", "value": f"https://example{attempt}.com"}])
            response = self.client.patch(self.url, {"social_links": body}, format="multipart")
            statuses.append(response.status_code)
        self.assertEqual(statuses[:5], [status.HTTP_200_OK] * 5)
        self.assertEqual(statuses[5], status.HTTP_429_TOO_MANY_REQUESTS)

    def test_unparseable_links_still_report_a_validation_error(self):
        response = self.client.patch(self.url, {"social_links": "{not json"}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
