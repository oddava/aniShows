"""Throttles on account endpoints (A03, A09)."""

import json
from typing import Any
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
        return json.dumps(
            [{"platform": link["platform"], "value": link["url"]} for link in STORED_LINKS]
        )

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


# Any-valued so mypy does not map it onto APIClient.post(follow: bool).
XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class LoginIdentifierThrottleTests(APITestCase):
    """Failures per identifier lock it whatever IP they come from (A09)."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="target", email="target@example.com", password="right-password-1"
        )
        self.url = reverse("token_obtain_pair")

    def _login(self, password, ip, username="target"):
        return self.client.post(
            self.url,
            {"username": username, "password": password},
            format="json",
            REMOTE_ADDR=ip,
            **XHR,
        )

    def test_eleventh_failure_from_rotating_ips_is_429(self):
        for attempt in range(10):
            response = self._login("wrong", f"10.0.0.{attempt}")
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        response = self._login("wrong", "10.0.1.1")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertLessEqual(int(response["Retry-After"]), 15 * 60)
        # Even the right password waits until the lock ends.
        self.assertEqual(
            self._login("right-password-1", "10.0.1.2").status_code,
            status.HTTP_429_TOO_MANY_REQUESTS,
        )

    def test_identifier_case_and_spacing_share_one_counter(self):
        for attempt in range(10):
            self._login(
                "wrong", f"10.0.2.{attempt}", username=" TARGET " if attempt % 2 else "target"
            )
        self.assertEqual(
            self._login("wrong", "10.0.3.1").status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )

    def test_success_resets_the_counter(self):
        for attempt in range(9):
            self._login("wrong", f"10.0.4.{attempt}")
        self.assertEqual(
            self._login("right-password-1", "10.0.4.99").status_code, status.HTTP_200_OK
        )
        for attempt in range(9):
            self.assertEqual(
                self._login("wrong", f"10.0.5.{attempt}").status_code,
                status.HTTP_401_UNAUTHORIZED,
            )

    def test_other_identifiers_are_unaffected(self):
        for attempt in range(10):
            self._login("wrong", f"10.0.6.{attempt}")
        self.assertEqual(
            self._login("wrong", "10.0.6.50", username="someone-else").status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_validation_errors_do_not_count(self):
        for attempt in range(12):
            response = self.client.post(
                self.url, {"password": "x"}, format="json", REMOTE_ADDR=f"10.0.7.{attempt}", **XHR
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ScopedThrottleTests(APITestCase):
    """New scopes; their real rates are patched in (test settings relax every scope)."""

    def test_resend_verification_has_its_own_bucket(self):
        from ..throttling import PasswordResetRateThrottle, ResendVerificationRateThrottle

        with (
            patch.object(ResendVerificationRateThrottle, "rate", "3/hour", create=True),
            patch.object(PasswordResetRateThrottle, "rate", "3/hour", create=True),
        ):
            for _ in range(3):
                self.client.post(reverse("resend_verification"), {"email": "a@b.c"}, format="json")
            resend = self.client.post(
                reverse("resend_verification"), {"email": "a@b.c"}, format="json"
            )
            reset = self.client.post(reverse("password_reset"), {"email": "a@b.c"}, format="json")

        self.assertEqual(resend.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(reset.status_code, status.HTTP_200_OK)

    def test_change_email_is_limited_per_user(self):
        from ..throttling import ChangeEmailRateThrottle

        user = User.objects.create_user(
            username="mover", email="mover@example.com", password="securepass123"
        )
        self.client.force_authenticate(user)
        with patch.object(ChangeEmailRateThrottle, "rate", "5/hour", create=True):
            statuses = [
                self.client.post(
                    reverse("change_email"),
                    {"new_email": f"n{index}@example.com", "password": "securepass123"},
                    format="json",
                ).status_code
                for index in range(6)
            ]
        self.assertEqual(statuses[:5], [status.HTTP_200_OK] * 5)
        self.assertEqual(statuses[5], status.HTTP_429_TOO_MANY_REQUESTS)

    def test_configured_rates(self):
        from django.conf import settings

        from root.settings import base

        rates = base.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        assert isinstance(rates, dict)
        self.assertEqual(rates["resend_verification"], "3/hour")
        self.assertEqual(rates["change_email"], "5/hour")
        self.assertEqual(settings.LOGIN_IDENTIFIER_MAX_FAILURES, 10)
        self.assertEqual(settings.LOGIN_IDENTIFIER_WINDOW_SECONDS, 900)


class LoginLockKeyTests(APITestCase):
    """The lock is keyed on the identifier as typed, not the resolved account."""

    def setUp(self):
        User.objects.create_user(username="Twin", email="twin@example.com", password="right-pass-1")

    def _fail(self, field, value, ip):
        return self.client.post(
            reverse("token_obtain_pair"),
            {field: value, "password": "wrong"},
            format="json",
            REMOTE_ADDR=ip,
            **XHR,
        )

    def test_a_locked_username_does_not_reveal_its_email(self):
        for attempt in range(10):
            self._fail("username", "twin", f"10.9.0.{attempt}")
        self.assertEqual(
            self._fail("username", "TWIN", "10.9.1.1").status_code,
            status.HTTP_429_TOO_MANY_REQUESTS,
        )
        # The real email and an unknown one look the same: no oracle.
        real = self._fail("email", "twin@example.com", "10.9.1.2")
        unknown = self._fail("email", "nobody@example.com", "10.9.1.3")
        self.assertEqual(real.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(real.data, unknown.data)


class SocialLinksOrderTests(APITestCase):
    def test_reordering_links_is_saved(self):
        user = User.objects.create_user(username="orderly", email="ord@example.com", password="x")
        UserProfile.objects.filter(user=user).update(social_links=STORED_LINKS)
        self.client.force_authenticate(user)
        reordered = [
            {"platform": link["platform"], "value": link["url"]} for link in reversed(STORED_LINKS)
        ]
        with patch(
            "apps.users.services.profile_update_service.SocialLinksService.validate_and_process",
            side_effect=lambda links: [
                {**link, "url": link["value"], "normalized_url": link["value"]} for link in links
            ],
        ):
            response = self.client.patch(
                reverse("user_profile"), {"social_links": json.dumps(reordered)}, format="multipart"
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        stored = UserProfile.objects.get(user=user).social_links
        self.assertEqual([link["platform"] for link in stored], ["youtube", "github", "twitter"])
