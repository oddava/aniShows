import ipaddress
from datetime import timedelta
from unittest.mock import patch

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from ...animes.models import Anime, Review, ReviewVote
from ..middleware.activity_middleware import activity_throttle_key
from ..models import UserAnimeList, UserFollow, UserProfile, UserStats

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
        from ..tasks import update_user_stats

        update_user_stats(self.user.id)

        res = self.client.get(self.profile_url)
        stats = res.data

        self.assertEqual(stats["anime_count"], 2)
        self.assertEqual(stats["mean_score"], 8.0)
        self.assertEqual(stats["days_watched"], 0.4)
        self.assertEqual(stats["resonance_count"], 0)

    @patch("apps.animes.signals.enrich_metadata")
    @patch("apps.animes.signals.generate_recommendations")
    def test_profile_includes_resonance_count(self, mock_recommendations, mock_enrich):
        anime = Anime.objects.create(
            title="Review Anime", slug="review-anime", episode_count=12, duration_minutes=24
        )
        review = Review.objects.create(
            user=self.user,
            anime=anime,
            rating=8,
            text="Solid review",
        )
        other_user = User.objects.create_user(
            username="resonance-fan",
            email="resonance@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=other_user, defaults={"email_verified": True})
        ReviewVote.objects.create(
            user=other_user,
            review=review,
            vote_type=ReviewVote.VoteType.HELPFUL,
        )

        from ..tasks import update_user_stats

        update_user_stats(self.user.id)

        own_profile_response = self.client.get(self.profile_url)
        public_profile_response = self.client.get(self.public_profile_url(self.user.username))

        self.assertEqual(own_profile_response.status_code, status.HTTP_200_OK)
        self.assertEqual(public_profile_response.status_code, status.HTTP_200_OK)
        self.assertEqual(own_profile_response.data["resonance_count"], 1)
        self.assertEqual(public_profile_response.data["resonance_count"], 1)

    def test_current_profile_query_count_uses_prefetches(self):
        """Current-profile fetch should stay on a fixed small query budget."""
        UserStats.objects.update_or_create(
            user=self.user,
            defaults={
                "followers_count": 2,
                "following_count": 1,
                "anime_count": 3,
                "episodes_watched": 24,
                "total_minutes": 576,
                "days_watched": 0.4,
                "mean_score": 8.0,
                "favorites_count": 1,
                "reviews_count": 2,
                "resonance_count": 0,
            },
        )
        cache.clear()
        cache.add(activity_throttle_key(self.user.id), True)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.profile_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertLessEqual(len(queries), 4, "\n".join(q["sql"][:160] for q in queries.captured_queries))

    @patch(
        "apps.core.services.url_validator.URLValidator._resolve_public_ips",
        return_value=[ipaddress.ip_address("93.184.216.34")],
    )
    def test_profile_update_social_links(self, _resolve):
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
        twitter_link = next(link for link in links if link["platform"] == "Twitter")
        self.assertEqual(twitter_link["value"], "https://x.com/testuser")

        # GitHub should be normalized
        github_link = next(link for link in links if link["platform"] == "GitHub")
        self.assertEqual(github_link["value"], "https://github.com/testuser")

        # YouTube should be normalized
        youtube_link = next(link for link in links if link["platform"] == "YouTube")
        self.assertEqual(youtube_link["value"], "https://youtube.com/@testuser")

        # 2. Clear links
        data = {"social_links": []}
        res = self.client.patch(self.profile_url, data, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertEqual(len(self.profile.social_links), 0)

    def test_social_link_updates_use_stricter_throttle(self):
        """New accounts should hit the social-link edit limit before normal profile limits."""
        response = None
        for index in range(6):
            response = self.client.patch(
                self.profile_url,
                {
                    "social_links": [
                        {"platform": "GitHub", "value": f"testuser{index}"}
                    ]
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

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

    def test_public_profile_query_count_uses_prefetches(self):
        """Public profile fetch should avoid extra badge/follow queries."""
        other_user = User.objects.create_user(
            username="publicperf",
            email="publicperf@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=other_user, defaults={"email_verified": True})
        UserStats.objects.update_or_create(
            user=other_user,
            defaults={
                "followers_count": 5,
                "following_count": 4,
                "anime_count": 10,
                "episodes_watched": 48,
                "total_minutes": 1152,
                "days_watched": 0.8,
                "mean_score": 8.5,
                "favorites_count": 3,
                "reviews_count": 2,
                "resonance_count": 0,
            },
        )
        UserFollow.objects.create(follower=self.user, following=other_user)
        cache.clear()
        cache.add(activity_throttle_key(self.user.id), True)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.public_profile_url(other_user.username))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_following"])
        self.assertLessEqual(len(queries), 4)

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

        from ..models import UserFollow

        UserFollow.objects.create(follower=follower, following=target_user)

        res = self.client.get(f"/api/v1/follows/followers/{target_user.username}/")

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["results"][0]["user"]["avatar"], google_avatar)

    def test_followers_list_query_count_stays_bounded(self):
        """Followers list should not trigger an extra profile lookup per request."""
        target_user = User.objects.create_user(
            username="perf_target",
            email="perf_target@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=target_user, defaults={"email_verified": True})

        follower = User.objects.create_user(
            username="perf_follower",
            email="perf_follower@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=follower, defaults={"email_verified": True})
        UserFollow.objects.create(follower=follower, following=target_user)
        cache.clear()
        cache.add(activity_throttle_key(self.user.id), True)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(f"/api/v1/follows/followers/{target_user.username}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertLessEqual(len(queries), 5)

    def test_friends_watching_query_count_skips_anime_lookup(self):
        """Friends-watching should fetch from the list queryset directly."""
        friend = User.objects.create_user(
            username="friendwatcher",
            email="friendwatcher@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=friend, defaults={"email_verified": True})
        anime = Anime.objects.create(
            title="Friend Watching Anime",
            slug="friend-watching-anime",
            synopsis="Anime for friends watching performance test",
            anime_type="TV",
            status="Airing",
        )
        UserFollow.objects.create(follower=self.user, following=friend)
        UserFollow.objects.create(follower=friend, following=self.user)
        UserAnimeList.objects.create(
            user=friend,
            anime=anime,
            status="Watching",
            episodes_watched=3,
        )
        cache.clear()
        cache.add(activity_throttle_key(self.user.id), True)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse("follows-friends-watching"), {"anime_id": anime.id})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertLessEqual(len(queries), 3)

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
        self.assertIn("profile_primary_color", res.data["errors"])

    def test_profile_update_show_adult_content(self):
        res = self.client.patch(self.profile_url, {"show_adult_content": True}, format="json")

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.show_adult_content)
        self.assertTrue(res.data["show_adult_content"])

    def test_profile_update_preferred_timezone(self):
        res = self.client.patch(
            self.profile_url,
            {"preferred_timezone": "America/New_York"},
            format="json",
        )

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.preferred_timezone, "America/New_York")
        self.assertEqual(res.data["preferred_timezone"], "America/New_York")

    def test_profile_update_preferred_timezone_auto(self):
        self.profile.preferred_timezone = "Asia/Tokyo"
        self.profile.save(update_fields=["preferred_timezone"])

        res = self.client.patch(self.profile_url, {"preferred_timezone": "auto"}, format="json")

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.preferred_timezone, "")
        self.assertEqual(res.data["preferred_timezone"], "auto")

    def test_profile_update_preferred_timezone_validation(self):
        res = self.client.patch(
            self.profile_url,
            {"preferred_timezone": "Mars/Olympus"},
            format="json",
        )

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("preferred_timezone", res.data["errors"])

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
        self.assertIn("days", str(res.data["errors"]["username"]))

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
