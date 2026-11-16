"""Query budgets for the list, activity and summary endpoints (spec 3 test plan, L37).

Celery runs eagerly in tests, so the stats refresh and recommendation tasks a list
write queues are stubbed out: the budget is what the web request itself costs.
"""

from contextlib import ExitStack
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from ...animes.models import Anime, Genre
from ...animes.tasks.recommendations import generate_recommendations
from ..models import UserActivity, UserAnimeList, UserProfile
from ..tasks import update_user_stats

User = get_user_model()

LIST_BUDGET = 8
ACTIVITY_BUDGET = 7
SUMMARY_COLD_BUDGET = 5
SUMMARY_WARM_BUDGET = 2
PATCH_BUDGET = 12
# The activity row written after commit (dedupe check + coalesce lock + insert).
PATCH_ON_COMMIT_BUDGET = 7


def _sql(ctx) -> str:
    return "\n".join(query["sql"] for query in ctx.captured_queries)


class ListBudgetTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="budget", email="b@example.com", password="x")
        UserProfile.objects.filter(user=self.user).update(email_verified=True)
        self.client.force_authenticate(user=self.user)
        self.genres = [Genre.objects.create(name=f"G{i}", slug=f"g{i}") for i in range(3)]
        self._stubs = ExitStack()
        self._stubs.enter_context(patch.object(update_user_stats, "apply_async"))
        self._stubs.enter_context(patch.object(generate_recommendations, "apply_async"))
        self.addCleanup(self._stubs.close)

    def _entries(self, count, start=0):
        rows = []
        for i in range(start, start + count):
            anime = Anime.objects.create(title=f"Budget {i}", slug=f"budget-{i}", episode_count=12)
            anime.genres.set(self.genres)
            rows.append(
                UserAnimeList(user=self.user, anime=anime, status="Watching", episodes_watched=1)
            )
        UserAnimeList.objects.bulk_create(rows)

    def _list_queries(self):
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get("/api/v1/lists/", {"username": "budget", "page_size": "50"})
        self.assertEqual(response.status_code, 200)
        return len(ctx), ctx

    def test_list_page_budget_does_not_grow_with_rows(self):
        self._entries(10)
        self._list_queries()  # warm-up: per-user middleware writes happen once
        small, ctx = self._list_queries()
        self._entries(40, start=10)
        large, _ = self._list_queries()

        self.assertLessEqual(small, LIST_BUDGET, _sql(ctx))
        self.assertEqual(small, large)

    def test_activity_feed_budget(self):
        self._entries(5)
        anime_ids = Anime.objects.values_list("id", flat=True)
        UserActivity.objects.bulk_create(
            UserActivity(
                user=self.user, anime_id=anime_id, activity_type="added", new_status="Watching"
            )
            for anime_id in anime_ids
        )

        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get("/api/v1/activity/", {"username": "budget"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 5)
        self.assertLessEqual(len(ctx), ACTIVITY_BUDGET, _sql(ctx))

    def test_summary_budget_cold_and_warm(self):
        self._entries(20)

        with CaptureQueriesContext(connection) as cold:
            self.client.get("/api/v1/lists/summary/", {"username": "budget"})
        with CaptureQueriesContext(connection) as warm:
            self.client.get("/api/v1/lists/summary/", {"username": "budget"})

        self.assertLessEqual(len(cold), SUMMARY_COLD_BUDGET, _sql(cold))
        self.assertLessEqual(len(warm), SUMMARY_WARM_BUDGET, _sql(warm))

    def test_patch_budget_and_no_anime_row_write(self):
        self._entries(1)
        entry = UserAnimeList.objects.get(user=self.user)

        with (
            self.captureOnCommitCallbacks() as callbacks,
            CaptureQueriesContext(connection) as request_ctx,
        ):
            response = self.client.patch(
                f"/api/v1/lists/{entry.id}/", {"episodes_watched": 2}, format="json"
            )
        with CaptureQueriesContext(connection) as commit_ctx:
            for callback in callbacks:
                callback()

        self.assertEqual(response.status_code, 200)
        sql = _sql(request_ctx) + "\n" + _sql(commit_ctx)
        self.assertNotIn('UPDATE "anime_anime"', sql)
        self.assertLessEqual(len(request_ctx), PATCH_BUDGET, _sql(request_ctx))
        self.assertLessEqual(len(commit_ctx), PATCH_ON_COMMIT_BUDGET, _sql(commit_ctx))
        self.assertEqual(UserActivity.objects.filter(user=self.user).count(), 1)
