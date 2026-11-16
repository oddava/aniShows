from types import SimpleNamespace

import pytest
from django.core.cache import cache
from django.db import connection
from django.test import SimpleTestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Anime
from ..serializers.anime import AnimeDetailSerializer
from ..services.public_anime_service import AnimePublicPayloadService


class AnimeDetailStatusDistributionTests(SimpleTestCase):
    def test_status_distribution_uses_denormalized_counts(self):
        anime = SimpleNamespace(
            pk=99,
            status_distribution={
                "watching": 2,
                "completed": 1,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 4,
            },
        )

        distribution = AnimeDetailSerializer().get_status_distribution(anime)

        self.assertEqual(
            distribution,
            {
                "watching": 2,
                "completed": 1,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 4,
            },
        )

    def test_status_distribution_normalizes_missing_counts(self):
        anime = SimpleNamespace(
            pk=99,
            status_distribution={
                "watching": 2,
            },
        )

        distribution = AnimeDetailSerializer().get_status_distribution(anime)

        self.assertEqual(
            distribution,
            {
                "watching": 2,
                "completed": 0,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 0,
            },
        )

    def test_status_distribution_defaults_to_zero_without_anime_id(self):
        anime = SimpleNamespace(pk=None)
        distribution = AnimeDetailSerializer().get_status_distribution(anime)

        self.assertEqual(
            distribution,
            {
                "watching": 0,
                "completed": 0,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 0,
            },
        )


class AniListStatusDistributionTests(SimpleTestCase):
    """The provider stores AniList's keys (CURRENT, PLANNING...); the payload uses ours (B6)."""

    def _distribution(self, stored):
        return AnimeDetailSerializer().get_status_distribution(
            SimpleNamespace(pk=1, status_distribution=stored)
        )

    def test_anilist_keys_are_mapped_onto_the_five_statuses(self):
        self.assertEqual(
            self._distribution(
                {"CURRENT": 120, "PLANNING": 300, "COMPLETED": 900, "DROPPED": 15, "PAUSED": 40}
            ),
            {
                "watching": 120,
                "completed": 900,
                "on_hold": 40,
                "dropped": 15,
                "plan_to_watch": 300,
            },
        )

    def test_aliases_of_one_status_are_summed_case_insensitively(self):
        distribution = self._distribution({"current": 10, "REPEATING": 5, "Watching": 1})
        self.assertEqual(distribution["watching"], 16)

    def test_unknown_keys_and_bad_counts_are_ignored(self):
        self.assertEqual(
            self._distribution({"CURRENT": "x", "PLANNING": None, "SOMETHING": 9, "PAUSED": "4"}),
            {"watching": 0, "completed": 0, "on_hold": 4, "dropped": 0, "plan_to_watch": 0},
        )

    def test_a_non_dict_value_gives_zeros(self):
        self.assertEqual(set(self._distribution(["CURRENT"]).values()), {0})


@pytest.fixture
def _detail(db, monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    cache.clear()
    anime = Anime.objects.create(
        title="Counted",
        slug="counted",
        synopsis="x",
        status_distribution={"CURRENT": 7, "PLANNING": 3},
    )
    yield anime
    cache.clear()


def _get_detail(slug: str):
    with CaptureQueriesContext(connection) as queries:
        response = APIClient().get(reverse("anime-detail", args=[slug]))
    assert response.status_code == 200
    return response, len(queries)


@pytest.mark.django_db
def test_the_detail_payload_shows_anilist_counts(_detail):
    response, _ = _get_detail(_detail.slug)
    assert response.json()["status_distribution"] == {
        "watching": 7,
        "completed": 0,
        "on_hold": 0,
        "dropped": 0,
        "plan_to_watch": 3,
    }


@pytest.mark.django_db
def test_site_counts_are_null_and_free_until_g3_provides_them(_detail, monkeypatch):
    from apps.animes.services import user_list_side_effects

    monkeypatch.delattr(user_list_side_effects, "site_status_counts", raising=False)
    _get_detail(_detail.slug)  # fill the detail cache

    response, warm_queries = _get_detail(_detail.slug)

    assert response["X-Cache-Status"] == "hit"
    assert response.json()["site_status_distribution"] is None
    assert warm_queries == 1  # only the admin-panel settings lookup every request makes


@pytest.mark.django_db
def test_site_counts_are_read_per_request_not_from_the_detail_cache(_detail, monkeypatch):
    from apps.animes.services import user_list_side_effects

    counts = {"watching": 1, "completed": 0, "on_hold": 0, "dropped": 0, "plan_to_watch": 0}
    calls = []

    def site_status_counts(anime_id):
        calls.append(anime_id)
        return dict(counts)

    monkeypatch.setattr(
        user_list_side_effects, "site_status_counts", site_status_counts, raising=False
    )
    first, _ = _get_detail(_detail.slug)
    counts["watching"] = 2
    second, _ = _get_detail(_detail.slug)

    assert second["X-Cache-Status"] == "hit"
    assert first.json()["site_status_distribution"]["watching"] == 1
    assert second.json()["site_status_distribution"]["watching"] == 2
    assert calls == [_detail.pk, _detail.pk]
    cached = cache.get(AnimePublicPayloadService.detail_cache_key(_detail.slug))
    assert "site_status_distribution" not in cached
