"""The schedule endpoint is cached like browse-rows.

One payload per day filter and adult-content setting, built without the viewer
and enriched per user after the cache, and dropped whenever an anime changes.
"""

import re
from datetime import time

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.animes.models import Anime, Genre, UserFavorite
from apps.animes.serializers import AnimeListSerializer
from apps.animes.services.public_anime_service import AnimeQueryService
from apps.users.models import UserAnimeList, UserProfile

User = get_user_model()
URL = "/api/v1/anime/schedule/"


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    cache.clear()
    yield
    cache.clear()


def _airing(slug: str, day: str, **extra) -> Anime:
    return Anime.objects.create(
        title=slug.replace("-", " ").title(),
        slug=slug,
        synopsis="x",
        status=Anime.AnimeStatus.airing,
        broadcast_day=day,
        broadcast_time=time(10, 0),
        broadcast_timezone="Asia/Tokyo",
        episode_count=12,
        **extra,
    )


@pytest.fixture
def catalog():
    hentai = Genre.objects.create(name="Hentai", slug="hentai")
    safe = _airing("safe-monday", "Monday")
    other = _airing("safe-tuesday", "Tuesday")
    adult = _airing("adult-monday", "Monday")
    adult.genres.add(hentai)
    return {"safe": safe, "other": other, "adult": adult}


def _user(username: str, *, adult: bool = False):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="x"
    )
    if adult:
        UserProfile.objects.filter(user=user).update(show_adult_content=True)
    return user


def _client(user=None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user)
    return client


def _get(client: APIClient, url: str = URL):
    """Return the response and the tables its queries read."""
    with CaptureQueriesContext(connection) as queries:
        response = client.get(url)
    assert response.status_code == 200, response.content[:500]
    tables = [
        match.group(1) if (match := re.search(r'FROM "(\w+)"', query["sql"])) else query["sql"]
        for query in queries.captured_queries
        # The admin-panel settings lookup runs on every request, cached or not.
        if "core_adminpanelsettings" not in query["sql"]
    ]
    return response, tables


def _slugs(response) -> set[str]:
    data = response.json()
    items = data["items"] if "items" in data else [i for day in data["days"].values() for i in day]
    return {item["slug"] for item in items}


@pytest.mark.django_db
@pytest.mark.parametrize("url", [URL, f"{URL}?day=monday"])
def test_second_request_is_served_from_the_cache(catalog, url):
    client = _client()
    first, cold_queries = _get(client, url)
    second, warm_queries = _get(client, url)

    assert first["X-Cache-Status"] == "miss"
    assert second["X-Cache-Status"] == "hit"
    assert second.json() == first.json()
    assert cold_queries[0] == "anime_anime"
    assert len(cold_queries) == 3  # schedule rows, genres, studios
    assert warm_queries == []


@pytest.mark.django_db
def test_response_shape_and_grouping_are_unchanged(catalog):
    week = _client().get(URL).json()
    monday = _client().get(f"{URL}?day=Monday").json()

    assert list(week) == ["days", "counts", "total"]
    assert list(week["days"]) == [day.lower() for day in AnimeQueryService.SCHEDULE_DAY_NAMES]
    assert week["counts"]["monday"] == 1
    assert week["counts"]["tuesday"] == 1
    assert week["total"] == 2
    assert list(monday) == ["day", "items", "count"]
    assert monday["day"] == "monday"
    assert [item["slug"] for item in monday["items"]] == ["safe-monday"]
    assert monday["count"] == 1


@pytest.mark.django_db
@pytest.mark.parametrize("url", [URL, f"{URL}?day=monday"])
@pytest.mark.parametrize("opted_in_first", [True, False])
def test_adult_setting_gets_its_own_cache_entry(catalog, url, opted_in_first):
    opted_in = _client(_user("adult", adult=True))
    anonymous = _client()
    order = [opted_in, anonymous] if opted_in_first else [anonymous, opted_in]
    for client in order:  # fill both entries, in either order
        client.get(url)

    adult_view, _ = _get(opted_in, url)
    anonymous_view, _ = _get(anonymous, url)

    assert adult_view["X-Cache-Status"] == anonymous_view["X-Cache-Status"] == "hit"
    assert "adult-monday" in _slugs(adult_view)
    assert "adult-monday" not in _slugs(anonymous_view)
    assert "safe-monday" in _slugs(anonymous_view)


@pytest.mark.django_db
@pytest.mark.parametrize("url", [URL, f"{URL}?day=monday"])
def test_user_state_is_added_after_the_cache_and_does_not_leak(catalog, url):
    owner = _user("owner")
    UserFavorite.objects.create(user=owner, anime=catalog["safe"], order=0)
    UserAnimeList.objects.create(
        user=owner,
        anime=catalog["safe"],
        status=UserAnimeList.UserAnimeStatus.watching,
        episodes_watched=3,
    )

    def safe_item(client):
        response, queries = _get(client, url)
        data = response.json()
        items = data["items"] if "items" in data else data["days"]["monday"]
        (item,) = [i for i in items if i["slug"] == "safe-monday"]
        return response, item, queries

    owner_first, owner_item, _ = safe_item(_client(owner))
    assert owner_first["X-Cache-Status"] == "miss"
    assert owner_item["is_favorite"] is True
    assert owner_item["user_list_status"]["status"] == UserAnimeList.UserAnimeStatus.watching
    assert owner_item["user_list_status"]["episodes_watched"] == 3

    anonymous, anonymous_item, anonymous_queries = safe_item(_client())
    other_user, other_item, _ = safe_item(_client(_user("someone-else")))
    _, owner_again, owner_warm_queries = safe_item(_client(owner))

    assert anonymous["X-Cache-Status"] == other_user["X-Cache-Status"] == "hit"
    assert anonymous_queries == []
    assert anonymous_item["is_favorite"] is False
    assert anonymous_item["user_list_status"] is None
    assert other_item["is_favorite"] is False
    assert other_item["user_list_status"] is None
    assert owner_again == owner_item
    # Only the viewer's favourites and list entries; no catalog queries. (The
    # adult-content setting is memoised on this user object by the first call.)
    assert owner_warm_queries == ["anime_userfavorite", "users_useranimelist"]


@pytest.mark.django_db
def test_user_state_matches_the_uncached_annotation(catalog):
    """The enrichment produces what the old per-request annotation did."""
    owner = _user("owner")
    UserFavorite.objects.create(user=owner, anime=catalog["other"], order=0)
    UserAnimeList.objects.create(
        user=owner,
        anime=catalog["safe"],
        status=UserAnimeList.UserAnimeStatus.completed,
        episodes_watched=12,
        score=9,
    )
    annotated = AnimeQueryService().schedule_queryset(owner, include_user_context=True)
    expected = {
        item["slug"]: (item["is_favorite"], item["user_list_status"])
        for item in AnimeListSerializer(annotated, many=True).data
    }

    data = _client(owner).get(URL).json()
    actual = {
        item["slug"]: (item["is_favorite"], item["user_list_status"])
        for items in data["days"].values()
        for item in items
    }

    assert actual == expected


@pytest.mark.django_db
def test_saving_an_anime_invalidates_the_schedule(catalog):
    client = _client()
    client.get(URL)
    client.get(f"{URL}?day=tuesday")

    catalog["safe"].broadcast_day = "Tuesday"
    catalog["safe"].save()

    week, _ = _get(client, URL)
    tuesday, _ = _get(client, f"{URL}?day=tuesday")
    assert week["X-Cache-Status"] == tuesday["X-Cache-Status"] == "miss"
    assert week.json()["counts"] == {**week.json()["counts"], "monday": 0, "tuesday": 2}
    assert {item["slug"] for item in tuesday.json()["items"]} == {"safe-monday", "safe-tuesday"}
