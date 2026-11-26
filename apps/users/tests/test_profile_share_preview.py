from django.contrib.auth import get_user_model
from django.test import TestCase

from ..models import UserProfile, UserStats

User = get_user_model()


class ProfileSharePreviewViewTests(TestCase):
    def test_public_profile_preview_uses_personalized_metadata(self):
        user = User.objects.create_user(username="oddava", password="pw")
        profile = UserProfile.objects.get(user=user)
        profile.bio = "<p>Tracking every seasonal show and writing short reviews.</p>"
        profile.save(update_fields=["bio"])
        UserStats.objects.create(
            user=user,
            anime_count=128,
            followers_count=42,
            reviews_count=9,
        )

        response = self.client.get("/u/oddava", HTTP_USER_AGENT="facebookexternalhit/1.1")

        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("oddava on AniShows", content)
        self.assertIn("128 anime tracked", content)
        self.assertIn("42 followers", content)
        self.assertIn('meta property="og:title"', content)
        self.assertIn('meta name="twitter:description"', content)

    def test_private_profile_preview_returns_not_found_for_unauthorized_viewer(self):
        user = User.objects.create_user(username="secret", password="pw")
        profile = UserProfile.objects.get(user=user)
        profile.bio = "This should not appear"
        profile.is_private = True
        profile.save(update_fields=["bio", "is_private"])

        response = self.client.get("/u/secret", HTTP_USER_AGENT="Discordbot/2.0")

        self.assertEqual(response.status_code, 404)
        content = response.content.decode()
        self.assertIn("Profile Not Found | AniShows", content)
        self.assertIn("could not be found", content)
        self.assertNotIn("This should not appear", content)

    def test_missing_profile_returns_not_found_metadata(self):
        response = self.client.get("/u/missing-user", HTTP_USER_AGENT="Slackbot 1.0")

        self.assertEqual(response.status_code, 404)
        content = response.content.decode()
        self.assertIn("Profile Not Found | AniShows", content)
        self.assertIn("could not be found", content)
        # The 1200x630 link-preview card, not the square app icon.
        self.assertIn('content="http://testserver/og-image.png"', content)

    def test_telegram_crawler_preview_does_not_include_redirect(self):
        user = User.objects.create_user(username="tguser", password="pw")
        UserStats.objects.create(user=user, anime_count=12)

        response = self.client.get("/u/tguser", HTTP_USER_AGENT="Telegram/10.9")

        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("tguser on AniShows", content)
        self.assertNotIn('http-equiv="refresh"', content)
        self.assertNotIn("window.location.replace", content)

    def test_regular_browser_preview_keeps_redirect(self):
        User.objects.create_user(username="browseruser", password="pw")

        response = self.client.get(
            "/u/browseruser",
            HTTP_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )

        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn('http-equiv="refresh"', content)
        # No inline script: the page's CSP would block it (A17).
        self.assertNotIn("<script", content)

    def test_missing_profile_does_not_redirect_a_browser_to_itself(self):
        response = self.client.get(
            "/u/missing-user",
            HTTP_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )

        content = response.content.decode()
        self.assertIn('content="0;url=http://testserver/profile/missing-user"', content)
        self.assertNotIn('content="0;url=http://testserver/u/', content)


class SharePreviewHardeningTests(TestCase):
    """Hostile profile data stays inert in the preview HTML (A17, P1-15)."""

    BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    def setUp(self):
        self.user = User.objects.create_user(username="Hostile", password="pw")
        UserProfile.objects.filter(user=self.user).update(
            bio='"><script>alert(1)</script><img src=x onerror=alert(2)> Likes <b>mecha</b> & more'
        )

    def test_hostile_bio_is_escaped_for_crawlers_and_browsers(self):
        for agent in ("Discordbot/2.0", self.BROWSER):
            with self.subTest(agent=agent):
                content = self.client.get("/u/hostile", HTTP_USER_AGENT=agent).content.decode()
                self.assertNotIn("<script", content)
                self.assertNotIn("<img", content)
                self.assertNotIn("onerror=alert", content.replace("&quot;", ""))
                self.assertIn("Likes mecha &amp; more", content)

    def test_section_path_and_canonical_case(self):
        content = self.client.get(
            "/u/HOSTILE/reviews", HTTP_USER_AGENT=self.BROWSER
        ).content.decode()
        self.assertIn("Hostile - Reviews | AniShows", content)
        self.assertIn('href="http://testserver/u/Hostile/reviews"', content)
        self.assertIn("url=http://testserver/profile/Hostile/reviews", content)

    def test_hostile_section_is_escaped(self):
        content = self.client.get(
            "/u/hostile/%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E", HTTP_USER_AGENT=self.BROWSER
        ).content.decode()
        self.assertNotIn("<script", content)
