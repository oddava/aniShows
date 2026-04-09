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
        self.assertIn("meta property=\"og:title\"", content)
        self.assertIn("meta name=\"twitter:description\"", content)

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

    def test_telegram_crawler_preview_does_not_include_redirect(self):
        user = User.objects.create_user(username="tguser", password="pw")
        UserStats.objects.create(user=user, anime_count=12)

        response = self.client.get("/u/tguser", HTTP_USER_AGENT="Telegram/10.9")

        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("tguser on AniShows", content)
        self.assertNotIn("http-equiv=\"refresh\"", content)
        self.assertNotIn("window.location.replace", content)

    def test_regular_browser_preview_keeps_redirect(self):
        user = User.objects.create_user(username="browseruser", password="pw")

        response = self.client.get(
            "/u/browseruser",
            HTTP_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )

        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("http-equiv=\"refresh\"", content)
        self.assertIn("window.location.replace", content)
