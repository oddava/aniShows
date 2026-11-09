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
from rest_framework.test import APIClient

from apps.animes.tests.catalog_fixtures import PUBLIC_ENDPOINTS, build_catalog, build_viewer

# Cold-cache query counts measured on 2026-11-09, before the Phase 1+ refactors.
BUDGETS = {
    "list": 4,
    "list_authenticated": 7,
    "search": 4,
    "trending": 4,
    "browse_rows": 8,
    "schedule": 4,
    "detail": 8,
    "public_profile": 4,
}

# Endpoints that list catalog rows. Their payload must include every fixture
# row, or the "no N+1" comparison would pass on an empty response.
LISTING_ENDPOINTS = {"list", "list_authenticated", "search", "trending", "browse_rows", "schedule"}


def _cold_query_count(client: APIClient, url: str) -> tuple[int, str]:
    cache.clear()
    with CaptureQueriesContext(connection) as queries:
        response = client.get(url)
    assert response.status_code == 200, response.content[:500]
    return len(queries), response.content.decode()


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


@pytest.mark.django_db
@pytest.mark.parametrize("name", list(BUDGETS))
def test_public_endpoint_query_budget(name):
    build_url, authenticated = PUBLIC_ENDPOINTS[name]
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
