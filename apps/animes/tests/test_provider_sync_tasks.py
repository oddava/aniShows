"""The Celery-side provider paths, run end to end on the sync stack.

Each test runs a real task (``Task.apply`` or the task body under a worker-like
request) against recorded Jikan payloads served by ``httpx.MockTransport``.
Nothing below the task is mocked: the service, its retries, rate limiter,
circuit breaker, the concurrent detail fetch and the ORM writes all run.
``time.sleep`` is recorded instead of slept, so the rate limiter's waits are
visible without slowing the suite.
"""

from __future__ import annotations

import copy

import pytest
from celery._state import _task_stack
from celery.exceptions import Retry

from apps.animes.models import Anime, AnimeCharacter, ThemeSong
from apps.animes.services.jikan import JikanService, get_jikan_base_url
from apps.animes.tasks import (
    enrich_metadata,
    sync_airing_workflow,
    sync_anime_catalog,
    sync_franchises,
    sync_theme_songs,
)
from apps.animes.tests.provider_testing import JIKAN_ROUTES, ProviderHTTP, load_fixture

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def quiet_side_effects(monkeypatch):
    """Keep follow-up tasks (signals, image queueing) from running inline."""
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    monkeypatch.setattr("apps.animes.tasks.images._queue_image_fetch", lambda **kwargs: None)


@pytest.fixture
def sleeps(monkeypatch):
    recorded: list[float] = []
    monkeypatch.setattr("time.sleep", recorded.append)
    return recorded


@pytest.fixture
def jikan_http(monkeypatch):
    return ProviderHTTP(dict(JIKAN_ROUTES), base_url=get_jikan_base_url()).install(monkeypatch)


def make_anime(**fields):
    defaults = {
        "synopsis": "stored synopsis",
        "anime_type": Anime.AnimeType.tv,
        "status": Anime.AnimeStatus.finished,
    }
    defaults.update(fields)
    defaults.setdefault("slug", fields["title"].lower().replace(" ", "-"))
    return Anime.objects.create(**defaults)


def test_trending_sync_saves_the_season_and_ranks_it(jikan_http, sleeps):
    result = sync_anime_catalog.apply(kwargs={"sync_type": "trending", "limit": 4}).get()

    assert result["status"] == "success"
    assert result["fetched"] == 4
    assert result["matched"] == 4
    assert Anime.objects.count() == 4
    assert Anime.objects.filter(trending_rank__isnull=False).count() == 4
    # The current season (page 1 repeats a MAL ID, as Jikan can), then the
    # top-airing fallback for the row still missing.
    assert jikan_http.calls() == [
        "GET /seasons/now?limit=2&page=2",
        "GET /seasons/now?limit=4&page=1",
        "GET /top/anime?filter=airing&limit=1&page=1",
    ]
    # Rate limited: the requests after the first were spaced out.
    assert sum(1 for wait in sleeps if wait > 0.5) >= 2


def test_enrich_metadata_hydrates_the_row_from_the_detail_endpoints(jikan_http, sleeps):
    anime = make_anime(title="Frieren", mal_id=52991, synopsis="")

    result = enrich_metadata.apply(kwargs={"anime_id": anime.id}).get()

    anime.refresh_from_db()
    assert result == {
        "mode": "single",
        "anime_id": anime.id,
        "status": "success",
        "title": "Frieren: Beyond Journey's End",
    }
    assert anime.title == "Frieren: Beyond Journey's End"
    assert anime.synopsis.startswith("During their decade-long quest")
    assert anime.genres.filter(name="Adventure").exists()
    assert AnimeCharacter.objects.filter(anime=anime).exists()
    assert ThemeSong.objects.filter(anime=anime).count() >= 2
    # The concurrent detail fetch asked for every part of the payload.
    assert {
        "GET /anime/52991/full",
        "GET /anime/52991/characters",
        "GET /anime/52991/staff",
        "GET /anime/52991/themes",
        "GET /anime/52991/statistics",
        "GET /anime/52991",
    } <= set(jikan_http.calls())


def test_airing_workflow_refreshes_the_schedule(jikan_http, sleeps):
    anime = make_anime(title="One Piece", mal_id=21, status=Anime.AnimeStatus.airing)

    result = sync_airing_workflow.apply(kwargs={"phases": ["sync"]}).get()

    assert result["status"] == "success"
    assert result["sync_summary"]["updated"] == 1
    anime.refresh_from_db()
    assert anime.broadcast_day == "Sunday"
    # One past the newest episode on the last episodes page.
    assert anime.next_airing_episode == 1124
    assert anime.next_airing_date is not None
    # The lightweight airing payload: no characters, staff or themes calls.
    assert "GET /anime/21/characters" not in jikan_http.calls()


def test_franchise_sync_links_relations_and_imports_missing_anime(jikan_http, sleeps):
    sequel = copy.deepcopy(load_fixture("jikan/anime_52991_full.json"))
    sequel["data"].update(
        mal_id=59978,
        title="Sousou no Frieren 2nd Season",
        title_english="Frieren: Beyond Journey's End Season 2",
        relations=[],
    )
    jikan_http.routes["/anime/59978/full"] = sequel
    anime = make_anime(title="Frieren", mal_id=52991)

    result = sync_franchises.apply(kwargs={"anime_id": anime.id, "max_imports": 5}).get()

    assert result["status"] == "success"
    assert result["imported_count"] == 1
    imported = Anime.objects.get(mal_id=59978)
    assert anime.relations.filter(target_mal_id=59978, to_anime=imported).exists()


def test_theme_sync_saves_openings_and_endings(jikan_http, sleeps):
    anime = make_anime(title="Frieren", mal_id=52991)

    result = sync_theme_songs.apply(kwargs={"anime_id": anime.id}).get()

    assert result["status"] == "success"
    assert set(ThemeSong.objects.filter(anime=anime).values_list("song_type", flat=True)) == {
        "opening",
        "ending",
    }
    assert jikan_http.calls() == ["GET /anime/52991/themes"]


def test_provider_errors_schedule_a_retry_with_the_worker_request(jikan_http, sleeps, monkeypatch):
    """The task body sees the worker's request, so self.retry() schedules a retry.

    The async bridge used to need to carry Celery's thread-local task stack
    onto its loop thread for this; the sync path runs on the worker thread.
    """
    anime = make_anime(title="Frieren", mal_id=52991)
    seen = {}

    def failing_refresh(service, row, media):
        seen["task_id"] = enrich_metadata.request.id
        raise RuntimeError("provider down")

    monkeypatch.setattr(JikanService, "refresh_anime_metadata", failing_refresh)
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
