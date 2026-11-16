"""The list endpoint's shared cache and its key (B10, B11, B12, P1-2).

Guests and members share one cached page per (known parameters, adult-content
setting); a member's favourites and list entries are added after the cache.
Unknown parameters cannot mint keys, ``exclude_ids`` and the page number are
bounded, and the responses say they vary by credentials.
"""

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.http import QueryDict
from django.urls import reverse
from rest_framework.test import APIClient

from apps.animes.models import Anime, Genre, UserFavorite
from apps.animes.services.public_anime_service import AnimePublicPayloadService
from apps.animes.services.public_query.filters import MAX_EXCLUDE_IDS
from apps.users.models import UserAnimeList, UserProfile

URL = reverse("anime-list")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def catalog(db):
    hentai = Genre.objects.create(name="Hentai", slug="hentai")
    safe = Anime.objects.create(
        title="Frieren", slug="frieren", synopsis="x", member_count=900_000, episode_count=28
    )
    other = Anime.objects.create(
        title="Mushishi", slug="mushishi", synopsis="x", member_count=800_000
    )
    adult = Anime.objects.create(
        title="Adult Title", slug="adult-title", synopsis="x", member_count=850_000
    )
    adult.genres.add(hentai)
    return {"safe": safe, "other": other, "adult": adult}


def _member(username: str, *, adult: bool = False):
    user = get_user_model().objects.create_user(
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


def _key(params: dict | str, *, adult: bool = False) -> str:
    query = QueryDict(params) if isinstance(params, str) else QueryDict(mutable=True)
    if isinstance(params, dict):
        for name, value in params.items():
            query[name] = value
    return AnimePublicPayloadService.list_cache_key(query, can_view_adult_content=adult)


def _by_slug(response) -> dict[str, dict]:
    return {item["slug"]: item for item in response.json()["results"]}


@pytest.mark.django_db
def test_a_member_is_served_the_guests_cached_page_with_their_own_state(catalog):
    member = _member("member")
    UserFavorite.objects.create(user=member, anime=catalog["safe"], order=0)
    UserAnimeList.objects.create(
        user=member,
        anime=catalog["safe"],
        status=UserAnimeList.UserAnimeStatus.watching,
        episodes_watched=7,
    )

    guest = _client().get(URL, {"q": "frieren"})
    signed_in = _client(member).get(URL, {"q": "frieren"})

    assert guest["X-Cache-Status"] == "miss"
    assert signed_in["X-Cache-Status"] == "hit"
    member_item = _by_slug(signed_in)["frieren"]
    assert member_item["is_favorite"] is True
    assert member_item["user_list_status"]["episodes_watched"] == 7
    assert member_item["user_list_status"]["progress"] == pytest.approx(25.0)
    guest_item = _by_slug(guest)["frieren"]
    assert guest_item["is_favorite"] is False
    assert guest_item["user_list_status"] is None


@pytest.mark.django_db
def test_a_member_filling_the_cache_leaks_nothing_to_guests(catalog):
    member = _member("member")
    UserFavorite.objects.create(user=member, anime=catalog["safe"], order=0)
    UserAnimeList.objects.create(
        user=member, anime=catalog["safe"], status=UserAnimeList.UserAnimeStatus.completed
    )

    signed_in = _client(member).get(URL)
    guest = _client().get(URL)

    assert signed_in["X-Cache-Status"] == "miss"
    assert guest["X-Cache-Status"] == "hit"
    assert _by_slug(signed_in)["frieren"]["is_favorite"] is True
    assert all(item["is_favorite"] is False for item in guest.json()["results"])
    assert all(item["user_list_status"] is None for item in guest.json()["results"])


@pytest.mark.django_db
def test_the_adult_content_setting_gets_its_own_page(catalog):
    opted_in = _client(_member("adult", adult=True)).get(URL)
    member = _client(_member("member")).get(URL)
    guest = _client().get(URL)

    assert "adult-title" in _by_slug(opted_in)
    assert "adult-title" not in _by_slug(member)
    assert "adult-title" not in _by_slug(guest)
    # A member who has not opted in shares the guests' page.
    assert (opted_in["X-Cache-Status"], member["X-Cache-Status"], guest["X-Cache-Status"]) == (
        "miss",
        "miss",
        "hit",
    )


def test_unknown_parameters_produce_the_same_key():
    assert _key("q=frieren&x=random-1") == _key("q=frieren") == _key("q=frieren&utm_source=feed")


def test_equivalent_parameters_share_a_key():
    assert _key("genre=action,drama") == _key("genre=drama&genre=action")
    assert _key("type=TV,movie") == _key("type=movie,tv")
    assert _key("q=%20Frieren%20&sort=Relevance") == _key("q=frieren&sort=relevance")
    assert _key("exclude_ids=3,1,2,1") == _key("exclude_ids=1,2,3")
    # Too short to search: the filter ignores it, so the key does too.
    assert _key("q=a") == _key("")


def test_different_requests_get_different_keys():
    assert _key("q=frieren") != _key("q=mushishi")
    assert _key("q=frieren") != _key("q=frieren", adult=True)
    assert _key("page=2") != _key("")
    assert _key("sort=rating") != _key("sort=popular")
    # The sort variants test the raw value, so a blank one is not "absent".
    assert _key("season=%20") != _key("")
    assert _key("status=,") != _key("")


def test_exclude_ids_are_capped():
    many = ",".join(str(index) for index in range(1, 300))
    params = AnimePublicPayloadService.list_cache_key_params(QueryDict(f"exclude_ids={many}"))
    assert params["exclude_ids"] == list(range(1, MAX_EXCLUDE_IDS + 1))
    assert _key(f"exclude_ids={many}") == _key(
        "exclude_ids=" + ",".join(str(index) for index in range(1, MAX_EXCLUDE_IDS + 1))
    )


@pytest.mark.django_db
def test_exclude_ids_past_the_cap_are_ignored_by_the_filter(catalog):
    padding = ",".join(str(900_000 + index) for index in range(MAX_EXCLUDE_IDS))
    response = _client().get(URL, {"exclude_ids": f"{padding},{catalog['safe'].pk}"})

    assert "frieren" in _by_slug(response)


@pytest.mark.django_db
@pytest.mark.parametrize(("page", "status_code"), [("500", 200), ("501", 404), ("99999", 404)])
def test_pages_past_500_are_not_found(catalog, page, status_code):
    response = _client().get(URL, {"page": page})
    assert response.status_code == status_code


@pytest.mark.django_db
@pytest.mark.parametrize("signed_in", [False, True])
def test_list_and_shelf_responses_vary_by_credentials(catalog, signed_in):
    client = _client(_member("member") if signed_in else None)
    for url in (URL, reverse("anime-trending"), reverse("anime-schedule")):
        vary = {value.strip() for value in client.get(url)["Vary"].split(",")}
        assert {"Authorization", "Cookie"} <= vary, url
