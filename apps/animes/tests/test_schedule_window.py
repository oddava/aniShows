"""The schedule ships only what airs in the coming week (B7, P0-6 backend).

``next_airing_date`` must fall within [now - 1 day, now + 8 days]; a show with
no date yet is placed by its broadcast day. Stale dates (last week's episode)
and shows on hiatus (next date weeks away) never ship. The cache key carries
the UTC date, so the window rolls over every day.
"""

from datetime import UTC, datetime, time, timedelta

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.animes.models import Anime
from apps.animes.services.public_anime_service import (
    AnimePublicPayloadService,
    AnimeQueryService,
)

URL = "/api/v1/anime/schedule/"
NOW = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)  # a Monday


@pytest.fixture(autouse=True)
def _frozen_schedule(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    monkeypatch.setattr(AnimeQueryService, "schedule_now", staticmethod(lambda: NOW))
    cache.clear()
    yield
    cache.clear()


def _airing(slug: str, *, next_airing_date=None, broadcast_day="Monday") -> Anime:
    return Anime.objects.create(
        title=slug.replace("-", " ").title(),
        slug=slug,
        synopsis="x",
        status=Anime.AnimeStatus.airing,
        broadcast_day=broadcast_day,
        broadcast_time=time(10, 0),
        broadcast_timezone="Asia/Tokyo",
        next_airing_date=next_airing_date,
        episode_count=12,
    )


def _slugs() -> set[str]:
    data = APIClient().get(URL).json()
    return {item["slug"] for items in data["days"].values() for item in items}


@pytest.mark.django_db
def test_only_the_coming_week_ships():
    _airing("aired-earlier-today", next_airing_date=NOW - timedelta(hours=3))
    _airing("airs-in-two-days", next_airing_date=NOW + timedelta(days=2))
    _airing("edge-one-day-ago", next_airing_date=NOW - timedelta(days=1))
    _airing("edge-eight-days-out", next_airing_date=NOW + timedelta(days=8))
    _airing("stale-last-week", next_airing_date=NOW - timedelta(days=1, minutes=1))
    _airing("hiatus-ten-days-out", next_airing_date=NOW + timedelta(days=10))
    _airing("hiatus-no-broadcast-day", next_airing_date=NOW + timedelta(days=30), broadcast_day="")

    assert _slugs() == {
        "aired-earlier-today",
        "airs-in-two-days",
        "edge-one-day-ago",
        "edge-eight-days-out",
    }


@pytest.mark.django_db
def test_a_show_without_a_date_ships_only_with_a_broadcast_day():
    _airing("time-tba", next_airing_date=None, broadcast_day="Friday")
    _airing("no-slot-at-all", next_airing_date=None, broadcast_day="")

    data = APIClient().get(URL).json()

    assert [item["slug"] for item in data["days"]["friday"]] == ["time-tba"]
    assert data["total"] == 1


@pytest.mark.django_db
def test_finished_shows_are_left_out_even_inside_the_window():
    show = _airing("just-finished", next_airing_date=NOW + timedelta(days=1))
    Anime.objects.filter(pk=show.pk).update(status=Anime.AnimeStatus.finished)

    assert _slugs() == set()


def test_the_cache_key_carries_the_utc_date():
    late_sunday_in_utc = datetime(2026, 11, 15, 23, 59, tzinfo=UTC)
    monday_in_utc = datetime(2026, 11, 16, 0, 1, tzinfo=UTC)

    sunday_key = AnimePublicPayloadService.schedule_cache_key("all", False, now=late_sunday_in_utc)
    monday_key = AnimePublicPayloadService.schedule_cache_key("all", False, now=monday_in_utc)

    assert sunday_key.endswith(":d:20261115")
    assert monday_key.endswith(":d:20261116")
    # Without ``now`` the key uses the schedule's clock (frozen here).
    assert AnimePublicPayloadService.schedule_cache_key("all", False) == monday_key


@pytest.mark.django_db
def test_a_new_day_builds_a_new_payload(monkeypatch):
    _airing("airs-tomorrow", next_airing_date=NOW + timedelta(days=1))
    client = APIClient()
    assert client.get(URL)["X-Cache-Status"] == "miss"
    assert client.get(URL)["X-Cache-Status"] == "hit"

    # Two days later the show aired a day and a bit ago: the next day's payload drops it.
    later = NOW + timedelta(days=2, hours=1)
    monkeypatch.setattr(AnimeQueryService, "schedule_now", staticmethod(lambda: later))
    response = client.get(URL)

    assert response["X-Cache-Status"] == "miss"
    assert response.json()["total"] == 0
