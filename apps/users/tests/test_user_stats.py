"""One stats implementation (spec 3 P1-5): every path computes the same numbers."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from ...animes.models import Anime, UserFavorite
from ..models import UserAnimeList, UserFollow, UserStats
from ..services.celery_tasks import UserTaskService
from ..services.stats_service import (
    STATS_FIELDS,
    calculate_user_stats,
    compute_user_stats,
    create_or_update_user_stats,
)

User = get_user_model()


class UserStatsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="stats", email="s@example.com", password="x")
        self.fan = User.objects.create_user(username="fan", email="f@example.com", password="x")
        self.idol = User.objects.create_user(username="idol", email="i@example.com", password="x")
        UserFollow.objects.create(follower=self.fan, following=self.user)
        UserFollow.objects.create(follower=self.user, following=self.idol)
        UserFollow.objects.create(follower=self.idol, following=self.user)

        timed = Anime.objects.create(
            title="Timed", slug="timed", episode_count=12, duration_minutes=30
        )
        untimed = Anime.objects.create(
            title="Untimed", slug="untimed", episode_count=12, duration_minutes=0
        )
        UserAnimeList.objects.create(
            user=self.user, anime=timed, status="Watching", episodes_watched=2, score=8
        )
        UserAnimeList.objects.create(
            user=self.user, anime=untimed, status="Watching", episodes_watched=5, score=5
        )
        UserFavorite.objects.create(user=self.user, anime=timed)

    def test_duration_zero_counts_as_24_minutes_and_follows_are_included(self):
        data = calculate_user_stats(self.user)

        self.assertEqual(data["total_minutes"], 2 * 30 + 5 * 24)
        self.assertEqual(data["days_watched"], round(180 / 1440, 1))
        self.assertEqual(data["episodes_watched"], 7)
        self.assertEqual(data["anime_count"], 2)
        self.assertEqual(data["mean_score"], 6.5)
        self.assertEqual(data["favorites_count"], 1)
        self.assertEqual((data["followers_count"], data["following_count"]), (2, 1))

    def test_task_and_inline_paths_agree(self):
        inline = calculate_user_stats(self.user)

        UserTaskService.update_user_stats(user_id=self.user.id)
        stored = UserStats.objects.get(user=self.user)

        self.assertEqual({field: getattr(stored, field) for field in STATS_FIELDS}, inline)

    def test_create_or_update_matches_the_batch_computation(self):
        stats = create_or_update_user_stats(self.user)
        batch = compute_user_stats([self.user.id, self.fan.id])

        self.assertEqual(
            {field: getattr(stats, field) for field in STATS_FIELDS}, batch[self.user.id]
        )
        self.assertEqual(batch[self.fan.id]["anime_count"], 0)
        self.assertEqual(batch[self.fan.id]["mean_score"], None)

    def test_refresh_updates_an_existing_row(self):
        create_or_update_user_stats(self.user)
        UserAnimeList.objects.filter(user=self.user).update(episodes_watched=1)

        UserTaskService.update_user_stats(user_id=self.user.id)

        self.assertEqual(UserStats.objects.get(user=self.user).episodes_watched, 2)
