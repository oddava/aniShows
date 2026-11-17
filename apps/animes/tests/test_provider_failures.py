"""What users and the catalog see when AniList is busy, down, or rejects a query.

Requests made while a user waits fail fast (see ``test_provider_http``), so
these paths are common, not exotic: fallbacks must be served without being
cached like real answers, failures must not read as "not found", and an
AniList-side problem must never hide catalog rows.
"""

from unittest import mock

import pytest
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from ...shared.public_cache import (
    DEGRADED_TTL_SECONDS,
    Degraded,
    get_or_build_public_payload,
    public_cache_stale_key,
)
from ..models import Anime, Genre
from ..services.anilist import AniListService
from ..services.franchise_import import FranchiseImportError, FranchiseImportService
from ..services.offline_sync_policy import OfflineSyncPolicy, StageResult
from ..services.watch_episodes import AnimeWatchEpisodeService

RECOMMENDATIONS = "apps.animes.services.public_anime_service.AniListService"
SCHEDULE = "apps.animes.services.watch_episodes.AniListService"


def _rate_limited(service_cls, method: str):
    """Make ``service_cls().method`` answer like a rate-limited AniList call."""
    service = service_cls.return_value
    service.last_error_code = "rate_limited"
    getattr(service, method).return_value = (
        None if method != "get_recommendations_for_anime" else []
    )
    service.REQUEST_BUDGET_INTERACTIVE = "interactive"
    return service


class PublicCacheDegradedTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_a_degraded_payload_is_served_but_kept_briefly(self):
        with mock.patch("apps.shared.public_cache.cache.set", wraps=cache.set) as cache_set:
            data, status = get_or_build_public_payload(
                "shelf", lambda: Degraded(["fallback"]), ttl=600
            )
        self.assertEqual((data, status), (["fallback"], "degraded"))
        ((key, _stored, timeout),) = [call.args for call in cache_set.call_args_list]
        self.assertEqual((key, timeout), ("shelf", DEGRADED_TTL_SECONDS))
        # No stale copy is written: a later good payload must not be shadowed.
        self.assertIsNone(cache.get(public_cache_stale_key("shelf")))
        # While it lasts, it is still reported as degraded.
        self.assertEqual(
            get_or_build_public_payload("shelf", lambda: ["rebuilt"], ttl=600),
            (["fallback"], "degraded"),
        )

    def test_an_old_good_payload_beats_the_fallback(self):
        cache.set(public_cache_stale_key("shelf"), ["good"], 3600)
        self.assertEqual(
            get_or_build_public_payload("shelf", lambda: Degraded(["fallback"]), ttl=600),
            (["good"], "stale"),
        )


class RecommendationsWhenAniListFailsTests(APITestCase):
    def setUp(self):
        cache.clear()
        genre = Genre.objects.create(name="Adventure", slug="adventure")
        self.anime = Anime.objects.create(
            title="Frieren", slug="frieren", synopsis="x", anilist_id=100, mal_id=1100
        )
        self.anime.genres.add(genre)
        neighbour = Anime.objects.create(title="Neighbour", slug="neighbour", synopsis="x")
        neighbour.genres.add(genre)
        self.url = reverse("anime-recommendations", kwargs={"slug": "frieren"})

    @mock.patch(RECOMMENDATIONS)
    def test_the_genre_fallback_is_not_cached_like_an_answer(self, service_cls):
        _rate_limited(service_cls, "get_recommendations_for_anime")

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["slug"] for row in response.json()], ["neighbour"])
        self.assertEqual(response["X-Cache-Status"], "degraded")
        self.assertEqual(response["Cache-Control"], "no-store")

    @mock.patch(RECOMMENDATIONS)
    def test_a_real_empty_answer_is_cached_normally(self, service_cls):
        service = service_cls.return_value
        service.last_error_code = ""
        service.get_recommendations_for_anime.return_value = []

        response = self.client.get(self.url)

        self.assertEqual(response["X-Cache-Status"], "miss")
        self.assertIn("public", response["Cache-Control"])


class WatchEpisodesWhenAniListFailsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.service = AnimeWatchEpisodeService()

    def _anime(self, **fields):
        return Anime.objects.create(
            title="Show", slug="show", synopsis="x", anilist_id=7, episode_count=12, **fields
        )

    @mock.patch(SCHEDULE)
    def test_the_stored_fallback_is_cached_for_a_minute_only(self, service_cls):
        _rate_limited(service_cls, "get_episode_schedule")
        anime = self._anime(status=Anime.AnimeStatus.finished)

        with mock.patch("apps.animes.services.watch_episodes.cache.set") as cache_set:
            episodes = self.service.get_for_anime(anime)

        self.assertEqual(len(episodes), 12)
        self.assertEqual(cache_set.call_args.kwargs["timeout"], 60)

    @mock.patch(SCHEDULE)
    def test_a_partial_episode_list_is_kept_for_a_minute_only(self, service_cls):
        service = service_cls.return_value
        service.last_error_code = ""
        service.get_episode_schedule.return_value = {
            "id": 7,
            "episodes": 120,
            "status": "FINISHED",
            "nextAiringEpisode": None,
            "streamingEpisodes": [],
            "airingSchedule": [{"episode": 1, "airingAt": 1_700_000_000}],
            "partial": True,  # the interactive deadline cut the schedule short
        }
        anime = self._anime(status=Anime.AnimeStatus.finished)

        with mock.patch("apps.animes.services.watch_episodes.cache.set") as cache_set:
            episodes = self.service.get_for_anime(anime)

        self.assertEqual(len(episodes), 120)
        self.assertEqual(cache_set.call_args.kwargs["timeout"], 60)

    @mock.patch(SCHEDULE)
    def test_the_fallback_never_lists_unaired_episodes(self, service_cls):
        _rate_limited(service_cls, "get_episode_schedule")
        airing = self._anime(status=Anime.AnimeStatus.airing, next_airing_episode=5)
        self.assertEqual(
            [episode["number"] for episode in self.service.get_for_anime(airing)], [1, 2, 3, 4]
        )

        Anime.objects.filter(pk=airing.pk).update(status=Anime.AnimeStatus.upcoming)
        cache.clear()
        airing.refresh_from_db()
        self.assertEqual(self.service.get_for_anime(airing), [])


class FranchiseImportWhenAniListFailsTests(TestCase):
    def setUp(self):
        cache.clear()

    @mock.patch("apps.animes.services.franchise_import.AniListService")
    def test_busy_anilist_is_503_not_404_and_costs_no_import_allowance(self, service_cls):
        service = _rate_limited(service_cls, "get_anime_by_id")
        importer = FranchiseImportService()

        with pytest.raises(FranchiseImportError) as caught:
            importer.import_related_anime(anilist_id=5, mal_id=6, client_ip="1.2.3.4")

        error = caught.value
        self.assertEqual(
            (error.status_code, error.code, error.retry_after), (503, "provider_unavailable", 30)
        )
        service.search_by_mal_id.assert_not_called()  # it would fail the same way
        self.assertEqual(cache.get("franchise_fetch:1.2.3.4"), 0)

    def test_the_endpoint_sends_retry_after(self):
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIClient

        admin = get_user_model().objects.create_superuser(
            username="admin", email="admin@example.com", password="x"
        )
        client = APIClient()
        client.force_authenticate(admin)
        error = FranchiseImportError("busy", 503, code="provider_unavailable", retry_after=30)
        with mock.patch(
            "apps.animes.services.franchise_import.FranchiseImportService.import_related_anime",
            side_effect=error,
        ):
            response = client.post(
                reverse("anime-franchise-fetch"), {"anilist_id": 5}, format="json"
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "30")
        self.assertEqual(response.json()["code"], "provider_unavailable")


class ProviderProblemsNeverQuarantineTests(TestCase):
    def test_transient_reasons_keep_retrying(self):
        policy = OfflineSyncPolicy()
        for code in ("rate_limited", "transport_error", "query_rejected"):
            result = StageResult(status="transient_error", reason_code=code, transient=True)
            self.assertFalse(policy._should_quarantine(result=result, attempts=500), code)

    def test_problems_with_the_row_still_quarantine(self):
        policy = OfflineSyncPolicy()
        blocked = StageResult(status="blocked_identity", reason_code="identity_conflict")
        self.assertTrue(policy._should_quarantine(result=blocked, attempts=2))

    def test_resolving_stops_after_a_rate_limited_lookup(self):
        anime = Anime.objects.create(
            title="Show", slug="show-x", synopsis="x", anilist_id=8, mal_id=9
        )
        service = AniListService(enable_caching=False, enable_rate_limiting=False)

        def rate_limited(_anilist_id):
            service._set_last_error("rate_limited", "local_rate_limit:GetAnimeById")

        with (
            mock.patch.object(service, "get_anime_by_id", side_effect=rate_limited),
            mock.patch.object(service, "search_by_mal_id") as by_mal,
            mock.patch.object(service, "search_anime") as by_title,
        ):
            self.assertIsNone(service.resolve_media_for_anime(anime))
        by_mal.assert_not_called()
        by_title.assert_not_called()
        service.close()
