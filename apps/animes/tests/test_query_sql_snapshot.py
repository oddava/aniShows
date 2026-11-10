"""The SQL the public list and shelf querysets compile to, pinned per input.

Phase 5 replaced ``AnimeQueryService._apply_sort``'s if/elif chain with a table
and split the service into modules. This test proves the move changed no SQL:
it compiles ``str(queryset.query)`` for every sort key under every combination
of the sort flags, for a spread of list filters, and for each browse shelf, and
compares the result with ``snapshots/query_sql.json`` (generated from the code
before the refactor).

The adult-content exclusion is left out on purpose (the viewer may see adult
content): its SQL changed with D5 and has its own tests.

Regenerate only after an intended query change:

    UPDATE_SQL_SNAPSHOTS=1 make test ARGS="apps/animes/tests/test_query_sql_snapshot.py"
"""

import itertools
import json
import os
from pathlib import Path
from unittest import mock

import pytest
from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import EmptyResultSet
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.animes.models import Anime, Genre
from apps.animes.services.public_anime_service import AnimeQueryService

SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "query_sql.json"
UPDATE = os.getenv("UPDATE_SQL_SNAPSHOTS") == "1"

# Every key the sort table knows, plus an unknown one (falls back to popular).
SORT_KEYS = ["popular", "rating", "newest", "title", "upcoming", "trending", "unknown"]
SORT_FLAGS = (
    "has_active_filters",
    "has_non_temporal_filters",
    "has_temporal_filters",
    "apply_temporal_popular_quality_filter",
    "curate_for_shelves",
)
LIST_FILTERS = [
    {},
    {"q": "ab"},
    {"q": "abc"},
    {"q": "two words x"},
    {"genre": "action"},
    {"genre": "action,drama"},
    {"genre": "missing"},
    {"status": "airing,finished,bogus"},
    {"type": "tv,movie"},
    {"studio": "5"},
    {"studio": "nope"},
    {"min_rating": "7", "max_rating": "9.5"},
    {"min_rating": "11"},
    {"source": " Manga "},
    {"tags": "Isekai, magic"},
    {"exclude_ids": "1,2,x,3"},
    {"shelf": "all-time"},
    {"min_episodes": "1", "max_episodes": "12"},
    {"min_duration": "10", "max_duration": "30"},
    {"season": "fall", "year": "2026"},
    {"season": "spring", "year": "2027"},
    {"season": "winter", "year": "2020"},
    {"year": "2020"},
    {"min_year": "2000", "max_year": "2010"},
    {"min_year": "1970"},
]
# Filters crossed with every sort key: none, search, current, future and past season, genre.
CROSSED_FILTERS = [
    {},
    {"q": "abc"},
    {"season": "fall", "year": "2026"},
    {"season": "spring", "year": "2027"},
    {"season": "winter", "year": "2020"},
    {"genre": "action"},
]
SHELF_CASES = [
    {"sort": "trending"},
    {"sort": "popular", "season": "fall", "year": 2026},
    {"sort": "popular", "season": "winter", "year": 2027},
    {"sort": "popular", "min_member_count": 200_000},
    {"sort": "rating"},
    {"sort": "rating", "limit": 12},
    {"sort": "newest", "exclude_ids": [3, 1, 2]},
    {"sort": "popular", "season": "winter", "year": 2020},
]
SEASON_WINDOW = ("fall", 2026, "winter", 2027)


def _sql(queryset) -> str:
    try:
        return str(queryset.query)
    except EmptyResultSet:  # queryset.none(), e.g. an unknown genre slug
        return "<empty>"


def _sort_cases() -> dict[str, str]:
    cases = {}
    for sort_key in SORT_KEYS:
        for values in itertools.product([False, True], repeat=len(SORT_FLAGS)):
            flags = dict(zip(SORT_FLAGS, values, strict=True))
            queryset, ordering = AnimeQueryService._apply_sort(
                Anime.objects.only("id"), sort_clean=sort_key, **flags
            )
            label = ",".join(name for name, value in flags.items() if value) or "-"
            cases[f"sort:{sort_key}:{label}"] = _sql(queryset.order_by(*ordering))
    return cases


def _list_request(params: dict) -> Request:
    request = Request(APIRequestFactory().get("/api/v1/anime/", params))
    request.user = AnonymousUser()
    return request


def _list_cases() -> dict[str, str]:
    service = AnimeQueryService()
    combos = [dict(params) for params in LIST_FILTERS]
    combos += [{**params, "sort": key} for params in CROSSED_FILTERS for key in SORT_KEYS]
    cases = {}
    for params in combos:
        queryset = service._apply_list_filters(Anime.objects.only("id"), _list_request(params))
        cases["list:" + json.dumps(params, sort_keys=True)] = _sql(queryset)
    return cases


def _shelf_cases() -> dict[str, str]:
    service = AnimeQueryService()
    return {
        "shelf:" + json.dumps(kwargs, sort_keys=True): _sql(
            service.browse_row_queryset(can_view_adult_content=True, **kwargs)
        )
        for kwargs in SHELF_CASES
    }


@pytest.mark.django_db
def test_public_query_sql_matches_snapshot():
    # Fixed ids, so genre filters compile to the same literals on every run.
    Genre.objects.create(id=9001, name="Action", slug="action")
    Genre.objects.create(id=9002, name="Drama", slug="drama")

    with (
        mock.patch.object(AnimeQueryService, "can_view_adult_content", return_value=True),
        mock.patch.object(
            AnimeQueryService, "_current_and_next_seasons", return_value=SEASON_WINDOW
        ),
    ):
        compiled = {**_sort_cases(), **_list_cases(), **_shelf_cases()}

    if UPDATE:
        SNAPSHOT_PATH.write_text(
            json.dumps(compiled, indent=1, sort_keys=True) + "\n", encoding="utf-8"
        )
        pytest.skip("SQL snapshot regenerated")

    expected = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    assert sorted(compiled) == sorted(expected), "the set of compiled cases changed"
    mismatched = [key for key in sorted(expected) if compiled[key] != expected[key]]
    assert not mismatched, f"{len(mismatched)} queries compile differently, e.g. {mismatched[:5]}"
