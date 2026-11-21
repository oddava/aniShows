"""GET/refresh/dismiss on /api/v1/recommendations/ (B5, B13, P0-4, P1-3).

Query counts measured here, whole request with force_authenticate (a JWT request adds
one user lookup). Every request also runs the admin-settings read (uncached in tests),
and the first one the throttled ``last_activity`` UPDATE: "+2" below. Every GET also
checks the served titles against the list (L2: never recommend a listed show): "+1"
on top of the counts below.
- GET with rows, cold: 4 + 2 = 6 (adult setting, rows + anime, genres, studios);
  warm: 1 + 1 = 2 (the adult setting the cached payload is checked against).
- GET with stale rows, cold: 6, plus the debounced enqueue (no query).
- GET without rows, cold: 6 + 2 = 8 (adult, rows, trending shelf + genres + studios,
  the list/dismissed exclusion); with the shared fallback cached: 3 + 2 = 5; warm: 2.
"""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from root.settings import base as base_settings

from ...users.serializers.recommendations import UserRecommendationSerializer
from ..models import UserRecommendation
from ..services.recommendations import (
    RecommendationService,
    fallback_cache_key,
    recommendations_cache_key,
)
from ..tasks.recommendations import generate_recommendations
from ..views.recommendations import SHORT_CACHE_TTL
from .test_recommendations_service import RecommendationFixtures

User = get_user_model()

URL = "/api/v1/recommendations/"
REFRESH_URL = "/api/v1/recommendations/refresh/"


class RecommendationsViewTestBase(RecommendationFixtures, APITestCase):
    def setUp(self):
        super().setUp()
        enqueue = patch.object(generate_recommendations, "apply_async")
        self.enqueue = enqueue.start()
        self.addCleanup(enqueue.stop)
        self._login()

    def _login(self) -> None:
        # A fresh user object per request, as real authentication gives: the adult
        # setting is memoised on the user instance.
        self.client.force_authenticate(user=User.objects.get(pk=self.user.pk))

    def _forget_pending(self) -> None:
        """Fixture list saves queue a (mocked) task and set the debounce key; drop it."""
        cache.delete(f"reco_pending:{self.user.id}")
        self.enqueue.reset_mock()

    def _row(self, anime, *, score: int = 80, age: timedelta | None = None) -> UserRecommendation:
        rec = UserRecommendation.objects.create(
            user=self.user,
            anime=anime,
            score=score,
            reason=UserRecommendation.RecommendationReason.GENRE_MATCH,
            reason_metadata={"matched_genres": ["Action"]},
        )
        if age is not None:
            UserRecommendation.objects.filter(pk=rec.pk).update(created_at=timezone.now() - age)
        return rec

    def _get(self, **params):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(URL, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response, len(queries)


class RecommendationsRefreshTests(RecommendationsViewTestBase):
    def test_refresh_returns_202_and_enqueues_once_then_debounces(self):
        first = self.client.post(REFRESH_URL)
        second = self.client.post(REFRESH_URL)

        for response in (first, second):
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json(), {"queued": True})
        self.enqueue.assert_called_once()
        self.assertEqual(self.enqueue.call_args.kwargs["kwargs"], {"user_id": self.user.id})

    def test_a_refresh_the_broker_refused_is_not_debounced(self):
        from kombu.exceptions import OperationalError

        self._forget_pending()
        self.enqueue.side_effect = OperationalError("broker down")
        refused = self.client.post(REFRESH_URL)
        self.enqueue.side_effect = None
        retried = self.client.post(REFRESH_URL)

        self.assertEqual(refused.status_code, 503)
        # Nothing was queued, so the retry must really queue (not answer 202 for nothing).
        self.assertEqual(retried.status_code, 202)
        self.assertEqual(self.enqueue.call_count, 2)

    def test_a_refresh_with_the_cache_down_is_a_503_not_a_500(self):
        from redis.exceptions import ConnectionError as RedisConnectionError

        with (
            patch(
                "apps.animes.views.recommendations.schedule_recommendations_debounced",
                side_effect=RedisConnectionError("cache down"),
            ),
            patch.object(cache, "delete", side_effect=RedisConnectionError("cache down")),
        ):
            response = self.client.post(REFRESH_URL)

        self.assertEqual(response.status_code, 503)

    def test_refresh_never_generates_in_the_request(self):
        with patch.object(RecommendationService, "generate_for_user") as generate:
            self.client.post(REFRESH_URL)
        generate.assert_not_called()

    def test_eleventh_refresh_within_a_minute_is_throttled(self):
        # The test settings lift every rate; restore the production strict_user rate.
        rate = base_settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["strict_user"]
        self.assertEqual(rate, "10/minute")
        rates = {**ScopedRateThrottle.THROTTLE_RATES, "strict_user": rate}

        with patch.object(ScopedRateThrottle, "THROTTLE_RATES", rates):
            statuses = [self.client.post(REFRESH_URL).status_code for _ in range(11)]

        self.assertEqual(statuses[:10], [202] * 10)
        self.assertEqual(statuses[10], 429)


class RecommendationsReadTests(RecommendationsViewTestBase):
    def test_a_show_added_to_the_list_is_no_longer_recommended(self):
        """L2: Frieren (Completed) and ONE PIECE (Watching) were still "for you"."""
        from ...users.models import UserAnimeList

        frieren = self._anime("Frieren", genres=[self.genre_fantasy])
        other = self._anime("Other Pick", genres=[self.genre_action])
        self._row(frieren, score=90)
        keep = self._row(other, score=80)

        first, _ = self._get()
        self.assertEqual(len(first.json()), 2)

        # Listed after the rows were generated and the payload cached.
        UserAnimeList.objects.create(user=self.user, anime=frieren, status="Completed")
        self._login()
        cached, _ = self._get()
        cache.delete(recommendations_cache_key(self.user.id))
        self._login()
        cold, _ = self._get()

        for response in (cached, cold):
            self.assertEqual([item["id"] for item in response.json()], [keep.id])

    def test_fresh_rows_are_served_and_cached_without_enqueueing(self):
        anime = self._anime("Fresh Pick", genres=[self.genre_action])
        rec = self._row(anime)

        response, cold = self._get()
        self._login()
        cached, warm = self._get()

        self.assertEqual([item["id"] for item in response.json()], [rec.id])
        self.assertEqual(cached.json(), response.json())
        self.assertLessEqual(cold, 7)
        self.assertEqual(warm, 3)
        self.enqueue.assert_not_called()

    def test_stale_rows_are_served_and_one_refresh_is_queued(self):
        anime = self._anime("Stale Pick", genres=[self.genre_action])
        rec = self._row(anime, age=timedelta(days=2))

        with patch.object(RecommendationService, "generate_for_user") as generate:
            response, cold = self._get()
            cache.delete(recommendations_cache_key(self.user.id))
            self._login()
            self._get()

        self.assertEqual([item["id"] for item in response.json()], [rec.id])
        self.assertLessEqual(cold, 7)
        generate.assert_not_called()
        # The second read is debounced by reco_pending:{id}.
        self.enqueue.assert_called_once()

    def test_without_rows_the_trending_fallback_is_served_and_generation_queued(self):
        listed = self._anime("Already Listed", trending_rank=1)
        self._add_positive_list_entry(listed)
        trending = [self._anime(f"Trending {rank}", trending_rank=rank) for rank in (2, 3)]
        self._anime("Not Trending", trending_rank=None)
        self._forget_pending()

        with patch.object(RecommendationService, "generate_for_user") as generate:
            response, cold = self._get()
        self._login()
        _, warm = self._get()

        items = response.json()
        self.assertEqual([item["anime"]["id"] for item in items], [anime.id for anime in trending])
        self.assertEqual(set(items[0]), set(UserRecommendationSerializer.Meta.fields))
        self.assertEqual(len({item["id"] for item in items}), len(items))
        for item in items:
            self.assertEqual(item["reason"], "trending")
            self.assertEqual(item["reason_text"], "Trending now")
            self.assertEqual(item["reason_metadata"], {})
            self.assertNotIn("Because you liked", item["reason_text"])
        self.assertLessEqual(cold, 9)
        self.assertEqual(warm, 3)
        generate.assert_not_called()
        self.enqueue.assert_called_once()

    def test_shared_fallback_cache_saves_the_shelf_queries(self):
        self._anime("Trending Shared", trending_rank=1)
        other = User.objects.create_user(username="other", email="o@example.com", password="x")

        self._get()
        self.client.force_authenticate(user=other)
        _, second_user_cold = self._get()

        self.assertIsNotNone(cache.get(fallback_cache_key(False)))
        self.assertLessEqual(second_user_cold, 6)

    def test_empty_result_is_cached_for_ten_minutes(self):
        with patch.object(cache, "set", wraps=cache.set) as cache_set:
            response, _ = self._get()

        self.assertEqual(response.json(), [])
        key = recommendations_cache_key(self.user.id)
        timeouts = [call.args[2] for call in cache_set.call_args_list if call.args[0] == key]
        self.assertEqual(timeouts, [SHORT_CACHE_TTL])
        self.assertEqual(SHORT_CACHE_TTL, 600)
        self.assertEqual(cache.get(key), {"adult": False, "items": []})

        self._login()
        _, warm = self._get()
        self.assertEqual(warm, 2)
        self.enqueue.assert_called_once()

    def test_cached_payload_is_rebuilt_when_the_adult_setting_changes(self):
        safe = self._anime("Safe Row")
        adult = self._anime("Adult Row")
        self._make_adult(adult)
        self._row(safe)
        self._row(adult, score=90)

        before, _ = self._get()
        self._allow_adult()
        self._login()
        after, _ = self._get()

        self.assertEqual([item["anime"]["id"] for item in before.json()], [safe.id])
        self.assertEqual([item["anime"]["id"] for item in after.json()], [adult.id, safe.id])

    def test_limit_applies_to_the_cached_payload(self):
        for index in range(3):
            self._row(self._anime(f"Limited {index}"), score=80 - index)

        self._get()
        self._login()
        response, _ = self._get(limit=2)

        self.assertEqual(len(response.json()), 2)


class RecommendationsDismissTests(RecommendationsViewTestBase):
    def test_dismiss_hides_the_title_on_the_next_read(self):
        kept = self._row(self._anime("Kept"))
        dismissed = self._row(self._anime("Dismissed"), score=90)
        self._get()

        response = self.client.post(f"{URL}{dismissed.anime_id}/dismiss/")
        self._login()
        after, _ = self._get()

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in after.json()], [kept.id])

    def test_dismiss_unknown_anime_is_404(self):
        response = self.client.post(f"{URL}999999/dismiss/")
        self.assertEqual(response.status_code, 404)


class RecommendationsCacheDownTests(RecommendationsViewTestBase):
    """G2: when the cache (Redis) fails, list and dismiss answer from the database (no 500).

    Only the recommendations code's own cache is broken here: DRF's rate throttles
    use the same Redis and still need it (a separate fail-open/closed decision).
    """

    def _cache_down(self):
        from unittest.mock import MagicMock

        from redis.exceptions import ConnectionError as RedisConnectionError

        broken = MagicMock()
        for method in ("get", "set", "delete"):
            getattr(broken, method).side_effect = RedisConnectionError("cache down")
        return (
            patch("apps.animes.views.recommendations.cache", broken),
            patch("apps.animes.services.recommendations.cache", broken),
            patch("apps.animes.views.recommendations._queue_refresh", return_value=False),
        )

    def test_list_serves_stored_rows(self):
        self._row(self._anime("Kept Show"))
        get, set_, delete = self._cache_down()
        with get, set_, delete:
            response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([item["anime"]["title"] for item in response.json()], ["Kept Show"])

    def test_list_serves_the_trending_fallback(self):
        get, set_, delete = self._cache_down()
        with get, set_, delete:
            response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content)

    def test_dismiss_is_saved(self):
        rec = self._row(self._anime("Dismissed Show"))
        get, set_, delete = self._cache_down()
        with get, set_, delete:
            response = self.client.post(f"{URL}{rec.anime_id}/dismiss/")
        self.assertEqual(response.status_code, 200, response.content)
        rec.refresh_from_db()
        self.assertTrue(rec.is_dismissed)


class RecommendationsRedisOutageTests(RecommendationsViewTestBase):
    """The whole default cache down, throttles included: still no 500 (G2)."""

    def test_list_and_dismiss_answer_with_the_default_cache_down(self):
        from django.test import override_settings
        from redis.exceptions import ConnectionError as RedisConnectionError

        from apps.core.services import admin_settings_service

        # Production reads site settings through the cache (SiteControlMiddleware).
        settings_cache = override_settings(ADMIN_SETTINGS_USE_CACHE=True)
        settings_cache.enable()
        self.addCleanup(settings_cache.disable)
        admin_settings_service._clear_local_cached_settings()
        self.addCleanup(admin_settings_service._clear_local_cached_settings)

        rec = self._row(self._anime("Outage Show"))
        down = RedisConnectionError("cache down")
        with (
            patch.object(cache, "get", side_effect=down),
            patch.object(cache, "get_many", side_effect=down),
            patch.object(cache, "set", side_effect=down),
            patch.object(cache, "add", side_effect=down),
            patch.object(cache, "delete", side_effect=down),
            patch.object(cache, "incr", side_effect=down),
            patch("apps.animes.views.recommendations._queue_refresh", return_value=False),
        ):
            listed = self.client.get(URL)
            dismissed = self.client.post(f"{URL}{rec.anime_id}/dismiss/")

        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([item["anime"]["title"] for item in listed.json()], ["Outage Show"])
        self.assertEqual(dismissed.status_code, 200, dismissed.content)

    def test_refresh_does_not_500_either(self):
        from redis.exceptions import ConnectionError as RedisConnectionError

        down = RedisConnectionError("cache down")
        with (
            patch.object(cache, "get", side_effect=down),
            patch.object(cache, "set", side_effect=down),
            patch.object(cache, "add", side_effect=down),
            patch.object(cache, "delete", side_effect=down),
            patch(
                "apps.animes.views.recommendations.schedule_recommendations_debounced",
                side_effect=down,
            ),
        ):
            response = self.client.post(REFRESH_URL)
        self.assertEqual(response.status_code, 503, response.content)


class RecommendationsFollowCatalogVisibilityTests(RecommendationsViewTestBase):
    def test_a_title_flagged_adult_leaves_a_cached_page_at_once(self):
        from apps.animes.adult_content import apply_anilist_adult_flags

        anime = self._anime("Soon Adult", anilist_id=424242)
        self._row(anime)
        first, _ = self._get()
        self.assertEqual([item["anime"]["title"] for item in first.json()], ["Soon Adult"])

        with self.captureOnCommitCallbacks(execute=True):
            apply_anilist_adult_flags([{"id": 424242, "isAdult": True}])

        self._login()
        second, _ = self._get()
        self.assertNotIn("Soon Adult", [item["anime"]["title"] for item in second.json()])
