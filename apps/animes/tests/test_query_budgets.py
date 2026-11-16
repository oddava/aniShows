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
    "detail": 8,
    "public_profile": 4,
    "detail_authenticated": 11,
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
