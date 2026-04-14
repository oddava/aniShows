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


@pytest.mark.django_db
def test_future_season_popular_browse_lists_all_titles_but_keeps_high_signal_ordering(
    api_client, monkeypatch
):
    class FrozenDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 4, 14)

    monkeypatch.setattr("apps.animes.services.public_anime_service.date", FrozenDate)

    keep_ranked = create_anime(
        title="Strong Summer Favorite",
        slug="strong-summer-favorite",
        status=Anime.AnimeStatus.upcoming,
        season="SUMMER",
        season_year=2026,
        member_count=0,
        popularity_rank=1_200,
        site_rank=900,
        rating=None,
    )
    keep_demand = create_anime(
        title="High Demand Summer Show",
        slug="high-demand-summer-show",
        status=Anime.AnimeStatus.upcoming,
        season="SUMMER",
        season_year=2026,
        member_count=125_000,
        popularity_rank=None,
        site_rank=None,
        rating=None,
    )
    create_anime(
        title="Crayon Placeholder",
        slug="crayon-placeholder",
        status=Anime.AnimeStatus.upcoming,
        season="SUMMER",
        season_year=2026,
        member_count=0,
        popularity_rank=19_408,
        site_rank=None,
        rating=None,
    )
    create_anime(
        title="Planosaurus Placeholder",
        slug="planosaurus-placeholder",
        status=Anime.AnimeStatus.upcoming,
        season="SUMMER",
        season_year=2026,
        member_count=0,
        popularity_rank=28_800,
        site_rank=None,
        rating=None,
    )

    response = api_client.get(
        reverse("anime-list"),
        {"season": "summer", "year": "2026", "sort": "popular"},
    )

    assert response.status_code == 200
    titles = [anime["title"] for anime in response.data["results"]]
    assert titles[:2] == [keep_ranked.title, keep_demand.title]
    assert keep_ranked.title in titles
    assert keep_demand.title in titles
    assert "Crayon Placeholder" in titles
    assert "Planosaurus Placeholder" in titles


@pytest.mark.django_db
def test_future_season_browse_rows_still_exclude_low_signal_titles(api_client, monkeypatch):
    class FrozenDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 4, 14)

    monkeypatch.setattr("apps.animes.services.public_anime_service.date", FrozenDate)

    keep_ranked = create_anime(
        title="Row Strong Summer Favorite",
        slug="row-strong-summer-favorite",
        status=Anime.AnimeStatus.upcoming,
        season="SUMMER",
        season_year=2026,
        member_count=0,
        popularity_rank=1_200,
        site_rank=900,
        rating=None,
    )
    keep_demand = create_anime(
        title="Row High Demand Summer Show",
        slug="row-high-demand-summer-show",
        status=Anime.AnimeStatus.upcoming,
        season="SUMMER",
        season_year=2026,
        member_count=125_000,
        popularity_rank=None,
        site_rank=None,
        rating=None,
    )
    create_anime(
        title="Row Crayon Placeholder",
        slug="row-crayon-placeholder",
        status=Anime.AnimeStatus.upcoming,
        season="SUMMER",
        season_year=2026,
        member_count=0,
        popularity_rank=19_408,
        site_rank=None,
        rating=None,
    )

    response = api_client.get(reverse("anime-browse-rows"))

    assert response.status_code == 200
    row_map = {row["key"]: row for row in response.data}
    upcoming_titles = [anime["title"] for anime in row_map["upcoming"]["anime_list"]]
    assert keep_ranked.title in upcoming_titles
    assert keep_demand.title in upcoming_titles
    assert "Row Crayon Placeholder" not in upcoming_titles


@pytest.mark.django_db
def test_browse_rows_server_side_deduplicate_later_shelves(api_client):
    trending_titles = []
    for index in range(12):
        anime = create_anime(
            title=f"Trending Shelf {index + 1}",
            slug=f"trending-shelf-{index + 1}",
            status=Anime.AnimeStatus.airing,
            season="SPRING",
            season_year=2026,
            trending_rank=index + 1,
            popularity_rank=index + 1,
            member_count=900_000 - index,
            rating=9.0 - (index * 0.1),
        )
        trending_titles.append(anime.title)

    all_time_titles = []
    for index in range(6):
        anime = create_anime(
            title=f"All Time Shelf {index + 1}",
            slug=f"all-time-shelf-{index + 1}",
            status=Anime.AnimeStatus.finished,
            popularity_rank=100 + index,
            member_count=700_000 - index,
            rating=8.5 - (index * 0.1),
        )
        all_time_titles.append(anime.title)

    response = api_client.get(reverse("anime-browse-rows"))

    assert response.status_code == 200
    row_map = {row["key"]: row for row in response.data}
    trending_row_titles = [anime["title"] for anime in row_map["trending"]["anime_list"]]
    all_time_row_titles = [anime["title"] for anime in row_map["all-time"]["anime_list"]]

    assert trending_row_titles == trending_titles
    assert all_time_row_titles == all_time_titles
    assert set(trending_row_titles).isdisjoint(all_time_row_titles)


@pytest.mark.django_db
def test_trending_shelf_uses_cover_art_when_banner_is_missing(api_client):
    anime = create_anime(
        title="Hero Cover Fallback",
        slug="hero-cover-fallback",
        synopsis="Hero should still render artwork.",
        trending_rank=1,
        cover_image_external_url="https://cdn.example.com/hero-cover.webp",
        banner_image_external_url="",
    )

    response = api_client.get(reverse("anime-trending"))

    assert response.status_code == 200
    payload = next(item for item in response.data if item["id"] == anime.id)

    assert payload["banner_image"] == anime.cover_image_external_url
    assert payload["banner_image_large"] == anime.cover_image_external_url
