"""List writes leave the Anime row and the public caches alone (spec 3 P0-2, D-3)."""

from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.models.signals import post_save
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from ...users.models import UserAnimeList
from ...users.tasks import update_user_stats
from ..models import Anime
from ..services.public_anime_service import AnimePublicPayloadService
from ..services.user_list_side_effects import (
    SITE_STATUS_KEYS,
    schedule_recommendations_debounced,
    site_score_counts,
    site_status_counts,
)
from ..tasks.recommendations import generate_recommendations

User = get_user_model()


class ListSideEffectTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="fx", email="fx@example.com", password="x")
        self.anime = Anime.objects.create(
            title="Effects",
            slug="effects",
            episode_count=12,
            status_distribution={"CURRENT": 10, "COMPLETED": 5},
        )
        for task in (update_user_stats, generate_recommendations):
            stub = patch.object(task, "apply_async")
            stub.start()
            self.addCleanup(stub.stop)


class NoAnimeWriteTests(ListSideEffectTestCase):
    def _anime_saves(self):
        saves = []

        def record(sender, instance, **kwargs):
            saves.append(instance.pk)

        post_save.connect(record, sender=Anime, weak=False)
        self.addCleanup(post_save.disconnect, record, sender=Anime)
        return saves

    def test_create_update_delete_never_save_the_anime_or_bump_the_namespace(self):
        saves = self._anime_saves()
        namespace = AnimePublicPayloadService.collection_cache_namespace()

        with CaptureQueriesContext(connection) as ctx, self.captureOnCommitCallbacks(execute=True):
            entry = UserAnimeList.objects.create(
                user=self.user, anime=self.anime, status="Watching"
            )
        with CaptureQueriesContext(connection) as ctx2, self.captureOnCommitCallbacks(execute=True):
            entry.episodes_watched = 3
            entry.save()
        with CaptureQueriesContext(connection) as ctx3, self.captureOnCommitCallbacks(execute=True):
            entry.delete()

        sql = "\n".join(q["sql"] for c in (ctx, ctx2, ctx3) for q in c.captured_queries)
        self.assertNotIn('UPDATE "anime_anime"', sql)
        self.assertEqual(saves, [])
        self.assertEqual(AnimePublicPayloadService.collection_cache_namespace(), namespace)

    def test_provider_distribution_is_left_untouched(self):
        with self.captureOnCommitCallbacks(execute=True):
            UserAnimeList.objects.create(user=self.user, anime=self.anime, status="Completed")

        self.anime.refresh_from_db()
        self.assertEqual(self.anime.status_distribution, {"CURRENT": 10, "COMPLETED": 5})


class SiteListCountsTestCase(ListSideEffectTestCase):
    def _add(self, username, status):
        user = User.objects.create_user(
            username=username, email=f"{username}@example.com", password="x"
        )
        with self.captureOnCommitCallbacks(execute=True):
            return UserAnimeList.objects.create(user=user, anime=self.anime, status=status)


class SiteStatusCountsTests(SiteListCountsTestCase):
    def test_shape_and_counts(self):
        self._add("a1", "Watching")
        self._add("a2", "Watching")
        self._add("a3", "Plan to Watch")
        self._add("a4", "On Hold")

        counts = site_status_counts(self.anime.id)

        self.assertEqual(set(counts), set(SITE_STATUS_KEYS))
        self.assertEqual(
            counts,
            {"watching": 2, "completed": 0, "on_hold": 1, "dropped": 0, "plan_to_watch": 1},
        )

    def test_empty_and_missing_anime(self):
        self.assertEqual(site_status_counts(None), dict.fromkeys(SITE_STATUS_KEYS, 0))
        self.assertEqual(site_status_counts(self.anime.id), dict.fromkeys(SITE_STATUS_KEYS, 0))

    def test_cached_until_a_list_change(self):
        entry = self._add("c1", "Watching")
        self.assertEqual(site_status_counts(self.anime.id)["watching"], 1)

        with self.assertNumQueries(0):
            site_status_counts(self.anime.id)

        with self.captureOnCommitCallbacks(execute=True):
            entry.status = "Completed"
            entry.save()
        self.assertEqual(site_status_counts(self.anime.id)["completed"], 1)

        self._add("c2", "Dropped")
        self.assertEqual(site_status_counts(self.anime.id)["dropped"], 1)

        with self.captureOnCommitCallbacks(execute=True):
            entry.delete()
        self.assertEqual(site_status_counts(self.anime.id)["completed"], 0)


class SiteScoreCountsTests(SiteListCountsTestCase):
    def _scored(self, username, score):
        entry = self._add(username, "Completed")
        with self.captureOnCommitCallbacks(execute=True):
            entry.score = score
            entry.save()
        return entry

    def test_counts_scores_one_to_ten_and_skips_unscored(self):
        self._scored("s1", 9)
        self._scored("s2", 9)
        self._scored("s3", 4)
        self._add("s4", "Watching")  # unscored (0)

        counts = site_score_counts(self.anime.id)

        self.assertEqual(list(counts), [str(n) for n in range(1, 11)])
        self.assertEqual(counts["9"], 2)
        self.assertEqual(counts["4"], 1)
        self.assertEqual(sum(counts.values()), 3)

    def test_one_query_fills_status_and_score_caches(self):
        self._scored("q1", 7)
        with self.assertNumQueries(1):
            site_status_counts(self.anime.id)
            site_score_counts(self.anime.id)

    def test_score_cache_drops_on_a_list_change(self):
        entry = self._scored("d1", 6)
        self.assertEqual(site_score_counts(self.anime.id)["6"], 1)
        with self.captureOnCommitCallbacks(execute=True):
            entry.score = 8
            entry.save()
        counts = site_score_counts(self.anime.id)
        self.assertEqual((counts["6"], counts["8"]), (0, 1))

    def test_empty_and_missing_anime_scores(self):
        self.assertEqual(sum(site_score_counts(None).values()), 0)
        self.assertEqual(sum(site_score_counts(self.anime.id).values()), 0)


class RecommendationDebounceTests(TestCase):
    def test_second_change_in_the_window_does_not_schedule_again(self):
        task = MagicMock()

        schedule_recommendations_debounced(7, task=task, countdown=300)
        schedule_recommendations_debounced(7, task=task, countdown=300)
        schedule_recommendations_debounced(8, task=task, countdown=300)

        self.assertEqual(task.apply_async.call_count, 2)
