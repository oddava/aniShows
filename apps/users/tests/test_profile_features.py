from datetime import timedelta
from unittest.mock import patch

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.animes.models import Anime, UserFavorite
from apps.users.models import UserAnimeList, UserProfile

User = get_user_model()

class ProfileFeaturesTest(APITestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()

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

    @patch("apps.animes.signals.enrich_metadata")
    @patch("apps.animes.signals.generate_recommendations")
    def test_computed_statistics(self, mock_recommendations, mock_enrich):
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

        # Trigger stats update manually since it's normally a periodic task
        # and the view only triggers it asynchronously if missing (returning 0s first time)
        from apps.users.tasks import update_user_stats

        update_user_stats(self.user.id)

        res = self.client.get(self.profile_url)
        stats = res.data

        self.assertEqual(stats["anime_count"], 2)
        self.assertEqual(stats["mean_score"], 8.0)
        self.assertEqual(stats["days_watched"], 0.4)

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

    def test_current_profile_falls_back_to_google_avatar_for_email_signup(self):
        """Email-first users should still expose linked Google avatars."""
        google_avatar = "https://lh3.googleusercontent.com/a/notjony-avatar=s96-c"
        SocialAccount.objects.create(
            user=self.user,
            provider="google",
            uid="google-mainuser",
            extra_data={"picture": google_avatar},
        )

        res = self.client.get(self.profile_url)

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["avatar"], google_avatar)

    def test_public_profile_falls_back_to_google_avatar_for_email_signup(self):
        """Public profile payload should use linked Google avatars when no upload exists."""
        other_user = User.objects.create_user(
            username="notJony",
            email="notjony@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=other_user, defaults={"email_verified": True})
        google_avatar = "https://lh3.googleusercontent.com/a/notjony-public=s96-c"
        SocialAccount.objects.create(
            user=other_user,
            provider="google",
            uid="google-notjony",
            extra_data={"picture": google_avatar},
        )

        res = self.client.get(self.public_profile_url("notJony"))

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["avatar"], google_avatar)

    def test_followers_list_falls_back_to_google_avatar_for_email_signup(self):
        """Follower cards should use the same avatar fallback as profile views."""
        target_user = User.objects.create_user(
            username="targetuser",
            email="target@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=target_user, defaults={"email_verified": True})

        follower = User.objects.create_user(
            username="notJony",
            email="notjony@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=follower, defaults={"email_verified": True})

        google_avatar = "https://lh3.googleusercontent.com/a/notjony-follow=s96-c"
        SocialAccount.objects.create(
            user=follower,
            provider="google",
            uid="google-notjony-follow",
            extra_data={"picture": google_avatar},
        )

        from apps.users.models import UserFollow

        UserFollow.objects.create(follower=follower, following=target_user)

        res = self.client.get(f"/api/v1/follows/followers/{target_user.username}/")

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["results"][0]["user"]["avatar"], google_avatar)

    def test_profile_update_basic_info(self):
        """Test updating bio and ensure unsafe tags are removed."""
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
        self.assertNotIn("<script>", self.profile.bio)
        self.assertIn('alert("xss")', self.profile.bio)

    def test_profile_update_primary_color(self):
        """Test setting profile primary color."""
        res = self.client.patch(self.profile_url, {"profile_primary_color": "#EF4444"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.profile.refresh_from_db()
        self.assertEqual(self.profile.profile_primary_color, "#ef4444")
        self.assertEqual(res.data["profile_primary_color"], "#ef4444")

    def test_profile_update_primary_color_validation(self):
        """Invalid profile primary color should be rejected."""
        res = self.client.patch(self.profile_url, {"profile_primary_color": "red"})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("profile_primary_color", res.data)

    def test_profile_update_bio_preserves_allowed_html(self):
        """Test that safe formatting tags remain intact after save."""
        data = {
            "bio": '<p align="center"><img src="https://example.com/banner.jpg" width="280" alt="banner"></p>'
        }
        res = self.client.patch(self.profile_url, data)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertIn('<p align="center">', self.profile.bio)
        self.assertIn("<img", self.profile.bio)
        self.assertNotIn("&lt;img", self.profile.bio)

    def test_profile_update_bio_decodes_legacy_escaped_html(self):
        """Escaped legacy bios should be normalized back to valid HTML on save."""
        data = {"bio": '&lt;p align=&quot;center&quot;&gt;hello&lt;/p&gt;'}
        res = self.client.patch(self.profile_url, data)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertIn('<p align="center">hello</p>', self.profile.bio)
        self.assertNotIn("&lt;p", self.profile.bio)

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

        # 2. Another user viewing private profile should get 404
        other_user = User.objects.create_user(username="viewer", password="pw")
        self.client.force_authenticate(user=other_user)

        res = self.client.get(self.public_profile_url("mainuser"))
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # Verify lists endpoint (should return empty/blocked)
        # Using UserAnimeListViewSet logic: if user.profile.is_private -> returns empty
        list_url = reverse("lists-list") + "?username=mainuser"
        res = self.client.get(list_url)
        self.assertEqual(len(res.data["results"]), 0)
