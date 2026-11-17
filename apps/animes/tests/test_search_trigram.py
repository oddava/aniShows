"""Public search: trigram-backed substring and fuzzy matching, ranked by relevance.

The ``gin_trgm_ops`` indexes on ``title``, ``title_jp`` and ``synopsis`` used to
sit unused: ``icontains`` compiles to ``UPPER(col) LIKE``, which they cannot
serve. Search now uses ``ILIKE`` and pg_trgm word similarity (``q <% title``),
both index-served, so it also finds titles with a typo. The planner test at the
bottom fails if a change makes Postgres unable to use those indexes.
"""

import pytest
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.utils.text import slugify
from rest_framework.test import APIClient

from apps.animes.models import Anime


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


def _anime(title, *, rank, synopsis="A story.", title_jp=""):
    return Anime.objects.create(
        title=title,
        title_jp=title_jp,
        slug=slugify(title),
        synopsis=synopsis,
        status=Anime.AnimeStatus.finished,
        member_count=50_000,
        popularity_rank=rank,
        site_rank=rank,
        rating=8.0,
    )


def _titles(query: str, **params) -> list[str]:
    cache.clear()
    response = APIClient().get("/api/v1/anime/", {"q": query, "page_size": 50, **params})
    assert response.status_code == 200, response.content[:300]
    return [row["title"] for row in response.json()["results"]]


@pytest.fixture
def catalog(db):
    # The fuzzy-only match is the most popular, so a popularity order puts it first.
    _anime("Haruto", rank=1)
    _anime("Boruto: Naruto Next Generations", rank=2)
    _anime("Naruto Shippuden", rank=3)
    _anime("Naruto", rank=4)
    _anime("Attack on Titan", rank=5, title_jp="進撃の巨人")
    _anime("Frieren: Beyond Journey's End", rank=6, synopsis="An elf mage outlives her party.")
    _anime("100% Pascal-sensei", rank=7)
    _anime("1000 Days of Spring", rank=8)
    _anime("One Piece", rank=9)
    _anime("One-Punch Man", rank=10)


@pytest.mark.django_db
def test_connections_use_the_configured_similarity_threshold():
    with connection.cursor() as cursor:
        cursor.execute("SHOW pg_trgm.word_similarity_threshold")
        (value,) = cursor.fetchone()
    assert float(value) == settings.SEARCH_WORD_SIMILARITY_THRESHOLD == 0.5


def test_substring_match_ignores_case(catalog):
    assert _titles("FRIEREN") == ["Frieren: Beyond Journey's End"]
    assert _titles("進撃") == ["Attack on Titan"]


@pytest.mark.parametrize(
    ("typo", "title"),
    [
        ("narto", "Naruto"),
        ("atack on titan", "Attack on Titan"),
        ("frieren journy", "Frieren: Beyond Journey's End"),
        # "pice" alone scores 0.40 against "One Piece" (the per-word bar is
        # 0.5); the whole phrase scores 0.67 (smoke finding S-1).
        ("one pice", "One Piece"),
        ("attack on titn", "Attack on Titan"),
        # Three words, one misspelt below the per-word bar ("tian" 0.40).
        ("attack on tian", "Attack on Titan"),
    ],
)
def test_typos_still_find_the_title(catalog, typo, title):
    assert title in _titles(typo)


def test_a_phrase_match_ranks_the_closest_title_first(catalog):
    assert _titles("one pice")[0] == "One Piece"


@pytest.mark.parametrize(
    ("query", "title"),
    [
        # One exact word out of two already scores 0.5 as a phrase: the
        # unrelated word must still resemble the title.
        ("one zzzz", "One Piece"),
        ("one piece zzzz", "One Piece"),
        # The phrase scores 0.56 against "One-Punch Man", but "pice" does not
        # resemble any word in it.
        ("one pice", "One-Punch Man"),
    ],
)
def test_a_phrase_match_needs_every_word_to_resemble_the_title(catalog, query, title):
    assert title not in _titles(query)


def test_without_a_sort_the_best_match_comes_first(catalog):
    # Exact title, then title prefix, then other matches by similarity: the
    # popularity order (Haruto first) only breaks ties.
    titles = _titles("naruto")
    assert titles[:2] == ["Naruto", "Naruto Shippuden"]
    assert titles.index("Boruto: Naruto Next Generations") < titles.index("Haruto")
    assert _titles("naruto", sort="relevance") == titles


def test_an_explicit_sort_keeps_its_order(catalog):
    titles = _titles("naruto", sort="popular")
    assert titles[0] == "Haruto"
    assert set(titles) >= {"Naruto", "Naruto Shippuden", "Boruto: Naruto Next Generations"}


def test_a_single_word_also_matches_the_synopsis_by_substring_only(catalog):
    assert _titles("outlives") == ["Frieren: Beyond Journey's End"]
    assert _titles("outlvies") == []


def test_several_words_must_all_appear(catalog):
    assert _titles("titan attack") == ["Attack on Titan"]
    assert _titles("titan frieren") == []


def test_no_match(catalog):
    assert _titles("zzqxjv") == []


@pytest.mark.django_db
def test_ilike_treats_like_wildcards_literally(catalog):
    titles = set(Anime.objects.filter(title__ilike="100%").values_list("title", flat=True))
    assert titles == {"100% Pascal-sensei"}
    assert not Anime.objects.filter(title__ilike="n_ruto").exists()


@pytest.mark.parametrize(
    "query", ["frieren", "outlives", "naruto shippuden", "atack on titan", "one pice"]
)
def test_search_conditions_are_served_by_the_trigram_indexes(catalog, query):
    from apps.animes.services.public_anime_service import AnimeQueryService

    # The search predicate on its own: with sequential and plain index scans
    # off, Postgres can only answer it from index conditions, so this fails if a condition is not one the
    # trigram indexes serve (``UPPER(col) LIKE`` is not). The planner's choice
    # on the real catalog is recorded in docs/benchmarks/2026-11-search-after.md.
    queryset = AnimeQueryService._apply_search(Anime.objects.only("id").order_by(), query)
    sql, params = queryset.query.sql_with_params()
    assert "UPPER(" not in sql, sql
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL enable_seqscan = off")
        cursor.execute("SET LOCAL enable_indexscan = off")
        cursor.execute(f"EXPLAIN {sql}", params)
        plan = "\n".join(row[0] for row in cursor.fetchall())

    assert "Seq Scan" not in plan, plan
    assert "Bitmap Index Scan on anime_title_trgm_gin" in plan, plan
    assert "Bitmap Index Scan on anime_title_jp_trgm_gin" in plan, plan
    if " " not in query:
        assert "Bitmap Index Scan on anime_synopsis_trgm_gin" in plan, plan


@pytest.mark.django_db
def test_ilike_rejects_expressions():
    from django.db.models import F

    with pytest.raises(TypeError):
        list(Anime.objects.filter(title__ilike=F("slug")))


def _all_pages(query: str, page_size: int) -> list[str]:
    titles, page = [], 1
    while True:
        cache.clear()
        response = APIClient().get(
            "/api/v1/anime/", {"q": query, "page_size": page_size, "page": page}
        )
        assert response.status_code == 200
        body = response.json()
        titles += [row["title"] for row in body["results"]]
        if not body["next"]:
            return titles
        page += 1


def test_with_many_matches_exact_titles_still_lead_and_no_match_is_lost(catalog, monkeypatch):
    # "naruto" has 4 matches; with a window of 1 the query counts as common.
    # Ranked candidates: the most popular match (Haruto) and the best title
    # match (the exact "Naruto", although it is the least popular). Every other
    # match follows in popular order, on later pages: nothing is dropped.
    monkeypatch.setattr("apps.animes.services.public_query.filters.RELEVANCE_WINDOW", 1)
    expected = ["Naruto", "Haruto", "Boruto: Naruto Next Generations", "Naruto Shippuden"]
    assert _titles("naruto") == expected
    assert _all_pages("naruto", page_size=1) == expected
    assert _all_pages("naruto", page_size=3) == expected
    assert sorted(_titles("naruto", sort="popular")) == sorted(expected)


def test_ranked_results_reject_unsupported_indexing():
    from apps.animes.services.public_query.filters import RankedSearchResults

    results = RankedSearchResults(ranked=Anime.objects.none(), rest=Anime.objects.none())
    with pytest.raises(TypeError):
        results[0]
    with pytest.raises(TypeError):
        results[0:4:2]


def test_one_or_two_letters_keep_the_popular_order(catalog):
    assert _titles("ru") == _titles("ru", sort="popular")
