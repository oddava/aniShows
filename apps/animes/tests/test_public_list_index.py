"""The anonymous default list must stay servable by ``anime_public_popular_list_idx``.

The partial index (``WHERE NOT is_adult``) is built from the same expressions as
the default ``popular`` list ordering (``popular_list_index_expressions``). If
the ordering or the adult filter changes shape, Postgres silently falls back to
sorting the whole table again; this test catches that by asking the planner,
with sequential scans, bitmap scans and sorts disabled, for a plan that reads
the index in order (no Sort node).
"""

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.animes.tests.catalog_fixtures import build_catalog

INDEX_NAME = "anime_public_popular_list_idx"


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


def _list_sql(url: str) -> str:
    cache.clear()
    with CaptureQueriesContext(connection) as queries:
        response = APIClient().get(url)
    assert response.status_code == 200
    (sql,) = [
        query["sql"]
        for query in queries.captured_queries
        if query["sql"].startswith('SELECT "anime_anime"."id"') and "LIMIT" in query["sql"]
    ]
    return sql


def _plan(sql: str) -> str:
    with connection.cursor() as cursor:
        # A 3-row table is cheaper to sort; take the cheap paths away so the
        # planner shows whether the index can deliver the order at all.
        for setting in ("enable_seqscan", "enable_bitmapscan", "enable_sort"):
            cursor.execute(f"SET LOCAL {setting} = off")
        cursor.execute(f"EXPLAIN {sql}")
        return "\n".join(row[0] for row in cursor.fetchall())


@pytest.mark.django_db
@pytest.mark.parametrize("url", ["/api/v1/anime/?page_size=24", "/api/v1/anime/?q=Guard"])
def test_anonymous_default_list_reads_the_partial_index_in_order(url):
    build_catalog(3)

    plan = _plan(_list_sql(url))

    assert f"Index Scan using {INDEX_NAME}" in plan, plan
    assert "Sort" not in plan, plan
