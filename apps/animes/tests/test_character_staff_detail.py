"""Character and staff pages (B15, P1-4 backend).

Roles come only from public anime, and adult anime only for viewers who opted
in. The role queries read the columns the serializers use, never whole Anime
rows. Each page is cached per adult-content setting; the favourite count and
the viewer's favourite state are read fresh on every request.
"""

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.animes.models import (
    Anime,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Genre,
    OfflineAnimeSyncState,
    Staff,
    UserFavoriteCharacter,
    UserFavoriteStaff,
)
from apps.users.models import UserProfile

CHARACTER_KEYS = [
    "id",
    "anilist_id",
    "name",
    "name_native",
    "image",
    "image_medium",
    "description",
    "favorite_count",
    "is_favorite",
    "anime_roles",
]
STAFF_KEYS = [
    "id",
    "anilist_id",
    "name",
    "name_native",
    "image",
    "image_medium",
    "description",
    "favorite_count",
    "is_favorite",
    "voice_roles",
    "production_credits",
]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def people(db):
    hentai = Genre.objects.create(name="Hentai", slug="hentai")
    public = Anime.objects.create(title="Public Show", slug="public-show", synopsis="x")
    adult = Anime.objects.create(title="Adult Show", slug="adult-show", synopsis="x")
    adult.genres.add(hentai)
    hidden = Anime.objects.create(title="Hidden Show", slug="hidden-show", synopsis="x")
    OfflineAnimeSyncState.objects.create(
        anime=hidden,
        metadata_status=OfflineAnimeSyncState.StageStatus.QUARANTINED,
        franchise_status=OfflineAnimeSyncState.StageStatus.PENDING,
        quarantined=True,
        quarantine_reason="test",
    )
    character = Character.objects.create(name="Shared Character", description="About her.")
    staff = Staff.objects.create(name="Shared Staff", description="About them.")
    for anime in (public, adult, hidden):
        AnimeCharacter.objects.create(
            anime=anime, character=character, voice_actor=staff, role=AnimeCharacter.Role.MAIN
        )
        AnimeStaff.objects.create(anime=anime, staff=staff, role="Director")
    return {"character": character, "staff": staff}


def _member(username: str, *, adult: bool = False):
    user = get_user_model().objects.create_user(
        username=username, email=f"{username}@example.com", password="x"
    )
    if adult:
        UserProfile.objects.filter(user=user).update(show_adult_content=True)
    return user


def _get(url: str, user=None):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user)
    with CaptureQueriesContext(connection) as queries:
        response = client.get(url)
    assert response.status_code == 200, response.content[:300]
    return response, [query["sql"] for query in queries.captured_queries]


def _character_url(people) -> str:
    return reverse("characters-detail", args=[people["character"].pk])


def _staff_url(people) -> str:
    return reverse("staff-detail", args=[people["staff"].pk])


def _slugs(roles) -> set[str]:
    return {role["anime"]["slug"] for role in roles}


@pytest.mark.django_db
@pytest.mark.parametrize("viewer", ["guest", "member"])
def test_roles_skip_quarantined_and_adult_anime_for_viewers_not_opted_in(people, viewer):
    user = _member("member") if viewer == "member" else None

    character, _ = _get(_character_url(people), user)
    staff, _ = _get(_staff_url(people), user)

    assert _slugs(character.data["anime_roles"]) == {"public-show"}
    assert _slugs(staff.data["voice_roles"]) == {"public-show"}
    assert _slugs(staff.data["production_credits"]) == {"public-show"}


@pytest.mark.django_db
def test_opted_in_viewers_see_adult_roles_but_never_quarantined_ones(people):
    user = _member("adult", adult=True)

    character, _ = _get(_character_url(people), user)
    staff, _ = _get(_staff_url(people), user)

    assert _slugs(character.data["anime_roles"]) == {"public-show", "adult-show"}
    assert _slugs(staff.data["voice_roles"]) == {"public-show", "adult-show"}
    assert _slugs(staff.data["production_credits"]) == {"public-show", "adult-show"}


@pytest.mark.django_db
def test_the_response_shape_is_unchanged(people):
    character, _ = _get(_character_url(people))
    staff, _ = _get(_staff_url(people))

    assert list(character.data) == CHARACTER_KEYS
    assert list(staff.data) == STAFF_KEYS
    (role,) = character.data["anime_roles"]
    assert list(role) == ["id", "anime", "role", "voice_actor"]
    assert list(role["anime"]) == ["id", "title", "slug", "cover_image_small"]
    assert role["voice_actor"]["name"] == "Shared Staff"
    (voice_role,) = staff.data["voice_roles"]
    assert list(voice_role) == ["id", "anime", "character", "role"]
    assert voice_role["character"]["name"] == "Shared Character"
    assert character.data["description"] == "About her."


@pytest.mark.django_db
def test_role_queries_never_read_whole_anime_rows(people):
    for url in (_character_url(people), _staff_url(people)):
        _, queries = _get(url)
        anime_queries = [sql for sql in queries if '"anime_anime"' in sql]
        assert anime_queries, url
        for sql in queries:
            assert "offline_db_payload" not in sql, sql
            assert '"anime_anime"."synopsis"' not in sql, sql


@pytest.mark.django_db
def test_pages_are_cached_per_adult_setting_and_favourites_stay_fresh(people):
    url = _character_url(people)
    member = _member("member")
    first, _ = _get(url, member)
    assert first["X-Cache-Status"] == "miss"
    assert (first.data["favorite_count"], first.data["is_favorite"]) == (0, False)

    UserFavoriteCharacter.objects.create(user=member, character=people["character"])
    second, queries = _get(url, member)
    guest, _ = _get(url)

    assert second["X-Cache-Status"] == guest["X-Cache-Status"] == "hit"
    assert (second.data["favorite_count"], second.data["is_favorite"]) == (1, True)
    assert (guest.data["favorite_count"], guest.data["is_favorite"]) == (1, False)
    # No catalog query on a hit: the adult-content setting and one favourite query.
    assert not [sql for sql in queries if '"anime_animecharacter"' in sql]

    opted_in, _ = _get(url, _member("adult", adult=True))
    assert opted_in["X-Cache-Status"] == "miss"


@pytest.mark.django_db
def test_staff_favourites_stay_fresh_on_a_cached_page(people):
    url = _staff_url(people)
    member = _member("member")
    _get(url, member)
    UserFavoriteStaff.objects.create(user=member, staff=people["staff"])

    response, _ = _get(url, member)

    assert response["X-Cache-Status"] == "hit"
    assert (response.data["favorite_count"], response.data["is_favorite"]) == (1, True)


@pytest.mark.django_db
@pytest.mark.parametrize("basename", ["characters", "staff"])
def test_unknown_or_malformed_ids_are_not_found(people, basename):
    client = APIClient()
    assert client.get(reverse(f"{basename}-detail", args=[999_999])).status_code == 404
    assert client.get(f"/api/v1/{basename}/abc/").status_code == 404


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/api/v1/characters/", "/api/v1/staff/"])
def test_there_is_no_list_of_every_person(people, path):
    assert APIClient().get(path).status_code == 404
