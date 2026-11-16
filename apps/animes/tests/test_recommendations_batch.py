"""The daily recommendations batch and the generate_recommendations task (B14, P1-3, P2-4).

Per-user cost in the batch, measured: 8 queries whatever the list length (dismissed IDs,
list rows, favourite IDs, features of list anime outside the pool, then SAVEPOINT,
DELETE, INSERT, RELEASE). The pool costs 6 queries once per adult setting per run.
"""

from datetime import timedelta
from unittest.mock import patch

from celery.exceptions import Retry, SoftTimeLimitExceeded
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase

from ...users.models import UserAnimeList
from ..models import UserRecommendation
from ..services import recommendations as service_module
from ..services.recommendations import (
    CandidatePool,
    RecommendationService,
    recommendations_cache_key,
)
from ..tasks import recommendations as task_module
from ..tasks.recommendations import STORED_RECOMMENDATIONS_MIN, generate_recommendations
from .test_recommendations_service import RecommendationFixtures

User = get_user_model()

PER_USER_QUERIES = 8


class RecommendationBatchTestBase(RecommendationFixtures, APITestCase):
    def setUp(self):
        super().setUp()
        self.genres = [self.genre_action, self.genre_fantasy]
        self.candidates = [
            self._anime(f"Batch Candidate {index}", genres=self.genres) for index in range(6)
        ]
        self._serial = 0

    def _member(self, list_size: int = 3, *, username: str | None = None):
        """A user whose list anime are outside the pool (unrated), so features are queried."""
        self._serial += 1
        user = User.objects.create_user(
            username=username or f"batch-user-{self._serial}",
            email=f"batch-{self._serial}@example.com",
            password="x",
        )
        for index in range(list_size):
            anime = self._anime(
                f"Listed {self._serial}-{index}", genres=self.genres, rating=None, member_count=1
            )
            self._add_positive_list_entry(anime, user=user)
        return user

    @staticmethod
    def _age_rows(user, days: int) -> None:
        UserRecommendation.objects.filter(user=user).update(
            created_at=timezone.now() - timedelta(days=days)
        )

    @staticmethod
    def _age_list(user, days: int) -> None:
        UserAnimeList.objects.filter(user=user).update(
            updated_at=timezone.now() - timedelta(days=days)
        )


class BatchSelectionTests(RecommendationBatchTestBase):
    def _selected(self) -> set[int]:
        return set(RecommendationService.batch_users().values_list("id", flat=True))

    def test_selects_active_users_whose_rows_are_a_week_old(self):
        no_rows = self._member()
        old_rows = self._member()
        UserRecommendation.objects.create(user=old_rows, anime=self.candidates[0], score=70)
        self._age_rows(old_rows, days=8)
        fresh_rows = self._member()
        UserRecommendation.objects.create(user=fresh_rows, anime=self.candidates[0], score=70)
        self._age_rows(fresh_rows, days=2)
        dismissed_only = self._member()
        UserRecommendation.objects.create(
            user=dismissed_only, anime=self.candidates[0], score=70, is_dismissed=True
        )

        selected = self._selected()

        self.assertTrue({no_rows.id, old_rows.id, dismissed_only.id} <= selected)
        self.assertNotIn(fresh_rows.id, selected)

    def test_skips_inactive_users(self):
        dormant = self._member()
        self._age_list(dormant, days=60)
        logged_in = self._member()
        self._age_list(logged_in, days=60)
        User.objects.filter(pk=logged_in.pk).update(last_login=timezone.now() - timedelta(days=3))
        deactivated = self._member()
        User.objects.filter(pk=deactivated.pk).update(is_active=False)
        no_list = User.objects.create_user(
            username="no-list", email="nl@example.com", password="x", last_login=timezone.now()
        )

        selected = self._selected()

        self.assertIn(logged_in.id, selected)
        self.assertNotIn(dormant.id, selected)
        self.assertNotIn(deactivated.id, selected)
        self.assertNotIn(no_list.id, selected)


class BatchRunTests(RecommendationBatchTestBase):
    def test_a_failing_user_is_logged_and_skipped(self):
        failing = self._member()
        healthy = self._member()
        original = RecommendationService.generate_for_user

        def generate(service, user, *args, **kwargs):
            if user.id == failing.id:
                raise RuntimeError("boom")
            return original(service, user, *args, **kwargs)

        with (
            patch.object(RecommendationService, "generate_for_user", autospec=True) as mocked,
            patch.object(service_module.logger, "exception") as log_exception,
        ):
            mocked.side_effect = generate
            stats = RecommendationService().generate_for_all_users(limit=5)

        self.assertEqual(stats["failed"], 1)
        self.assertEqual(stats["failed_user_ids"], [failing.id])
        self.assertGreaterEqual(stats["processed"], 1)
        self.assertTrue(UserRecommendation.objects.filter(user=healthy).exists())
        log_exception.assert_called_once()

    def test_the_soft_time_limit_stops_the_batch(self):
        self._member()
        self._member()

        with (
            patch.object(
                RecommendationService, "generate_for_user", side_effect=SoftTimeLimitExceeded()
            ) as generate,
            self.assertRaises(SoftTimeLimitExceeded),
        ):
            RecommendationService().generate_for_all_users(limit=5)

        # Out of time: no further user is attempted (it is not one user's failure).
        generate.assert_called_once()

    def test_pool_is_built_once_per_adult_setting(self):
        for _ in range(3):
            self._member()
        adult_viewer = self._member()
        self._allow_adult(adult_viewer)

        with patch.object(CandidatePool, "build", wraps=CandidatePool.build) as build:
            stats = RecommendationService().generate_for_all_users(limit=5)

        self.assertGreaterEqual(stats["processed"], 4)
        self.assertEqual(
            sorted(call.kwargs["include_adult"] for call in build.call_args_list), [False, True]
        )

    def test_writing_drops_the_users_cached_payload(self):
        member = self._member()
        cache.set(recommendations_cache_key(member.id), {"adult": False, "items": []})

        RecommendationService().generate_for_all_users(limit=5)

        self.assertIsNone(cache.get(recommendations_cache_key(member.id)))
        self.assertTrue(UserRecommendation.objects.filter(user=member).exists())

    def test_per_user_queries_do_not_grow_with_list_size(self):
        pool = CandidatePool.build(include_adult=False)
        service = RecommendationService()
        counts = []
        for list_size in (3, 30):
            member = self._member(list_size)
            with CaptureQueriesContext(connection) as queries:
                saved = service.generate_for_user(member, limit=5, pool=pool, can_view_adult=False)
            self.assertTrue(saved)
            counts.append(len(queries))

        self.assertEqual(counts, [PER_USER_QUERIES, PER_USER_QUERIES])

    def test_batch_queries_grow_only_per_user(self):
        service = RecommendationService()
        first = [self._member(3), self._member(20)]
        with CaptureQueriesContext(connection) as small:
            service.generate_for_all_users(limit=5)

        for user in first:
            self._age_rows(user, days=8)
        self._member(40)
        self._member(5)
        with CaptureQueriesContext(connection) as large:
            stats = service.generate_for_all_users(limit=5)

        self.assertEqual(stats["processed"], 4)
        self.assertEqual(len(large) - len(small), 2 * PER_USER_QUERIES)


class RecommendationTaskTests(RecommendationBatchTestBase):
    def test_batch_mode_never_retries(self):
        with (
            patch.object(
                RecommendationService, "generate_for_all_users", side_effect=RuntimeError("db")
            ),
            patch.object(generate_recommendations, "retry") as retry,
        ):
            result = generate_recommendations.apply(kwargs={"limit": 10})

        self.assertTrue(result.failed())
        retry.assert_not_called()

    def test_single_user_mode_keeps_its_retry(self):
        member = self._member()
        with (
            patch.object(
                RecommendationService, "generate_for_user", side_effect=RuntimeError("db")
            ),
            patch.object(generate_recommendations, "retry", side_effect=Retry()) as retry,
        ):
            generate_recommendations.apply(kwargs={"user_id": member.id})

        retry.assert_called_once()

    def test_single_user_mode_does_not_retry_the_time_limit(self):
        member = self._member()
        with (
            patch.object(
                RecommendationService, "generate_for_user", side_effect=SoftTimeLimitExceeded()
            ),
            patch.object(generate_recommendations, "retry") as retry,
        ):
            result = generate_recommendations.apply(kwargs={"user_id": member.id})

        self.assertTrue(result.failed())
        retry.assert_not_called()

    def test_stores_at_least_the_shelf_minimum(self):
        member = self._member()
        with patch.object(RecommendationService, "generate_for_user", return_value=[]) as gen:
            generate_recommendations.apply(kwargs={"user_id": member.id, "limit": 10})

        self.assertEqual(gen.call_args.kwargs["limit"], STORED_RECOMMENDATIONS_MIN)

    def test_algorithm_is_ignored_and_deprecation_logged_once(self):
        member = self._member()
        with (
            patch.object(task_module, "_deprecations_logged", set()),
            patch.object(task_module.logger, "warning") as warning,
        ):
            for _ in range(2):
                result = generate_recommendations.apply(
                    kwargs={"user_id": member.id, "algorithm": "collaborative"}
                )
                self.assertTrue(result.successful(), result.result)
            generate_recommendations.apply(kwargs={"user_id": member.id})

        warning.assert_called_once()
        self.assertIn("deprecated", warning.call_args.args[0])
        self.assertTrue(UserRecommendation.objects.filter(user=member).exists())

    def test_unknown_user_is_reported_not_retried(self):
        with patch.object(generate_recommendations, "retry") as retry:
            result = generate_recommendations.apply(kwargs={"user_id": 987_654})

        self.assertEqual(result.result["reason"], "user_not_found")
        retry.assert_not_called()
