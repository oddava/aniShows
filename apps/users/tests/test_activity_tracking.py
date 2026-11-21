"""Tests for the activity tracking system.

Tests cover:
- Signal-based activity creation on UserAnimeList changes
- Deduplication guard for rapid saves
- _skip_activity flag for bulk imports
- Heatmap API endpoint correctness
- Privacy filtering for heatmap and feed
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ...animes.models import Anime
from ..models import UserActivity, UserAnimeList

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
        _entry = UserAnimeList.objects.create(
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
        assert activity is not None
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
        assert activity is not None
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
        assert activity is not None
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
        assert activity is not None
        self.assertEqual(activity.old_episodes, 3)
        self.assertEqual(activity.new_episodes, 6)

    def _progress_rows(self):
        return list(
            UserActivity.objects.filter(
                user=self.user,
                anime=self.anime,
                activity_type=UserActivity.ActivityType.PROGRESS,
            ).order_by("created_at", "id")
        )

    def test_binge_progress_updates_coalesce_into_one_row(self):
        """+1 clicks within 30 minutes extend one PROGRESS row (spec 3 P1-7)."""
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=0,
        )
        UserActivity.objects.all().delete()

        for episodes in (1, 2, 3):
            entry.episodes_watched = episodes
            entry.save()

        rows = self._progress_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0].old_episodes, rows[0].new_episodes), (0, 3))

    def test_progress_after_the_window_starts_a_new_row(self):
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=0,
        )
        UserActivity.objects.all().delete()
        entry.episodes_watched = 1
        entry.save()
        UserActivity.objects.update(created_at=timezone.now() - timedelta(minutes=31))

        entry.episodes_watched = 2
        entry.save()

        rows = self._progress_rows()
        self.assertEqual([(r.old_episodes, r.new_episodes) for r in rows], [(0, 1), (1, 2)])

    def test_progress_that_nets_to_zero_removes_the_row(self):
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=4,
        )
        UserActivity.objects.all().delete()

        entry.episodes_watched = 5
        entry.save()
        entry.episodes_watched = 4
        entry.save()

        self.assertEqual(self._progress_rows(), [])

    def test_other_activity_breaks_the_coalescing(self):
        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=0,
        )
        UserActivity.objects.all().delete()
        entry.episodes_watched = 1
        entry.save()
        entry.status = UserAnimeList.UserAnimeStatus.on_hold
        entry.save()
        entry.episodes_watched = 2
        entry.save()

        self.assertEqual(len(self._progress_rows()), 2)

    def test_coalesced_progress_keeps_heatmap_totals(self):
        from django.core.cache import cache

        from ..services.cache import get_user_heatmap_cache_key

        entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=0,
        )
        UserActivity.objects.all().delete()
        for episodes in (1, 2, 3, 4):
            entry.episodes_watched = episodes
            entry.save()
        cache.delete(get_user_heatmap_cache_key(self.user.id))

        client = APIClient()
        response = client.get(reverse("activity-heatmap"), {"username": self.user.username})

        self.assertEqual(sum(day["count"] for day in response.data), 4)

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
        assert activity is not None
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
        assert activity is not None

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
        assert activity is not None
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
        entry._skip_activity = True  # type: ignore[attr-defined]
        entry.save()

        count = UserActivity.objects.filter(user=self.user, anime=self.anime).count()
        self.assertEqual(count, 0)

    def test_no_activity_without_user(self):
        """Signal handlers should gracefully handle missing user."""
        # This test just ensures no crash if instance has issues
        _entry = UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.watching,
        )
        # Should have created activity without error
        self.assertTrue(UserActivity.objects.filter(user=self.user, anime=self.anime).exists())


class ListActivityMergeTests(TransactionTestCase):
    """Writes within 10 minutes describe the net change; an Undo leaves no row."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="mergeuser", email="merge@example.com", password="password123"
        )
        self.anime = Anime.objects.create(
            title="Merge Anime", slug="merge-anime", episode_count=12, status="Finished"
        )

    def rows(self):
        return list(
            UserActivity.objects.filter(user=self.user, anime=self.anime).order_by(
                "created_at", "id"
            )
        )

    def kinds(self):
        return [row.activity_type for row in self.rows()]

    def heatmap_total(self):
        from django.core.cache import cache

        from ..services.cache import get_user_heatmap_cache_key

        cache.delete(get_user_heatmap_cache_key(self.user.id))
        response = APIClient().get(reverse("activity-heatmap"), {"username": self.user.username})
        return sum(day["count"] for day in response.data)

    def age_rows(self, minutes):
        UserActivity.objects.update(created_at=timezone.now() - timedelta(minutes=minutes))

    def add(self, status=UserAnimeList.UserAnimeStatus.watching, episodes=0):
        return UserAnimeList.objects.create(
            user=self.user, anime=self.anime, status=status, episodes_watched=episodes
        )

    def change(self, entry, **fields):
        for name, value in fields.items():
            setattr(entry, name, value)
        entry.save()
        return entry

    def test_add_then_undo_leaves_nothing(self):
        entry = self.add()
        entry.delete()

        self.assertEqual(self.rows(), [])

    def test_add_completed_then_undo_leaves_nothing_on_the_heatmap(self):
        entry = self.add(UserAnimeList.UserAnimeStatus.completed, 12)
        entry.delete()

        self.assertEqual(self.rows(), [])
        self.assertEqual(self.heatmap_total(), 0)

    def test_remove_then_undo_leaves_nothing(self):
        entry = self.add(episodes=4)
        self.age_rows(30)
        entry.delete()
        self.add(episodes=4)

        self.assertEqual(self.kinds(), [UserActivity.ActivityType.ADDED])

    def test_rapid_status_changes_collapse_to_one_row(self):
        status = UserAnimeList.UserAnimeStatus
        entry = self.add(status.plan_to_watch)
        self.change(entry, status=status.on_hold)
        self.change(entry, status=status.completed, episodes_watched=12)

        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].activity_type, UserActivity.ActivityType.COMPLETED)
        self.assertEqual((rows[0].old_status, rows[0].new_status), (None, "Completed"))
        self.assertEqual(self.heatmap_total(), 12)

    def test_status_change_then_undo_leaves_nothing(self):
        status = UserAnimeList.UserAnimeStatus
        entry = self.add(status.completed, 12)
        self.age_rows(30)
        self.change(entry, status=status.watching)
        self.change(entry, status=status.completed)

        self.assertEqual(self.kinds(), [UserActivity.ActivityType.COMPLETED])
        self.assertEqual(self.heatmap_total(), 12)

    def test_completion_then_undo_takes_its_episodes_back(self):
        status = UserAnimeList.UserAnimeStatus
        entry = self.add(episodes=5)
        self.age_rows(30)
        self.change(entry, status=status.completed, episodes_watched=12)
        self.assertEqual(self.heatmap_total(), 7)

        self.change(entry, status=status.watching, episodes_watched=5)

        self.assertEqual(self.kinds(), [UserActivity.ActivityType.ADDED])
        self.assertEqual(self.heatmap_total(), 0)

    def test_progress_then_completion_merges_and_keeps_the_episodes(self):
        entry = self.add(episodes=3)
        self.age_rows(30)
        self.change(entry, episodes_watched=4)
        self.change(entry, status=UserAnimeList.UserAnimeStatus.completed, episodes_watched=12)

        rows = self.rows()
        self.assertEqual(self.kinds()[-1], UserActivity.ActivityType.COMPLETED)
        self.assertEqual(len(rows), 2)  # the old ADDED row and one "Completed"
        self.assertEqual((rows[-1].old_episodes, rows[-1].new_episodes), (3, 12))
        self.assertEqual(self.heatmap_total(), 9)

    def test_change_that_would_hide_progress_keeps_both_rows(self):
        # Watching 0 -> 1 then On Hold: one STATUS_CHANGE row would drop the episode
        # from the heatmap, so both rows stay.
        entry = self.add()
        self.age_rows(30)
        self.change(entry, episodes_watched=1)
        self.change(entry, status=UserAnimeList.UserAnimeStatus.on_hold)

        self.assertEqual(
            self.kinds(),
            [
                UserActivity.ActivityType.ADDED,
                UserActivity.ActivityType.PROGRESS,
                UserActivity.ActivityType.STATUS_CHANGE,
            ],
        )
        self.assertEqual(self.heatmap_total(), 1)

    def test_change_after_the_window_logs_a_new_row(self):
        status = UserAnimeList.UserAnimeStatus
        entry = self.add()
        self.age_rows(11)
        self.change(entry, status=status.on_hold)
        self.age_rows(11)
        self.change(entry, status=status.watching)

        self.assertEqual(
            self.kinds(),
            [
                UserActivity.ActivityType.ADDED,
                UserActivity.ActivityType.STATUS_CHANGE,
                UserActivity.ActivityType.STATUS_CHANGE,
            ],
        )

    def test_rewatch_start_then_undo_leaves_nothing(self):
        status = UserAnimeList.UserAnimeStatus
        entry = self.add(status.completed, 12)
        self.age_rows(30)
        self.change(entry, is_rewatching=True, status=status.watching, episodes_watched=0)
        self.change(entry, is_rewatching=False, status=status.completed, episodes_watched=12)

        self.assertEqual(self.kinds(), [UserActivity.ActivityType.COMPLETED])
        self.assertEqual(self.heatmap_total(), 12)

    def test_finishing_a_rewatch_is_kept(self):
        status = UserAnimeList.UserAnimeStatus
        entry = self.add(status.completed, 12)
        self.age_rows(30)
        self.change(entry, is_rewatching=True, status=status.watching, episodes_watched=0)
        self.change(
            entry,
            is_rewatching=False,
            total_rewatches=1,
            status=status.completed,
            episodes_watched=12,
        )

        self.assertEqual(
            self.kinds(),
            [
                UserActivity.ActivityType.COMPLETED,
                UserActivity.ActivityType.REWATCHING,
                UserActivity.ActivityType.COMPLETED,
            ],
        )

    def test_status_rows_keep_episode_counts(self):
        entry = self.add(episodes=3)
        self.age_rows(30)
        self.change(entry, status=UserAnimeList.UserAnimeStatus.dropped)

        row = self.rows()[-1]
        self.assertEqual(row.activity_type, UserActivity.ActivityType.STATUS_CHANGE)
        self.assertEqual((row.old_episodes, row.new_episodes), (3, 3))


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

        from ..services.cache import get_user_heatmap_cache_key

        cache.delete(get_user_heatmap_cache_key(self.user.id))

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

    def _status_filter_rows(self):
        at = UserActivity.ActivityType
        UserActivity.objects.bulk_create(
            [
                UserActivity(
                    user=self.user, anime=self.anime, activity_type=at.ADDED, new_status="Watching"
                ),
                UserActivity(
                    user=self.user,
                    anime=self.anime,
                    activity_type=at.COMPLETED,
                    old_status="Watching",
                    new_status="Completed",
                ),
                UserActivity(
                    user=self.user,
                    anime=self.anime,
                    activity_type=at.REMOVED,
                    old_status="Completed",
                ),
                UserActivity(
                    user=self.user,
                    anime=self.anime,
                    activity_type=at.STATUS_CHANGE,
                    old_status="Completed",
                    new_status="On Hold",
                ),
            ]
        )

    def _feed(self, **params):
        response = self.client.get(
            reverse("activity-list"), {"username": self.user.username, **params}
        )
        return response

    def test_feed_status_filter_returns_rows_for_that_status(self):
        self._status_filter_rows()

        completed = self._feed(status="Completed")
        watching = self._feed(status="Watching")
        planning = self._feed(status="Plan to Watch")

        self.assertEqual(completed.status_code, status.HTTP_200_OK)
        self.assertEqual(
            sorted(row["activity_type"] for row in completed.data["results"]),
            ["completed", "removed"],
        )
        self.assertEqual([row["activity_type"] for row in watching.data["results"]], ["added"])
        self.assertEqual(planning.data["results"], [])

    def test_feed_status_and_type_combine(self):
        self._status_filter_rows()

        response = self._feed(status="Completed", type="removed")

        self.assertEqual([row["activity_type"] for row in response.data["results"]], ["removed"])

    def test_feed_rejects_unknown_status_and_type(self):
        self.assertEqual(self._feed(status="watching").status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._feed(type="binge").status_code, status.HTTP_400_BAD_REQUEST)
