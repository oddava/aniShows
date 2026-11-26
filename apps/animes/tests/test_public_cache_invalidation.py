"""What an Anime (or list) save invalidates, and when (B2, P0-2).

A list change never saves the Anime row (G3, D-3): ``status_distribution``
stays the catalog provider's, and only the per-anime site counts cache
(``site_status_distribution``, added per request) is dropped. The collection
namespace and the detail payload both survive. A card-field save bumps the
namespace. Both happen on commit. A reader waiting for another builder gives
up after at most 3 s and builds the payload itself.
"""

from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.animes.models import Anime
from apps.animes.services.public_anime_service import AnimePublicPayloadService
from apps.shared import public_cache
from apps.users.models import UserAnimeList

NAMESPACE_KEY = "anime_collection_ns:v12"
LIST_URL = f"{reverse('anime-list')}?page_size=24"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.request_hydrate", lambda *a, **k: None)
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def anime(db):
    return Anime.objects.create(
        title="Frieren",
        slug="frieren",
        synopsis="An elf mage.",
        status=Anime.AnimeStatus.airing,
        episode_count=28,
    )


def _cached_list_keys() -> list[str]:
    """The stored list payload keys (LocMemCache keeps them as ``:<version>:<key>``)."""
    return [
        key.split(":", 2)[2]
        for key in cache._cache  # type: ignore[attr-defined]  # LocMemCache internals
        if ":anime_list:" in key and not key.endswith(":lock")
    ]


def _warm_list_and_detail(anime) -> str:
    client = APIClient()
    assert client.get(LIST_URL)["X-Cache-Status"] == "miss"
    assert client.get(reverse("anime-detail", args=[anime.slug])).status_code == 200
    return cache.get(NAMESPACE_KEY)


def test_namespace_key_name_is_the_one_ops_watch():
    assert AnimePublicPayloadService.COLLECTION_CACHE_NAMESPACE_KEY == NAMESPACE_KEY


@pytest.mark.django_db
def test_a_list_save_keeps_every_collection_cached(anime, django_capture_on_commit_callbacks):
    namespace = _warm_list_and_detail(anime)
    list_keys = _cached_list_keys()
    assert list_keys
    user = get_user_model().objects.create_user(
        username="lister", email="lister@example.com", password="x"
    )

    # The list-change side effects drop only the site status counts, on commit.
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        UserAnimeList.objects.create(
            user=user, anime=anime, status=UserAnimeList.UserAnimeStatus.watching
        )
    assert callbacks, "the list change did not schedule its side effects"
    anime.refresh_from_db()
    assert not anime.status_distribution, "a list write touched the Anime row"

    assert cache.get(NAMESPACE_KEY) == namespace
    assert all(cache.get(key) is not None for key in list_keys)
    assert APIClient().get(LIST_URL)["X-Cache-Status"] == "hit"
    # The detail payload is not rebuilt; the site counts are fresh per request.
    assert cache.get(AnimePublicPayloadService.detail_cache_key(anime.slug)) is not None
    detail = APIClient().get(reverse("anime-detail", args=[anime.slug]))
    assert detail.json()["site_status_distribution"]["watching"] == 1


@pytest.mark.django_db
def test_a_detail_only_save_drops_just_the_detail(anime, django_capture_on_commit_callbacks):
    namespace = _warm_list_and_detail(anime)
    detail_key = AnimePublicPayloadService.detail_cache_key(anime.slug)
    assert cache.get(detail_key) is not None

    anime.trailer_url = "https://www.youtube.com/watch?v=frieren"
    with django_capture_on_commit_callbacks(execute=True):
        anime.save(update_fields=["trailer_url"])

    assert cache.get(detail_key) is None
    assert cache.get(NAMESPACE_KEY) == namespace


@pytest.mark.django_db
# ``synopsis`` is on the shelves (SHELF_FIELDS), so it is a card field here.
@pytest.mark.parametrize("update_fields", [None, ["title"], ["title", "synopsis"], ["synopsis"]])
def test_a_card_field_save_bumps_the_namespace_on_commit(
    anime, django_capture_on_commit_callbacks, update_fields
):
    namespace = _warm_list_and_detail(anime)

    anime.title = "Frieren: Beyond Journey's End"
    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        anime.save(update_fields=update_fields)
        # Not yet committed: a reader would still see the old row, so nothing moved.
        assert cache.get(NAMESPACE_KEY) == namespace
    for callback in callbacks:
        callback()

    assert cache.get(NAMESPACE_KEY) != namespace
    assert cache.get(AnimePublicPayloadService.detail_cache_key(anime.slug)) is None
    assert APIClient().get(LIST_URL)["X-Cache-Status"] == "miss"


@pytest.mark.django_db
def test_a_renamed_slug_drops_the_old_detail_payload(anime, django_capture_on_commit_callbacks):
    _warm_list_and_detail(anime)
    old_key = AnimePublicPayloadService.detail_cache_key("frieren")

    anime.slug = "frieren-beyond"
    with django_capture_on_commit_callbacks(execute=True):
        anime.save()

    assert cache.get(old_key) is None


@pytest.mark.django_db
def test_a_deleted_anime_is_invalidated_on_commit(anime, django_capture_on_commit_callbacks):
    namespace = _warm_list_and_detail(anime)
    detail_key = AnimePublicPayloadService.detail_cache_key(anime.slug)

    with django_capture_on_commit_callbacks(execute=True):
        anime.delete()

    assert cache.get(NAMESPACE_KEY) != namespace
    assert cache.get(detail_key) is None


# --- The lock-wait cap ----------------------------------------------------------


class _Clock:
    """``time.monotonic`` that advances only when the code sleeps."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds
        self.slept += seconds


@pytest.mark.parametrize(
    ("timeout_ms", "cap_ms", "expected_wait_s"),
    [
        (30_000, 3_000, 3.0),  # base.py's 30 s never applies
        (1_000, 3_000, 1.0),  # a lower timeout still wins
        (30_000, None, 3.0),  # the cap defaults to 3 s without the setting
    ],
)
def test_a_reader_waits_at_most_the_cap_then_rebuilds(timeout_ms, cap_ms, expected_wait_s):
    cache.add(public_cache.public_cache_lock_key("held"), "another-request", 120)
    clock = _Clock()
    settings_override = {"PUBLIC_API_CACHE_WAIT_TIMEOUT_MS": timeout_ms}
    if cap_ms is not None:
        settings_override["PUBLIC_API_CACHE_WAIT_CAP_MS"] = cap_ms

    with (
        override_settings(**settings_override),
        mock.patch.object(public_cache.time, "monotonic", clock.monotonic),
        mock.patch.object(public_cache.time, "sleep", clock.sleep),
    ):
        if cap_ms is None:
            from django.conf import settings

            del settings.PUBLIC_API_CACHE_WAIT_CAP_MS
        payload, status = public_cache.get_or_build_public_payload(
            "held", lambda: {"built": True}, ttl=60
        )

    assert (payload, status) == ({"built": True}, "rebuild")
    assert clock.slept == pytest.approx(expected_wait_s, abs=0.05)
    assert clock.slept <= 3.0 + 0.05
