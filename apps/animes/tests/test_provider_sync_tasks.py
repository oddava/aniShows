"""The Celery-side provider paths, run end to end on the sync stack.

Each test runs a real task (``Task.apply`` or the task body under a worker-like
request) against recorded AniList payloads served by ``httpx.MockTransport``.
Nothing below the task is mocked: the service, its retries, rate limiter,
circuit breaker and the ORM writes all run. ``time.sleep`` is recorded instead
of slept, so the rate limiter's waits are visible without slowing the suite.
"""

from __future__ import annotations

import copy

import pytest
from celery._state import _task_stack
from celery.exceptions import Retry

from apps.animes.models import Anime, AnimeCharacter, CatalogRun, ThemeSong
from apps.animes.services.anilist import AniListService
from apps.animes.tasks import (
    enrich_metadata,
    run_catalog_lane,
    sync_airing_workflow,
    sync_franchises,
)
from apps.animes.tests.provider_testing import AniListGraphQL, load_fixture

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def quiet_side_effects(monkeypatch):
    """Keep follow-up tasks (signals, image queueing) from running inline."""
    monkeypatch.setattr("apps.animes.signals.request_hydrate", lambda *a, **k: None)
    monkeypatch.setattr("apps.animes.tasks.images._queue_image_fetch", lambda **kwargs: None)


@pytest.fixture
def sleeps(monkeypatch):
    recorded: list[float] = []
    monkeypatch.setattr("time.sleep", recorded.append)
    return recorded


def frieren():
    return load_fixture("anilist/media_154587.json")["Media"]


def sequel():
    media = copy.deepcopy(frieren())
    media.update(
        id=182255,
        idMal=59978,
        title={
            "romaji": "Sousou no Frieren 2nd Season",
            "english": "Frieren: Beyond Journey's End Season 2",
            "native": "葬送のフリーレン 第2期",
        },
        relations={"edges": []},
        characterPreview={"edges": []},
        staffPreview={"edges": []},
    )
    return media


def media_by_id(variables, request):
    by_id = {154587: frieren(), 182255: sequel()}
    return {"Media": by_id.get(variables.get("id"))}


@pytest.fixture
def anilist_http(monkeypatch):
    return AniListGraphQL(
        {
            "GetAnime": "anilist/page_trending.json",
            "CatalogTrending": "anilist/page_trending.json",
            "GetAnimeById": media_by_id,
            "SearchByMalId": {"Media": frieren()},
        }
    ).install(monkeypatch)


def make_anime(**fields):
    defaults = {
        "synopsis": "stored synopsis",
        "anime_type": Anime.AnimeType.tv,
        "status": Anime.AnimeStatus.finished,
    }
    defaults.update(fields)
    defaults.setdefault("slug", fields["title"].lower().replace(" ", "-"))
    return Anime.objects.create(**defaults)


def test_trending_lane_task_keeps_old_ranks_on_a_too_small_result(anilist_http, sleeps):
    """The Celery task runs the lane; the lanes themselves are in ``test_catalog_engine``.

    Three rows are below the trending minimum, so nothing changes.
    """
    result = run_catalog_lane.apply(kwargs={"lane": "trending"}).get()

    assert result["status"] == CatalogRun.Status.FAILED
    assert not Anime.objects.exists()
    run = CatalogRun.objects.get()
    assert run.lane == "trending"
    assert run.detail["kept_old_ranks"] is True
    assert [name for name, _ in anilist_http.operations()] == ["CatalogTrending"]


def test_enrich_metadata_hydrates_the_row(anilist_http, sleeps):
    anime = make_anime(title="Frieren", anilist_id=154587, synopsis="")

    result = enrich_metadata.apply(kwargs={"anime_id": anime.id}).get()

    anime.refresh_from_db()
    assert result == {
        "mode": "single",
        "anime_id": anime.id,
        "status": "success",
        "title": "Frieren: Beyond Journey\u2019s End",
    }
    assert anime.mal_id == 52991
    assert anime.synopsis
    assert anime.genres.filter(name="Adventure").exists()
    assert AnimeCharacter.objects.filter(anime=anime).count() == 3
    assert not ThemeSong.objects.filter(anime=anime).exists()
    assert anilist_http.operations() == [("GetAnimeById", {"id": 154587})]


def test_enrich_metadata_by_mal_id(anilist_http, sleeps):
    anime = make_anime(title="Frieren", mal_id=52991)

    result = enrich_metadata.apply(kwargs={"anime_id": anime.id}).get()

    assert result["status"] == "success"
    anime.refresh_from_db()
    assert anime.anilist_id == 154587
    assert anilist_http.operations() == [("SearchByMalId", {"idMal": 52991})]


def test_airing_workflow_refreshes_every_show_in_one_batch(monkeypatch, sleeps):
    def airing_page(variables, request):
        return {
            "Page": {
                "media": [
                    {
                        "id": anilist_id,
                        "idMal": anilist_id,
                        "title": {"romaji": f"Show {anilist_id}"},
                        "status": "RELEASING",
                        "nextAiringEpisode": {"episode": 12, "airingAt": 1798985760},
                    }
                    for anilist_id in variables["ids"]
                ]
            }
        }

    http = AniListGraphQL({"GetAiringByIds": airing_page}).install(monkeypatch)
    shows = [
        make_anime(title=f"Show {i}", anilist_id=i, status=Anime.AnimeStatus.airing)
        for i in (21, 22, 23)
    ]

    result = sync_airing_workflow.apply(kwargs={"phases": ["sync"]}).get()

    assert result["status"] == "success"
    assert result["sync_summary"]["updated"] == 3
    assert [name for name, _ in http.operations()] == ["GetAiringByIds"]
    for show in shows:
        show.refresh_from_db()
        assert show.next_airing_episode == 12
        assert (show.broadcast_day, show.broadcast_timezone) == ("Sunday", "Asia/Tokyo")


def test_airing_cleanup_marks_finished_shows(monkeypatch, sleeps):
    from datetime import timedelta

    from django.utils import timezone

    AniListGraphQL(
        {
            "GetAiringByIds": {
                "Page": {"media": [{"id": 30, "status": "FINISHED", "nextAiringEpisode": None}]}
            }
        }
    ).install(monkeypatch)
    anime = make_anime(
        title="Ended",
        anilist_id=30,
        status=Anime.AnimeStatus.airing,
        next_airing_episode=12,
        next_airing_date=timezone.now() - timedelta(days=1),
    )

    sync_airing_workflow.apply(kwargs={"phases": ["cleanup"]}).get()

    anime.refresh_from_db()
    assert anime.status == Anime.AnimeStatus.finished
    assert (anime.next_airing_episode, anime.next_airing_date) == (None, None)


def test_franchise_sync_links_relations_and_imports_missing_anime(anilist_http, sleeps):
    anime = make_anime(title="Frieren", anilist_id=154587)

    result = sync_franchises.apply(kwargs={"anime_id": anime.id, "max_imports": 5}).get()

    assert result["status"] == "success"
    assert result["imported_count"] == 1
    imported = Anime.objects.get(anilist_id=182255)
    assert imported.mal_id == 59978
    assert anime.relations.filter(target_anilist_id=182255, to_anime=imported).exists()
    # Only the anime relation: the manga source edge is not imported.
    assert [variables["id"] for name, variables in anilist_http.operations()] == [154587, 182255]


def test_franchise_sync_needs_an_id(anilist_http, sleeps):
    anime = make_anime(title="No IDs")

    result = sync_franchises.apply(
        kwargs={"mode": "backfill", "anime_ids": [anime.id], "batch_size": 5}
    ).get()

    assert (result["updated"], result["errors"]) == (0, 1)
    assert anilist_http.requests == []


def test_provider_errors_schedule_a_retry_with_the_worker_request(
    anilist_http, sleeps, monkeypatch
):
    """The task body sees the worker's request, so self.retry() schedules a retry."""
    anime = make_anime(title="Frieren", anilist_id=154587)
    seen = {}

    def failing_refresh(service, row, media):
        seen["task_id"] = enrich_metadata.request.id
        raise RuntimeError("provider down")

    monkeypatch.setattr(AniListService, "refresh_anime_metadata", failing_refresh)
    sent = []
    monkeypatch.setattr(
        "celery.canvas.Signature.apply_async", lambda sig, *a, **k: sent.append(sig)
    )

    _task_stack.push(enrich_metadata)
    enrich_metadata.push_request(id="task-1", called_directly=False, retries=0)
    try:
        with pytest.raises(Retry):
            enrich_metadata.run(anime_id=anime.id)
    finally:
        enrich_metadata.pop_request()
        _task_stack.pop()

    assert seen["task_id"] == "task-1"
    assert len(sent) == 1
