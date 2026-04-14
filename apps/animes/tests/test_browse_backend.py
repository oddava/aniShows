from datetime import date

import pytest
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.test import APIClient

from apps.animes.models import Anime, Genre, Studio
from apps.animes.services.catalog_sync import CatalogSyncService
from apps.animes.services.offline_catalog import (
    OfflineCatalogEntry,
    OfflineCatalogImportService,
)
from apps.animes.tasks.sync import SyncAnimeCatalogTask


def create_anime(**overrides):
    title = overrides.pop("title", f"Browse Anime {Anime.objects.count() + 1}")
    return Anime.objects.create(
        title=title,
        slug=overrides.pop("slug", slugify(title)),
        synopsis=overrides.pop("synopsis", "Browse test anime."),
        anime_type=overrides.pop("anime_type", Anime.AnimeType.tv),
        status=overrides.pop("status", Anime.AnimeStatus.airing),
        member_count=overrides.pop("member_count", 100_000 + Anime.objects.count()),
        **overrides,
    )


def create_genre(**overrides):
    name = overrides.pop("name", f"Browse Genre {Genre.objects.count() + 1}")
    return Genre.objects.create(
        name=name,
        slug=overrides.pop("slug", slugify(name)),
        **overrides,
    )


def create_studio(**overrides):
    name = overrides.pop("name", f"Browse Studio {Studio.objects.count() + 1}")
    return Studio.objects.create(name=name, **overrides)


@pytest.fixture(autouse=True)
def clear_browse_cache():
    cache.clear()


@pytest.fixture(autouse=True)
def stub_metadata_enrichment(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *args, **kwargs: None)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.mark.django_db
def test_browse_rows_cache_refreshes_after_trending_rank_sync(api_client):
    first = create_anime(title="Trending Alpha")
    second = create_anime(title="Trending Beta")
    sync_service = CatalogSyncService()
    sync_service.refresh_trending_ranks([first.id, second.id])

    initial_response = api_client.get(reverse("anime-browse-rows"))
    initial_trending = next(row for row in initial_response.data if row["key"] == "trending")
    initial_titles = [anime["title"] for anime in initial_trending["anime_list"]]

    assert initial_titles[:2] == [first.title, second.title]

    sync_service.refresh_trending_ranks([second.id, first.id])

    refreshed_response = api_client.get(reverse("anime-browse-rows"))
    refreshed_trending = next(row for row in refreshed_response.data if row["key"] == "trending")
    refreshed_titles = [anime["title"] for anime in refreshed_trending["anime_list"]]

    assert refreshed_titles[:2] == [second.title, first.title]


@pytest.mark.django_db
def test_offline_catalog_flush_invalidates_current_detail_cache(api_client):
    anime = create_anime(
        title="Offline Cache Target",
        slug="offline-cache-target",
        anilist_id=321,
        rating=None,
    )

    first_response = api_client.get(reverse("anime-detail", args=[anime.slug]))
    assert first_response.status_code == 200
    assert first_response.data["rating"] is None

    entry = OfflineCatalogEntry(
        raw={"title": anime.title},
        title=anime.title,
        base_slug=anime.slug,
        anime_type=anime.anime_type,
        status=anime.status,
        episode_count=anime.episode_count,
        duration_minutes=anime.duration_minutes,
        rating=8.5,
        season="SPRING",
        season_year=2026,
        release_date=date(2026, 4, 1),
        cover_url="https://cdn.example/anime/cover.webp",
        banner_url="https://cdn.example/anime/banner.webp",
        primary_studio=None,
        anilist_id=anime.anilist_id,
        mal_id=anime.mal_id,
        provider_ids={"anilist": anime.anilist_id},
        synonyms=[],
        producers=[],
        tags=[],
        source_urls=[],
    )

    OfflineCatalogImportService(batch_size=1)._flush_batch(
        [entry],
        last_update=date(2026, 4, 2),
        seen_at=timezone.now(),
    )

    refreshed_response = api_client.get(reverse("anime-detail", args=[anime.slug]))

    assert refreshed_response.status_code == 200
    assert str(refreshed_response.data["rating"]) == "8.5"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("basename", "factory_class", "updated_name"),
    [
        ("genre", create_genre, "Updated Browse Genre"),
        ("studio", create_studio, "Updated Browse Studio"),
    ],
)
def test_filter_option_cache_refreshes_after_model_update(
    api_client, basename, factory_class, updated_name
):
    obj = factory_class()

    first_response = api_client.get(reverse(f"{basename}-list"))
    assert first_response.status_code == 200
    assert obj.name in [item["name"] for item in first_response.data]

    obj.name = updated_name
    update_fields = ["name"]
    if basename == "genre":
        obj.slug = slugify(updated_name)
        update_fields.append("slug")
    obj.save(update_fields=update_fields)

    refreshed_response = api_client.get(reverse(f"{basename}-list"))
    refreshed_names = [item["name"] for item in refreshed_response.data]

    assert refreshed_response.status_code == 200
    assert updated_name in refreshed_names


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("frozen_date", "expected_current", "expected_next"),
    [
        ("2026-03-31 12:00:00", ("WINTER", 2026), ("SPRING", 2026)),
        ("2026-12-15 12:00:00", ("FALL", 2026), ("WINTER", 2027)),
    ],
)
def test_sync_task_season_windows_match_browse_logic(
    monkeypatch, frozen_date, expected_current, expected_next
):
    task = SyncAnimeCatalogTask()
    frozen_now = timezone.datetime.fromisoformat(frozen_date)

    class FrozenDateTime(timezone.datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is not None:
                return frozen_now.astimezone(tz)
            return frozen_now

    monkeypatch.setattr("apps.animes.tasks.sync.datetime", FrozenDateTime)

    assert task._get_season() == expected_current
    assert task._get_season(next_season=True) == expected_next
