"""Query budgets for the public read endpoints.

Each case requests an endpoint on a cold cache twice: once with 3 catalog rows
and again after adding 3 more. It asserts that:

- the query count does not grow with the number of rows (no N+1), and
- the count stays within a fixed budget, so a refactor that adds queries fails.

If you change a budget, do it on purpose and explain why in the same PR.
"""

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.animes.models import Character, Staff, UserRecommendation
from apps.animes.tests.catalog_fixtures import (
    DETAIL_SLUG,
    PUBLIC_ENDPOINTS,
    SHARED_CHARACTER_NAME,
    SHARED_STAFF_NAME,
    build_catalog,
    build_shared_people,
    build_viewer,
    freeze_schedule_now,
)

# Signed-in variants of the anonymous endpoints. A signed-in viewer adds per-user
# work (list status, favourites, the adult-content preference), so these get
# their own budgets. Kept here rather than in PUBLIC_ENDPOINTS, which the API
# contract snapshot also iterates.
SIGNED_IN_ENDPOINTS = {
    f"{name}_signed_in": (PUBLIC_ENDPOINTS[name][0], True)
    for name in ("search", "trending", "browse_rows", "schedule")
}
ENDPOINTS = {**PUBLIC_ENDPOINTS, **SIGNED_IN_ENDPOINTS}

# Cold-cache query counts measured on 2026-11-09, before the Phase 1+ refactors.
# The signed-in budgets and detail_authenticated were measured on 2026-11-16.
# Signing in adds 3 queries to each of these endpoints (the per-viewer
# enrichment applied after the shared cache), independent of row count.
# search: +1 since the relevance ordering (2026-11-16), which first checks
# whether a query has too many matches to rank them all.
# list_authenticated/search_signed_in (2026-11-16, P1-2): members now share the
# guests' cached page, so a cold request is the anonymous count + 3 (adult-content
# setting, favourites, list entries) and a warm one is 3 (see WARM_BUDGETS).
# Every count includes the admin-panel settings lookup each request makes.
BUDGETS = {
    "list": 4,
    "list_authenticated": 7,
    "search": 5,
    "trending": 4,
    "browse_rows": 8,
    "schedule": 4,
    # +1 for G3's cached site_status_counts aggregate (site_status_distribution, D-3).
    "detail": 9,
    "public_profile": 5,  # +1: live list totals, one stats calculation (UX P1)
    "detail_authenticated": 12,
    "search_signed_in": 8,
    "trending_signed_in": 7,
    "browse_rows_signed_in": 11,
    "schedule_signed_in": 7,
}

# Endpoints that list catalog rows. Their payload must include every fixture
# row, or the "no N+1" comparison would pass on an empty response.
LISTING_ENDPOINTS = {
    "list",
    "list_authenticated",
    "search",
    "trending",
    "browse_rows",
    "schedule",
    *SIGNED_IN_ENDPOINTS,
}


def _cold_query_count(client: APIClient, url: str) -> tuple[int, str]:
    cache.clear()
    with CaptureQueriesContext(connection) as queries:
        response = client.get(url)
    assert response.status_code == 200, response.content[:500]
    return len(queries), response.content.decode()


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    # The fixtures air in 2030; the schedule only ships the coming week (B7).
    freeze_schedule_now(monkeypatch)
    monkeypatch.setattr(
        "apps.animes.services.public_anime_service.AniListService.get_recommendations_for_anime",
        lambda *a, **k: [],
    )


@pytest.mark.django_db
@pytest.mark.parametrize("name", list(BUDGETS))
def test_public_endpoint_query_budget(name):
    build_url, authenticated = ENDPOINTS[name]
    first_batch = build_catalog(3)
    viewer = build_viewer(first_batch)
    client = APIClient()
    if authenticated:
        client.force_authenticate(viewer)
    url = build_url()

    # Warm per-process caches (content types, site, settings) so both
    # measurements count only the endpoint's own queries.
    client.get(url)
    small, _ = _cold_query_count(client, url)

    second_batch = build_catalog(3, start=4)
    build_viewer(first_batch + second_batch)
    large, body = _cold_query_count(client, url)

    if name in LISTING_ENDPOINTS:
        assert "guard-anime-006" in body, f"{name}: fixture rows missing from the response"
    assert large == small, (
        f"{name}: query count grows with rows ({small} for 3 rows, {large} for 6), "
        "which is an N+1 query"
    )
    assert large <= BUDGETS[name], (
        f"{name}: {large} queries, budget is {BUDGETS[name]}. "
        "Lower the count, or raise the budget on purpose."
    )


# --- Endpoints not in PUBLIC_ENDPOINTS (B17) -----------------------------------
# A separate dict, so PUBLIC_ENDPOINTS and the contract snapshot stay as they are.
# The character and staff pages are the shared fixture people, who have a role in
# every catalog row, so their payload grows with the catalog.


def _character_url() -> str:
    return reverse("characters-detail", args=[Character.objects.get(name=SHARED_CHARACTER_NAME).pk])


def _staff_url() -> str:
    return reverse("staff-detail", args=[Staff.objects.get(name=SHARED_STAFF_NAME).pk])


EXTRA_ENDPOINTS = {
    "top_rated": (PUBLIC_ENDPOINTS["top_rated"][0], False),
    "related": (lambda: reverse("anime-related", kwargs={"slug": DETAIL_SLUG}), False),
    "recommendations": (
        lambda: reverse("anime-recommendations", kwargs={"slug": DETAIL_SLUG}),
        False,
    ),
    "characters": (lambda: reverse("anime-characters", kwargs={"slug": DETAIL_SLUG}), False),
    "staff": (lambda: reverse("anime-staff", kwargs={"slug": DETAIL_SLUG}), False),
    "character_detail": (_character_url, False),
    "character_detail_signed_in": (_character_url, True),
    "staff_detail": (_staff_url, False),
    "staff_detail_signed_in": (_staff_url, True),
    "user_recommendations": (lambda: reverse("recommendations-list"), True),
    "genres": (lambda: reverse("genre-list"), False),
    "studios": (lambda: reverse("studio-list"), False),
}

# Measured 2026-11-16 (cold cache, each including the admin-panel settings lookup):
# top_rated 4 (shelf, genres, studios); related 6 (anime, relation ids, shelf +
# 2 prefetches); recommendations 7 with AniList patched (anime, relation targets,
# genres, fallback shelf + 2 prefetches; one fewer than with ``_relation_mal_ids``,
# P2-6); characters/staff 4 (anime, COUNT, page); character_detail 4 (character,
# roles, favourite count) and +1 signed in (adult-content setting); staff_detail 5
# (staff, voice roles, credits, favourite count), +1 signed in; user_recommendations
# 5 (measured cold, signed in; the view never generates in the request, P1-3);
# genres and studios 2 (one query each).
EXTRA_BUDGETS = {
    "top_rated": 4,
    "related": 6,
    "recommendations": 7,
    "characters": 4,
    "staff": 4,
    "character_detail": 4,
    "character_detail_signed_in": 5,
    "staff_detail": 5,
    "staff_detail_signed_in": 6,
    "user_recommendations": 5,
    "genres": 2,
    "studios": 2,
}

EXTRA_LISTING_ENDPOINTS = {
    "top_rated",
    "recommendations",
    "character_detail",
    "character_detail_signed_in",
    "staff_detail",
    "staff_detail_signed_in",
    "user_recommendations",
}


def _seed_extra_rows(count: int, *, start: int = 1):
    """Catalog rows, plus the viewer's list, the shared people and recommendations."""
    anime_list = build_catalog(count, start=start)
    from apps.animes.models import Anime

    every_row = list(Anime.objects.order_by("id"))
    viewer = build_viewer(every_row)
    build_shared_people(every_row)
    for anime in anime_list:
        UserRecommendation.objects.create(
            user=viewer, anime=anime, score=50 + anime.pk % 40, reason="genre_match"
        )
    return viewer


@pytest.mark.django_db
@pytest.mark.parametrize("name", list(EXTRA_BUDGETS))
def test_extra_endpoint_query_budget(name):
    build_url, authenticated = EXTRA_ENDPOINTS[name]
    viewer = _seed_extra_rows(3)
    client = APIClient()
    if authenticated:
        client.force_authenticate(viewer)
    url = build_url()

    client.get(url)
    small, _ = _cold_query_count(client, url)

    _seed_extra_rows(3, start=4)
    large, body = _cold_query_count(client, url)

    if name in EXTRA_LISTING_ENDPOINTS:
        assert "guard-anime-006" in body, f"{name}: fixture rows missing from the response"
    assert large == small, (
        f"{name}: query count grows with rows ({small} for 3 rows, {large} for 6), "
        "which is an N+1 query"
    )
    assert large <= EXTRA_BUDGETS[name], (
        f"{name}: {large} queries, budget is {EXTRA_BUDGETS[name]}. "
        "Lower the count, or raise the budget on purpose."
    )


# --- Warm cache: what a signed-in viewer costs once the shared payload exists ---
# Counted without the admin-panel settings lookup (every request makes it).
# Measured 2026-11-16: the list, search and shelf endpoints 3 (adult-content
# setting, favourites, list entries); detail 2 (no adult lookup: the detail
# payload is not gated); character/staff detail 2 (adult-content setting,
# favourite count + state in one query); user_recommendations 1 (agent B's view).
WARM_ENDPOINTS = {
    **{name: ENDPOINTS[name] for name in ENDPOINTS if ENDPOINTS[name][1]},
    "character_detail_signed_in": EXTRA_ENDPOINTS["character_detail_signed_in"],
    "staff_detail_signed_in": EXTRA_ENDPOINTS["staff_detail_signed_in"],
    "user_recommendations": EXTRA_ENDPOINTS["user_recommendations"],
}
WARM_BUDGETS = {
    "list_authenticated": 3,
    "detail_authenticated": 2,
    "search_signed_in": 3,
    "trending_signed_in": 3,
    "browse_rows_signed_in": 3,
    "schedule_signed_in": 3,
    "character_detail_signed_in": 2,
    "staff_detail_signed_in": 2,
    "user_recommendations": 1,
}


@pytest.mark.django_db
@pytest.mark.parametrize("name", list(WARM_BUDGETS))
def test_signed_in_warm_cache_query_budget(name):
    build_url, _ = WARM_ENDPOINTS[name]
    viewer = _seed_extra_rows(3)
    client = APIClient()
    client.force_authenticate(viewer)
    url = build_url()
    cache.clear()
    assert client.get(url).status_code == 200  # fills the shared cache

    # A fresh request object, as in production: nothing memoised on the user.
    client.force_authenticate(type(viewer).objects.get(pk=viewer.pk))
    with CaptureQueriesContext(connection) as queries:
        response = client.get(url)
    assert response.status_code == 200, response.content[:500]
    own = [q["sql"] for q in queries.captured_queries if "core_adminpanelsettings" not in q["sql"]]
    assert len(own) == WARM_BUDGETS[name], (
        f"{name}: {len(own)} queries on a warm cache, pinned at {WARM_BUDGETS[name]}: "
        + "; ".join(sql[:80] for sql in own)
    )
