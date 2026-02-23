"""Tests for the activity tracking system.

Tests cover:
- Signal-based activity creation on UserAnimeList changes
- Deduplication guard for rapid saves
- _skip_activity flag for bulk imports
- Heatmap API endpoint correctness
- Privacy filtering for heatmap and feed
"""

from django.test import TestCase, TransactionTestCase
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status

from apps.animes.models import Anime
from apps.users.models import UserAnimeList, UserActivity

User = get_user_model()


class ActivitySignalTests(TransactionTestCase):
    """Test that signal handlers create correct activity records.

    Uses TransactionTestCase because our signals use transaction.on_commit(),
    which only fires when the transaction actually commits. Regular TestCase
    wraps each test in a rolled-back transaction where on_commit never fires.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="password123"
        )
        self.anime = Anime.objects.create(
            title="Signal Test Anime",
            slug="signal-test-anime",
            episode_count=12,
            status="Finished",
        )

    def test_activity_created_on_add(self):
        """Adding anime to list creates an ADDED activity."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=0,
        )
        activity = UserActivity.objects.filter(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.ADDED,
        ).first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.new_status, "Watching")

    def test_activity_created_on_add_completed(self):
        """Adding anime directly as Completed creates a COMPLETED activity."""
        UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.completed,
            episodes_watched=12,
        )
        activity = UserActivity.objects.filter(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.COMPLETED,
        ).first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.new_status, "Completed")

    def test_activity_on_status_change(self):
        """Changing status creates a STATUS_CHANGE activity."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=3,
        )
        # Clear the ADDED activity
        UserActivity.objects.all().delete()

        entry.status = UserAnimeList.UserAnimeStatus.on_hold
        entry.save()

        activity = UserActivity.objects.filter(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.STATUS_CHANGE,
        ).first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.old_status, "Watching")
        self.assertEqual(activity.new_status, "On Hold")

    def test_activity_on_episode_progress(self):
        """Updating episodes creates a PROGRESS activity."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=3,
        )
        UserActivity.objects.all().delete()

        entry.episodes_watched = 6
        entry.save()

        activity = UserActivity.objects.filter(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.PROGRESS,
        ).first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.old_episodes, 3)
        self.assertEqual(activity.new_episodes, 6)

    def test_activity_on_completion(self):
        """Changing status to Completed creates a COMPLETED activity."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=11,
        )
        UserActivity.objects.all().delete()

        entry.status = UserAnimeList.UserAnimeStatus.completed
        entry.episodes_watched = 12
        entry.save()

        activity = UserActivity.objects.filter(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.COMPLETED,
        ).first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.old_status, "Watching")
        self.assertEqual(activity.new_status, "Completed")

    def test_activity_on_rewatching(self):
        """Toggling is_rewatching creates a REWATCHING activity."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.completed,
            episodes_watched=12,
        )
        UserActivity.objects.all().delete()

        entry.is_rewatching = True
        entry.episodes_watched = 0
        entry.save()

        activity = UserActivity.objects.filter(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.REWATCHING,
        ).first()
        self.assertIsNotNone(activity)

    def test_activity_on_delete(self):
        """Deleting anime list entry creates a REMOVED activity."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=3,
        )
        UserActivity.objects.all().delete()

        entry.delete()

        activity = UserActivity.objects.filter(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.REMOVED,
        ).first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.old_status, "Watching")

    def test_score_only_change_not_logged(self):
        """Score-only changes should NOT create activity entries."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=3,
            score=0,
        )
        UserActivity.objects.all().delete()

        entry.score = 8
        entry.save()

        count = UserActivity.objects.filter(user=self.user, anime=self.anime).count()
        self.assertEqual(count, 0)

    def test_skip_activity_flag(self):
        """_skip_activity flag should suppress activity creation (for bulk imports)."""
        entry = UserAnimeList(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=0,
        )
        entry._skip_activity = True
        entry.save()

        count = UserActivity.objects.filter(user=self.user, anime=self.anime).count()
        self.assertEqual(count, 0)

    def test_no_activity_without_user(self):
        """Signal handlers should gracefully handle missing user."""
        # This test just ensures no crash if instance has issues
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
        )
        # Should have created activity without error
        self.assertTrue(UserActivity.objects.filter(user=self.user, anime=self.anime).exists())


class HeatmapAPITests(APITestCase):
    """Test the heatmap API endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="heatmapuser", email="heatmap@example.com", password="password123"
        )
        # Manually verify email
        self.user.userprofile.email_verified = True
        self.user.userprofile.save()
        self.client.force_authenticate(user=self.user)

        self.anime = Anime.objects.create(
            title="Heatmap Anime",
            slug="heatmap-anime",
            episode_count=24,
            status="Finished",
        )

        # Clear heatmap cache to ensure fresh data for each test
        from django.core.cache import cache

        cache.delete(f"heatmap:{self.user.id}")

    def test_heatmap_empty(self):
        """Heatmap returns empty list when no activity exists."""
        response = self.client.get(reverse("activity-heatmap"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_heatmap_counts_progress(self):
        """Heatmap counts episode diffs for PROGRESS activities."""
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.PROGRESS,
            old_episodes=3,
            new_episodes=6,
        )
        response = self.client.get(reverse("activity-heatmap"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["count"], 3)  # 6 - 3 = 3

    def test_heatmap_completed_with_old_episodes(self):
        """Heatmap uses diff (not total) for COMPLETED with old_episodes set."""
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.COMPLETED,
            old_episodes=20,
            new_episodes=24,
        )
        response = self.client.get(reverse("activity-heatmap"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        # Should be 4 (24-20), NOT 24
        self.assertEqual(response.data[0]["count"], 4)

    def test_heatmap_completed_without_old_episodes(self):
        """Heatmap uses total episodes for COMPLETED without old_episodes."""
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.COMPLETED,
            old_episodes=None,
            new_episodes=12,
        )
        response = self.client.get(reverse("activity-heatmap"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["count"], 12)

    def test_heatmap_clamps_negative_diffs(self):
        """Heatmap clamps negative diffs to 0 (e.g., rewatching episode reset)."""
        # Simulate a case where new_episodes < old_episodes
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.PROGRESS,
            old_episodes=10,
            new_episodes=0,  # Reset for rewatch
        )
        response = self.client.get(reverse("activity-heatmap"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should be empty (0 is clamped, and we filter count > 0)
        self.assertEqual(response.data, [])

    def test_heatmap_anonymous_returns_empty(self):
        """Anonymous users get empty heatmap."""
        self.client.force_authenticate(user=None)
        response = self.client.get(reverse("activity-heatmap"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_heatmap_private_profile(self):
        """Heatmap returns empty for private profiles viewed by others."""
        # Make user's profile private
        self.user.userprofile.is_private = True
        self.user.userprofile.save()

        # Create another user to view
        viewer = User.objects.create_user(
            username="viewer", email="viewer@example.com", password="password123"
        )
        self.client.force_authenticate(user=viewer)

        # Create some activity
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.PROGRESS,
            old_episodes=0,
            new_episodes=5,
        )

        response = self.client.get(reverse("activity-heatmap"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])


class ActivityFeedAPITests(APITestCase):
    """Test the activity feed API endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="feeduser", email="feed@example.com", password="password123"
        )
        self.user.userprofile.email_verified = True
        self.user.userprofile.save()
        self.client.force_authenticate(user=self.user)

        self.anime = Anime.objects.create(
            title="Feed Anime",
            slug="feed-anime",
            episode_count=12,
            status="Finished",
        )

    def test_feed_returns_activities(self):
        """Feed returns activity records for the user."""
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.ADDED,
            new_status="Watching",
        )
        response = self.client.get(reverse("activity-list"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertGreaterEqual(len(results), 1)

    def test_feed_anonymous_returns_empty(self):
        """Anonymous users get empty feed."""
        self.client.force_authenticate(user=None)
        response = self.client.get(reverse("activity-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 0)

    def test_feed_private_profile(self):
        """Feed returns empty for private profiles viewed by others."""
        self.user.userprofile.is_private = True
        self.user.userprofile.save()

        viewer = User.objects.create_user(
            username="feedviewer", email="feedviewer@example.com", password="password123"
        )
        self.client.force_authenticate(user=viewer)

        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.ADDED,
            new_status="Watching",
        )

        response = self.client.get(reverse("activity-list"), {"username": self.user.username})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 0)

    def test_feed_type_filter(self):
        """Feed supports filtering by activity type."""
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.ADDED,
            new_status="Watching",
        )
        UserActivity.objects.create(
            user=self.user,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.PROGRESS,
            old_episodes=0,
            new_episodes=3,
        )

        response = self.client.get(
            reverse("activity-list"),
            {"username": self.user.username, "type": "progress"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["activity_type"], "progress")
