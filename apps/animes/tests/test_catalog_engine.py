"""The catalog engine (``apps.animes.catalog``): scope, lanes, runner, persistence rules.

Lanes run end to end against ``AniListGraphQL`` (canned answers per GraphQL operation):
the client, its rate limiter and the ORM writes are real.
"""

from __future__ import annotations

import itertools
from datetime import date, timedelta

import httpx
import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.animes.catalog import lanes, scope
from apps.animes.catalog.hooks import bulk_catalog_write, in_bulk_catalog_write, request_hydrate
from apps.animes.catalog.lanes import season_window, shift_season
from apps.animes.catalog.runner import run_lane
from apps.animes.models import Anime, CatalogCursor, CatalogRun
from apps.animes.services.anilist import AniListService
from apps.animes.services.providers.anilist.persistence import OutOfCatalogScopeError
from apps.animes.tests.provider_testing import AniListGraphQL

pytestmark = pytest.mark.django_db

_ids = itertools.count(500_000)


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    """No sleeping on the rate limiter, no image downloads, a clean lane lock."""
    monkeypatch.setattr("time.sleep", lambda *_: None)
    queued = []
    monkeypatch.setattr(
        "apps.animes.tasks.images._queue_image_fetch", lambda **kwargs: queued.append(kwargs)
    )
    cache.clear()
    return queued


def media(anilist_id=None, **overrides):
    anilist_id = anilist_id or next(_ids)
    item = {
        "id": anilist_id,
        "idMal": anilist_id + 1,
        "type": "ANIME",
        "title": {"romaji": f"Title {anilist_id}", "english": None, "native": None},
        "format": "TV",
        "status": "FINISHED",
        "episodes": 12,
        "countryOfOrigin": "JP",
        "updatedAt": 1_790_000_000,
        "season": "FALL",
        "seasonYear": 2026,
        "popularity": 1000,
        "genres": ["Action"],
        "coverImage": {"large": "https://s4.anilist.co/file/cover.jpg"},
        "description": "A synopsis.",
    }
    item.update(overrides)
    return item


def page(items, has_next=False):
    return {"Page": {"pageInfo": {"hasNextPage": has_next}, "media": items}}


def make_anime(**fields) -> Anime:
    number = next(_ids)
    return Anime.objects.create(
        title=fields.pop("title", f"Stored {number}"),
        slug=fields.pop("slug", f"stored-{number}"),
        synopsis="synopsis",
        **fields,
    )


# ------------------------------------------------------------------ scope


def test_scope_rule_hides_other_countries_and_music_videos():
    assert scope.exclusion_reason("JP", "TV") == ""
    assert scope.exclusion_reason("CN", "ONA") == "country:CN"
    assert scope.exclusion_reason("KR", "TV") == "country:KR"
    assert scope.exclusion_reason("JP", "MUSIC") == "format:MUSIC"
    # Unknown facts never hide a row.
    assert scope.exclusion_reason("", "") == ""
    assert scope.media_exclusion_reason({"type": "MANGA", "countryOfOrigin": "JP"}) == "type:MANGA"


def test_rescope_hides_and_shows_rows_but_keeps_other_reasons():
    donghua = make_anime(country_of_origin="CN", anilist_format="ONA")
    music = make_anime(country_of_origin="JP", anilist_format="MUSIC")
    corrected = make_anime(
        country_of_origin="JP", anilist_format="TV", catalog_excluded="country:CN"
    )
    legacy = make_anime(country_of_origin="JP", catalog_excluded="legacy:quarantined")
    unknown = make_anime()

    assert scope.rescope_stored() == {"hidden": 2, "shown": 1}

    reasons = dict(Anime.objects.values_list("id", "catalog_excluded"))
    assert reasons[donghua.id] == "country:CN"
    assert reasons[music.id] == "format:MUSIC"
    assert reasons[corrected.id] == ""
    assert reasons[legacy.id] == "legacy:quarantined"
    assert reasons[unknown.id] == ""


def test_hidden_rows_leave_listings_but_stay_reachable():
    listed = make_anime()
    hidden = make_anime(catalog_excluded="country:CN")

    assert list(Anime.public_queryset().values_list("id", flat=True)) == [listed.id]
    assert set(Anime.reachable_queryset().values_list("id", flat=True)) == {listed.id, hidden.id}


def test_a_hidden_title_page_still_opens(client):
    hidden = make_anime(slug="link-click", catalog_excluded="country:CN")

    assert client.get(f"/api/v1/anime/{hidden.slug}/").status_code == 200
    listing = client.get("/api/v1/anime/").json()
    rows = listing.get("results", listing)
    assert hidden.slug not in {row["slug"] for row in rows}


# ------------------------------------------------------------------ persistence


def test_an_out_of_scope_title_is_never_created():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    with pytest.raises(OutOfCatalogScopeError) as raised:
        service.save_anime_to_db(media(countryOfOrigin="KR"))
    assert raised.value.reason == "country:KR"
    assert not Anime.objects.exists()


def test_a_stored_title_that_turns_out_of_scope_is_hidden_not_deleted():
    stored = make_anime(anilist_id=4242)
    service = AniListService(enable_caching=False, enable_rate_limiting=False)

    service.save_anime_to_db(media(4242, idMal=None, countryOfOrigin="CN", format="ONA"))

    stored.refresh_from_db()
    assert stored.catalog_excluded == "country:CN"
    assert stored.country_of_origin == "CN"
    assert stored.anilist_format == "ONA"


def test_lean_payloads_store_origin_and_edit_time_but_do_not_mirror_images(quiet):
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    service.mirror_images = False

    anime = service.save_anime_to_db(media(updatedAt=1_795_000_000))

    assert anime.country_of_origin == "JP"
    assert anime.anilist_format == "TV"
    assert anime.anilist_updated_at.timestamp() == 1_795_000_000
    assert anime.hydrated_at is None
    assert quiet == []  # served from AniList's CDN until someone needs details


def test_a_full_payload_marks_the_row_hydrated(quiet):
    service = AniListService(enable_caching=False, enable_rate_limiting=False)

    anime = service.save_anime_to_db(media(characterPreview={"edges": []}))

    anime.refresh_from_db()
    assert anime.hydrated_at is not None
    assert len(quiet) == 1


def test_bulk_writes_skip_per_row_follow_ups(settings, django_capture_on_commit_callbacks):
    settings.ANIME_METADATA_AUTO_ENRICH_ENABLED = True
    service = AniListService(enable_caching=False, enable_rate_limiting=False)

    with django_capture_on_commit_callbacks(execute=True):
        with bulk_catalog_write():
            assert in_bulk_catalog_write()
            bulk = service.save_anime_to_db(media())
        assert not in_bulk_catalog_write()
        single = make_anime()

    bulk.refresh_from_db()
    single.refresh_from_db()
    assert bulk.hydrate_requested_at is None
    assert single.hydrate_requested_at is not None  # one at a time: ask for details


def test_request_hydrate_skips_rows_already_hydrated_or_queued():
    fresh = make_anime()
    done = make_anime(hydrated_at=timezone.now())

    assert request_hydrate([fresh.id, done.id]) == 1
    assert request_hydrate([fresh.id]) == 0


# ------------------------------------------------------------------ seasons


def test_season_window_spans_last_to_the_one_after_next():
    assert season_window(date(2026, 11, 26)) == [
        ("SUMMER", 2026),
        ("FALL", 2026),
        ("WINTER", 2027),
        ("SPRING", 2027),
    ]
    assert shift_season("WINTER", 2027, -1) == ("FALL", 2026)


def test_seasons_lane_reads_every_page_of_every_season(monkeypatch):
    monkeypatch.setattr(lanes, "season_window", lambda today=None: [("WINTER", 2027)])
    first = [media(season="WINTER", seasonYear=2027) for _ in range(2)]
    second = [media(season="WINTER", seasonYear=2027)]

    def season(variables, _request):
        assert variables["countries"] == ["JP"]
        assert variables["excludedFormats"] == ["MUSIC"]
        return page(first, has_next=True) if variables["page"] == 1 else page(second)

    http = AniListGraphQL({"CatalogSeason": season}).install(monkeypatch)

    result = run_lane("seasons")

    assert result["status"] == CatalogRun.Status.SUCCEEDED
    assert result["created"] == 3
    assert [name for name, _ in http.operations()] == ["CatalogSeason", "CatalogSeason"]
    run = CatalogRun.objects.get()
    assert run.requests == 2
    assert run.detail["seasons"] == [{"season": "WINTER", "year": 2027, "anilist": 3}]
    assert Anime.public_queryset().filter(season="WINTER", season_year=2027).count() == 3


def test_a_failing_lane_is_recorded_and_keeps_what_it_saved(monkeypatch):
    monkeypatch.setattr(
        lanes, "season_window", lambda today=None: [("WINTER", 2027), ("SPRING", 2027)]
    )

    def season(variables, _request):
        if variables["season"] == "WINTER":
            return page([media()])
        return httpx.Response(500, json={"errors": [{"message": "Internal error"}]})

    AniListGraphQL({"CatalogSeason": season}).install(monkeypatch)

    result = run_lane("seasons")

    assert result["status"] == CatalogRun.Status.PARTIAL
    assert Anime.objects.count() == 1
    assert CatalogRun.objects.get().error


def test_a_lane_never_overlaps_itself(monkeypatch):
    cache.add("catalog:lane-lock:seasons", "now", 60)
    assert run_lane("seasons") == {
        "lane": "seasons",
        "status": "skipped",
        "reason": "already_running",
    }
    assert not CatalogRun.objects.exists()


# ------------------------------------------------------------------ delta


def test_delta_reads_back_to_its_cursor_and_moves_it(monkeypatch):
    since = 1_795_000_000
    CatalogCursor.objects.create(lane="delta", state={"since": since})
    newest = media(updatedAt=since + 500)
    in_overlap = media(updatedAt=since - 100)  # re-read: a page boundary may split a bulk edit
    old = media(updatedAt=since - lanes.DELTA_OVERLAP_SECONDS - 1)
    donghua = media(updatedAt=since + 400, countryOfOrigin="CN")
    http = AniListGraphQL(
        {"CatalogChanges": lambda v, r: page([newest, donghua, in_overlap, old], has_next=True)}
    ).install(monkeypatch)

    result = run_lane("delta")

    assert result["created"] == 2  # the donghua is not stored, the old one not reached
    assert len(http.operations()) == 1
    assert CatalogCursor.objects.get(lane="delta").state == {"since": since + 500}


def test_delta_overflow_asks_for_a_sweep(monkeypatch):
    since = int(timezone.now().timestamp())
    CatalogCursor.objects.create(lane="delta", state={"since": since})
    CatalogCursor.objects.create(lane="seed", state={"phase": "done"})
    monkeypatch.setattr(lanes.queries, "MAX_PAGES", 2)
    AniListGraphQL(
        {"CatalogChanges": lambda v, r: page([media(updatedAt=since + 10)], has_next=True)}
    ).install(monkeypatch)

    run_lane("delta")

    assert CatalogRun.objects.get().detail["overflow"] is True
    assert CatalogCursor.objects.get(lane="seed").state["phase"] == "backfill"


# ------------------------------------------------------------------ trending


def test_trending_ranks_the_saved_titles(monkeypatch):
    stale = make_anime(trending_rank=1)
    items = [media(popularity=100 - index) for index in range(lanes.MIN_TRENDING_RESULTS)]
    AniListGraphQL({"CatalogTrending": page(items)}).install(monkeypatch)

    run_lane("trending")

    ranked = list(
        Anime.objects.filter(trending_rank__isnull=False)
        .order_by("trending_rank")
        .values_list("anilist_id", flat=True)
    )
    assert ranked == [item["id"] for item in items]
    stale.refresh_from_db()
    assert stale.trending_rank is None


def test_trending_keeps_old_ranks_when_anilist_answers_too_little(monkeypatch):
    kept = make_anime(trending_rank=1)
    AniListGraphQL({"CatalogTrending": page([media()])}).install(monkeypatch)

    result = run_lane("trending")

    kept.refresh_from_db()
    assert kept.trending_rank == 1
    assert result["status"] == CatalogRun.Status.FAILED
    assert not Anime.objects.exclude(pk=kept.pk).exists()


# ------------------------------------------------------------------ hydrate


def test_hydrate_takes_requested_titles_first_and_stamps_them(monkeypatch, quiet):
    popular = make_anime(anilist_id=7001, member_count=10_000)
    asked = make_anime(anilist_id=7002, member_count=5, hydrate_requested_at=timezone.now())

    assert lanes.hydrate_candidates(1) == [asked.id]

    def full(variables, _request):
        return page(
            [media(i, idMal=None, characterPreview={"edges": []}) for i in variables["ids"]]
        )

    http = AniListGraphQL({"CatalogFullByIds": full}).install(monkeypatch)

    run_lane("hydrate")

    assert http.operations()[0][1]["ids"] == [7002, 7001]
    for row in (popular, asked):
        row.refresh_from_db()
        assert row.hydrated_at is not None
        assert row.hydrate_requested_at is None
    assert len(quiet) == 2  # hydrated rows get their own image copies


# ------------------------------------------------------------------ seed: the sweep


def test_sweep_backfills_origins_then_walks_years_newest_first(monkeypatch, settings):
    settings.CATALOG_FIRST_YEAR = timezone.now().year
    stored = make_anime(anilist_id=9001)
    years = []

    def by_ids(variables, _request):
        return page([media(9001, idMal=None, countryOfOrigin="CN")])

    def year(variables, _request):
        years.append(variables["after"] // 10000 + 1)
        return page([media()])

    AniListGraphQL(
        {
            "CatalogLeanByIds": by_ids,
            "CatalogSweepYear": year,
            "CatalogSweepUnreleased": page([media(status="NOT_YET_RELEASED", seasonYear=None)]),
        }
    ).install(monkeypatch)

    result = run_lane("seed")

    stored.refresh_from_db()
    assert stored.catalog_excluded == "country:CN"
    this_year = timezone.now().year
    assert years == [this_year + 1, this_year]
    assert result["created"] == 3
    state = CatalogCursor.objects.get(lane="seed").state
    assert state["phase"] == "done"
    assert lanes.seed_progress()["percent"] == 100


def test_sweep_stops_on_time_and_resumes_where_it_was(monkeypatch, settings):
    settings.CATALOG_FIRST_YEAR = timezone.now().year - 1
    CatalogCursor.objects.create(lane="seed", state={"phase": "years", "year": 2026, "page": 3})
    chained = []
    monkeypatch.setattr(
        "apps.animes.catalog.runner._continue", lambda lane, options: chained.append(lane)
    )
    monkeypatch.setattr(lanes.LaneContext, "out_of_time", lambda self: self.requests >= 1)
    seen = []

    def year(variables, _request):
        seen.append((variables["after"] // 10000 + 1, variables["page"]))
        return page([media()], has_next=True)

    AniListGraphQL({"CatalogSweepYear": year}).install(monkeypatch)

    result = run_lane("seed")

    assert seen == [(2026, 3)]
    assert result["status"] == CatalogRun.Status.PARTIAL
    assert chained == ["seed"]
    assert CatalogCursor.objects.get(lane="seed").state["page"] == 4


def test_restart_starts_a_finished_sweep_over(monkeypatch, settings):
    settings.CATALOG_FIRST_YEAR = timezone.now().year + 1
    CatalogCursor.objects.create(lane="seed", state={"phase": "done"})
    AniListGraphQL({"CatalogSweepYear": page([]), "CatalogSweepUnreleased": page([])}).install(
        monkeypatch
    )

    assert run_lane("seed")["reason"] == "sweep_done"  # nothing to do, nothing logged
    assert not CatalogRun.objects.exists()

    run_lane("seed", restart=True)
    assert CatalogRun.objects.get().detail["from"]["phase"] == "backfill"


def test_details_lane_logs_nothing_when_nothing_waits():
    make_anime(hydrated_at=timezone.now())
    assert run_lane("hydrate")["reason"] == "nothing_to_hydrate"
    assert not CatalogRun.objects.exists()


def test_seasons_runs_prune_the_run_log(monkeypatch):
    monkeypatch.setattr(lanes, "season_window", lambda today=None: [])
    old = CatalogRun.objects.create(lane="delta", status="succeeded")
    CatalogRun.objects.filter(pk=old.pk).update(started_at=timezone.now() - timedelta(days=31))

    run_lane("seasons")

    assert list(CatalogRun.objects.values_list("lane", flat=True)) == ["seasons"]


def test_overview_counts_and_season_coverage(monkeypatch):
    window = season_window()
    current_season, current_year = window[1]
    make_anime(season=current_season, season_year=current_year)
    make_anime(season=current_season, season_year=current_year, catalog_excluded="country:CN")
    CatalogRun.objects.create(
        lane="seasons",
        status=CatalogRun.Status.SUCCEEDED,
        finished_at=timezone.now() - timedelta(minutes=1),
        detail={"seasons": [{"season": current_season, "year": current_year, "anilist": 4}]},
    )
    from apps.animes.catalog.overview import catalog_overview

    overview = catalog_overview()

    assert overview["totals"]["listed"] == 1
    assert overview["totals"]["hidden"] == 1
    current = next(row for row in overview["seasons"] if row["role"] == "current")
    assert (current["listed"], current["anilist"]) == (1, 4)
    assert {lane["lane"] for lane in overview["lanes"]} == set(lanes.LANES)


def test_beat_entries_run_each_lane_on_its_queue(settings):
    from apps.animes.catalog.runner import LANE_QUEUES

    entries = [
        entry
        for entry in settings.CELERY_BEAT_SCHEDULE.values()
        if entry["task"] == "apps.animes.tasks.catalog.run_catalog_lane"
    ]
    assert {entry["kwargs"]["lane"] for entry in entries} == set(lanes.LANES)
    for entry in entries:
        assert entry["options"]["queue"] == LANE_QUEUES[entry["kwargs"]["lane"]]
