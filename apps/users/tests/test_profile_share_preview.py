"""Profile pages (/u/<username>) get their own <head> in the SPA shell (RA-001)."""

import json
import re
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from ..models import UserProfile, UserStats

User = get_user_model()

BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
ORIGIN = "https://anishows.example"


def _json_ld(html: str) -> list[dict]:
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return [json.loads(block) for block in blocks]


@override_settings(FRONTEND_URL=ORIGIN)
class ProfileShellTests(TestCase):
    def test_public_profile_has_personalized_metadata_for_everyone(self):
        user = User.objects.create_user(username="oddava", password="pw")
        profile = UserProfile.objects.get(user=user)
        profile.bio = "<p>Tracking every seasonal show and writing short reviews.</p>"
        profile.save(update_fields=["bio"])
        UserStats.objects.create(user=user, anime_count=128, followers_count=42, reviews_count=9)

        for agent in ("facebookexternalhit/1.1", BROWSER, "curl/8.5"):
            with self.subTest(agent=agent):
                response = self.client.get("/u/oddava", HTTP_USER_AGENT=agent)
                self.assertEqual(response.status_code, 200)
                content = response.content.decode()
                self.assertIn("<title>oddava on AniShows</title>", content)
                self.assertIn("128 anime tracked, 42 followers, 9 reviews", content)
                self.assertIn(f'<meta property="og:url" content="{ORIGIN}/u/oddava" />', content)
                self.assertIn('<meta property="og:type" content="profile" />', content)
                self.assertIn('<meta name="twitter:description"', content)
                # The app itself, not a redirect page.
                self.assertIn('<div id="root"></div>', content)
                self.assertNotIn('http-equiv="refresh"', content)

        (data,) = _json_ld(content)
        self.assertEqual(data["@type"], "ProfilePage")
        self.assertEqual(data["mainEntity"]["@type"], "Person")
        self.assertEqual(data["mainEntity"]["name"], "oddava")
        self.assertEqual(data["mainEntity"]["interactionStatistic"]["userInteractionCount"], 42)

    def test_banner_is_the_card_and_is_preloaded(self):
        user = User.objects.create_user(username="banner", password="pw")
        UserProfile.objects.filter(user=user).update(banner="banners/1/b.webp")

        # The URL the profile API returns for it (field_media_url, as there).
        with mock.patch(
            "apps.users.share_preview.field_media_url", return_value="/media/banners/1/b.webp"
        ):
            content = self.client.get("/u/banner").content.decode()

        self.assertIn('<meta name="twitter:card" content="summary_large_image" />', content)
        self.assertRegex(content, r'<meta property="og:image" content="[^"]*banners/1/b\.webp" />')
        self.assertRegex(
            content,
            r'<link rel="preload" as="image" href="[^"]*banners/1/b\.webp" fetchpriority="high" />',
        )

    def test_private_profile_says_nothing(self):
        user = User.objects.create_user(username="secret", password="pw")
        UserProfile.objects.filter(user=user).update(bio="This should not appear", is_private=True)
        UserStats.objects.create(user=user, anime_count=7)

        response = self.client.get("/u/secret", HTTP_USER_AGENT="Discordbot/2.0")

        self.assertEqual(response.status_code, 404)
        content = response.content.decode()
        self.assertIn("Profile not found | AniShows", content)
        self.assertNotIn("This should not appear", content)
        self.assertNotIn("7 anime", content)
        self.assertIn('<meta name="robots" content="noindex" />', content)
        self.assertEqual(_json_ld(content), [])

    def test_private_and_missing_profiles_look_the_same(self):
        user = User.objects.create_user(username="hidden", password="pw")
        UserProfile.objects.filter(user=user).update(is_private=True)

        private = self.client.get("/u/hidden")
        missing = self.client.get("/u/nobody-here")

        self.assertEqual(private.status_code, missing.status_code)
        self.assertEqual(
            private.content.decode().replace("hidden", "X"),
            missing.content.decode().replace("nobody-here", "X"),
        )

    def test_section_path_and_canonical_case(self):
        User.objects.create_user(username="Hostile", password="pw")

        content = self.client.get("/u/HOSTILE/reviews").content.decode()

        self.assertIn("Hostile - Reviews | AniShows", content)
        self.assertIn(f'href="{ORIGIN}/u/Hostile/reviews"', content)


@override_settings(FRONTEND_URL=ORIGIN)
class SharePreviewHardeningTests(TestCase):
    """Hostile profile data stays inert in the page's <head> (A17, P1-15)."""

    def setUp(self):
        self.user = User.objects.create_user(username="Hostile", password="pw")
        UserProfile.objects.filter(user=self.user).update(
            bio='"><script>alert(1)</script><img src=x onerror=alert(2)> Likes <b>mecha</b> & more'
        )

    def test_hostile_bio_is_escaped(self):
        for agent in ("Discordbot/2.0", BROWSER):
            with self.subTest(agent=agent):
                content = self.client.get("/u/hostile", HTTP_USER_AGENT=agent).content.decode()
                self.assertNotIn("<script>alert", content)
                self.assertNotIn("<img", content)
                self.assertNotIn("onerror=alert", content.replace("&quot;", ""))
                self.assertIn("Likes mecha &amp; more", content)

    def test_hostile_section_is_escaped(self):
        content = self.client.get(
            "/u/hostile/%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E"
        ).content.decode()
        self.assertNotIn("<script>alert", content)
        self.assertNotIn('">', content.split("<title>")[1].split("</title>")[0])
