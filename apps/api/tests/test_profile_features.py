from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta
from apps.users.models import UserProfile, UserAnimeList
from apps.anime.models import Anime, UserFavorite
from unittest.mock import patch

User = get_user_model()


class ProfileFeaturesTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="mainuser", email="main@example.com", password="password123"
        )
        self.profile, _ = UserProfile.objects.update_or_create(
            user=self.user, defaults={"email_verified": True}
        )
        self.client.force_authenticate(user=self.user)

        # URLs
        self.profile_url = reverse("user_profile")
        self.change_password_url = reverse("change_password")
        # Public profile URL: /api/users/<username>/
        self.public_profile_url = lambda username: reverse(
            "users-detail", kwargs={"username": username}
        )

    def test_profile_update_social_links(self):
        """Test adding and removing social links."""
        # 1. Add links (mixture of usernames and full URLs)
        # Note: Domains must be from the allowed whitelist
        data = {
            "social_links": [
                {"platform": "Twitter", "value": "testuser"},
                {"platform": "GitHub", "value": "testuser"},
                {"platform": "YouTube", "value": "https://youtube.com/@testuser"},
            ]
        }
        res = self.client.patch(self.profile_url, data, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()

        # Verify normalization and storage
        links = self.profile.social_links
        self.assertEqual(len(links), 3)
        # Twitter should be normalized
        twitter_link = next(l for l in links if l["platform"] == "Twitter")
        self.assertEqual(twitter_link["value"], "https://x.com/testuser")

        # GitHub should be normalized
        github_link = next(l for l in links if l["platform"] == "GitHub")
        self.assertEqual(github_link["value"], "https://github.com/testuser")

        # YouTube should be normalized
        youtube_link = next(l for l in links if l["platform"] == "YouTube")
        self.assertEqual(youtube_link["value"], "https://youtube.com/@testuser")

        # 2. Clear links
        data = {"social_links": []}
        res = self.client.patch(self.profile_url, data, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertEqual(len(self.profile.social_links), 0)

    def test_profile_update_basic_info(self):
        """Test updating bio and ensure XSS sanitization."""
        # 1. Normal Update
        data = {"bio": "Hello world"}
        res = self.client.patch(self.profile_url, data)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.bio, "Hello world")

        # 2. XSS Attempt
        data = {"bio": '<script>alert("xss")</script>'}
        res = self.client.patch(self.profile_url, data)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        # Should be escaped
        self.assertNotEqual(self.profile.bio, '<script>alert("xss")</script>')
        self.assertIn("&lt;script&gt;", self.profile.bio)

    def test_username_change_constraints(self):
        """Test username change logic and cooldown."""
        # 1. Successful change
        data = {"username": "newname"}
        res = self.client.patch(self.profile_url, data)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, "newname")

        # 2. Attempt change immediately again (should fail due to 14 day cooldown)
        data = {"username": "anothername"}
        res = self.client.patch(self.profile_url, data)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("days", str(res.data["username"]))

        # 3. Simulate 15 days later
        self.profile.refresh_from_db()
        self.profile.last_username_change = timezone.now() - timedelta(days=15)
        self.profile.save()

        # 4. Attempt change to taken username
        User.objects.create_user(username="takenname", password="pw")
        data = {"username": "takenname"}
        res = self.client.patch(self.profile_url, data)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_change_password(self):
        """Test password change validation."""
        # 1. Wrong old password
        data = {"old_password": "wrong", "new_password": "newpassword123"}
        res = self.client.post(self.change_password_url, data)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Success
        data = {"old_password": "password123", "new_password": "newpassword123"}
        res = self.client.post(self.change_password_url, data)
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Verify login works with new password
        self.client.logout()
        login = self.client.login(username="mainuser", password="newpassword123")
        self.assertTrue(login)

    def test_privacy_toggle_visibility(self):
        """Test private profile visibility."""
        # 1. Set to Private
        res = self.client.patch(self.profile_url, {"is_private": True})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 2. Another user viewing
        other_user = User.objects.create_user(username="viewer", password="pw")
        self.client.force_authenticate(user=other_user)

        res = self.client.get(self.public_profile_url("mainuser"))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data["is_private"])

        # Verify lists endpoint (should return empty/blocked)
        # Using UserAnimeListViewSet logic: if user.profile.is_private -> returns empty
        list_url = reverse("lists-list") + f"?username=mainuser"
        res = self.client.get(list_url)
        self.assertEqual(len(res.data["results"]), 0)

    def test_computed_statistics(self):
        """Test mean_score, anime_count, days_watched calculation."""
        # Create Dummy Anime and List Entries
        anime1 = Anime.objects.create(
            title="Anime 1", slug="anime-1", episode_count=12, duration_minutes=24
        )
        anime2 = Anime.objects.create(
            title="Anime 2", slug="anime-2", episode_count=24, duration_minutes=24
        )

        # Add to list
        UserAnimeList.objects.create(
            user=self.user,
            anime=anime1,
            status="Completed",
            score=8,
            episodes_watched=12,
        )
        UserAnimeList.objects.create(
            user=self.user,
            anime=anime2,
            status="Watching",
            score=0,  # Unscored
            episodes_watched=12,
        )

        # Calculated Expected:
        # Anime Count: 2
        # Mean Score: Only counted scored items. (8) / 1 = 8.0.
        # Days Watched: (12*24 + 12*24) / 1440 = (288 + 288) / 1440 = 576 / 1440 = 0.4

        res = self.client.get(self.profile_url)
        stats = res.data

        self.assertEqual(stats["anime_count"], 2)
        self.assertEqual(stats["mean_score"], 8.0)
        self.assertEqual(stats["days_watched"], 0.4)
