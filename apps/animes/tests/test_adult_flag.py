"""``Anime.is_adult`` is AniList's ``Media.isAdult``, and nothing else (owner decision).

Genres and tags no longer decide it: the old genre/tag rule hid mainstream shows
such as *The Apothecary Diaries* (thematic tags like "prostitution"). The flag
comes from AniList payloads, the weekly sync, and (only until AniList reports)
the offline catalog's ``hentai`` tag on a newly created row.
"""

import importlib

import pytest
from django.apps import apps as django_apps
from django.db import connection

from apps.animes import adult_content
from apps.animes.adult_content import (
    anilist_is_adult,
    apply_anilist_adult_flags,
    sync_adult_flags_from_anilist,
)
from apps.animes.models import Anime, Genre
from apps.animes.services.anilist import AniListService
from apps.animes.services.public_anime_service import AnimeQueryService
from apps.animes.tests.provider_testing import resolve

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.request_hydrate", lambda *a, **k: None)


def flagged_ids() -> set[int]:
    return set(Anime.objects.filter(is_adult=True).values_list("pk", flat=True))


_counter = iter(range(1, 10_000))


def make_anime(**fields) -> Anime:
    number = next(_counter)
    return Anime.objects.create(
        title=fields.pop("title", f"Flag Anime {number}"),
        slug=fields.pop("slug", f"flag-anime-{number}"),
        synopsis="synopsis",
        **fields,
    )


@pytest.fixture
def genres():
    return {
        slug: Genre.objects.get_or_create(slug=slug, defaults={"name": slug.title()})[0]
        for slug in ("hentai", "erotica", "drama")
    }


# ------------------------------------------------- genres and tags do nothing


def test_thematic_tags_and_adult_genres_no_longer_flag_a_row(genres):
    # The Apothecary Diaries carries tags the old rule treated as adult.
    apothecary = make_anime(title="The Apothecary Diaries", tags=["prostitution", "succubus"])
    tagged = make_anime(tags=["nsfw", "sex"])
    tagged.genres.add(genres["hentai"], genres["erotica"])
    tagged.save()

    assert flagged_ids() == set()
    apothecary.refresh_from_db()
    assert apothecary.is_adult is False


def test_removing_genres_or_tags_never_clears_anilists_flag(genres):
    anime = make_anime(is_adult=True, tags=["nsfw"])
    anime.genres.add(genres["hentai"])
    anime.genres.clear()
    anime.tags = []
    anime.save()
    genres["hentai"].delete()

    assert flagged_ids() == {anime.pk}


# ------------------------------------------------------- AniList payloads


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"isAdult": True}, True),
        ({"isAdult": False}, False),
        ({}, None),
        ({"isAdult": None}, None),
        ({"isAdult": "true"}, None),
        (None, None),
    ],
)
def test_anilist_is_adult_reads_only_a_real_boolean(payload, expected):
    assert anilist_is_adult(payload) is expected


def test_provider_payload_carries_anilists_flag_both_ways():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    try:
        adult = service._prepare_anime_data({"isAdult": True, "genres": []}, "A", "", "a")
        general = service._prepare_anime_data(
            {"isAdult": False, "genres": ["Hentai"], "tags": [{"name": "NSFW"}]}, "B", "", "b"
        )
        missing = service._prepare_anime_data({"genres": ["Hentai"]}, "C", "", "c")
    finally:
        resolve(service.close())
    assert adult["is_adult"] is True
    assert general["is_adult"] is False
    # No isAdult: the key is left out, so an update keeps the stored flag.
    assert "is_adult" not in missing


def test_provider_create_and_update_paths():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    item = {
        "id": 777001,
        "title": {"english": "Provider Show"},
        "genres": ["Drama"],
        "tags": [{"name": "Prostitution"}],
        "format": "TV",
        "status": "FINISHED",
        "isAdult": False,
    }
    try:
        anime = service.save_anime_to_db(item)
        assert flagged_ids() == set()

        service.save_anime_to_db({**item, "isAdult": True})
        assert flagged_ids() == {anime.pk}

        # A payload without the field (an older query) leaves it alone.
        payload = {key: value for key, value in item.items() if key != "isAdult"}
        service.save_anime_to_db(payload)
        assert flagged_ids() == {anime.pk}

        service.save_anime_to_db(item)
        assert flagged_ids() == set()
    finally:
        resolve(service.close())


def test_the_queries_ask_anilist_for_the_flag():
    from apps.animes.services.providers.anilist.client import AIRING_FIELDS, MEDIA_FIELDS

    assert "isAdult" in MEDIA_FIELDS.split()
    assert "isAdult" in AIRING_FIELDS.split()


# ------------------------------------------------------- sync from AniList


def test_apply_flags_by_anilist_then_mal_id(django_capture_on_commit_callbacks, monkeypatch):
    by_anilist = make_anime(anilist_id=5001)
    by_mal = make_anime(mal_id=6001)  # no AniList ID locally
    cleared = make_anime(anilist_id=5002, is_adult=True)
    untouched = make_anime(anilist_id=5003, is_adult=True)
    invalidated = []
    monkeypatch.setattr(
        adult_content, "_invalidate_public_caches", lambda slugs, using: invalidated.extend(slugs)
    )

    result = apply_anilist_adult_flags(
        [
            {"id": 5001, "isAdult": True},
            # AniList always returns both IDs (a MAL-ID query included).
            {"id": 9001, "idMal": 6001, "isAdult": True},
            {"id": 5002, "isAdult": False},
            {"id": 5003},  # no flag: skipped, never cleared
            {"id": 9999, "isAdult": True},  # not in the catalog
        ]
    )

    assert result == {"flagged": 2, "cleared": 1}
    assert flagged_ids() == {by_anilist.pk, by_mal.pk, untouched.pk}
    assert sorted(invalidated) == sorted([by_anilist.slug, by_mal.slug, cleared.slug])


def test_changed_rows_drop_their_cached_public_payloads(django_capture_on_commit_callbacks):
    from unittest import mock

    anime = make_anime(anilist_id=5101)
    with (
        mock.patch(
            "apps.animes.services.public_anime_service."
            "AnimePublicPayloadService.bump_collection_cache_namespace"
        ) as bump,
        mock.patch("apps.animes.services.public_anime_service.invalidate_anime_detail") as drop,
        django_capture_on_commit_callbacks(execute=True),
    ):
        apply_anilist_adult_flags([{"id": 5101, "isAdult": True}])

    bump.assert_called_once()
    drop.assert_called_once_with(anime.slug)


def test_an_invalidation_lost_to_an_outage_is_replayed_once_redis_is_back(
    django_capture_on_commit_callbacks,
):
    """Council r1: the cached copies persist across the outage, and re-running the
    sync changes no row, so the failed drop is kept and replayed.
    """
    from unittest import mock

    from redis.exceptions import ConnectionError as RedisConnectionError

    from apps.animes.models import PendingPublicCacheInvalidation
    from apps.animes.tasks.adult_content import replay_public_cache_invalidations

    anime = make_anime(anilist_id=5102)
    bump_path = (
        "apps.animes.services.public_anime_service."
        "AnimePublicPayloadService.bump_collection_cache_namespace"
    )
    with (
        mock.patch(bump_path, side_effect=RedisConnectionError("down")),
        django_capture_on_commit_callbacks(execute=True),
    ):
        apply_anilist_adult_flags([{"id": 5102, "isAdult": True}])
        apply_anilist_adult_flags([{"id": 5102, "isAdult": True}])  # no change: nothing new

    assert list(PendingPublicCacheInvalidation.objects.values_list("slug", flat=True)) == [
        anime.slug
    ]

    # Still down: the replay raises and keeps the row for the next run.
    with (
        mock.patch(bump_path, side_effect=RedisConnectionError("down")),
        pytest.raises(RedisConnectionError),
    ):
        adult_content.replay_public_cache_invalidations()
    assert PendingPublicCacheInvalidation.objects.count() == 1

    with (
        mock.patch(bump_path) as bump,
        mock.patch("apps.animes.services.public_anime_service.invalidate_anime_detail") as drop,
    ):
        assert replay_public_cache_invalidations.apply().get() == 1
        assert adult_content.replay_public_cache_invalidations() == 0

    bump.assert_called_once()
    drop.assert_called_once_with(anime.slug)
    assert not PendingPublicCacheInvalidation.objects.exists()


class _FakeAniList:
    def __init__(self, payloads, fail_ids=()):
        self.payloads = payloads
        self.fail_ids = set(fail_ids)
        self.calls = []

    def __call__(self, *args, **kwargs):
        return self

    def get_airing_by_ids(self, *, anilist_ids=(), mal_ids=()):
        self.calls.append((list(anilist_ids), list(mal_ids)))
        if self.fail_ids & set(anilist_ids):
            return []  # a failed request: no payloads
        wanted = set(anilist_ids)
        wanted_mal = set(mal_ids)
        return [
            payload
            for payload in self.payloads
            if payload.get("id") in wanted or payload.get("idMal") in wanted_mal
        ]


def test_sync_reads_the_flag_for_the_whole_catalog_in_chunks(monkeypatch):
    rows = [make_anime(anilist_id=7000 + n) for n in range(5)]
    mal_only = make_anime(mal_id=8001)
    no_ids = make_anime(is_adult=True)
    fake = _FakeAniList(
        [{"id": 7001, "isAdult": True}, {"id": 7003, "isAdult": True}]
        + [{"id": 7000 + n, "isAdult": False} for n in (0, 2, 4)]
        + [{"id": 98001, "idMal": 8001, "isAdult": True}]
    )
    monkeypatch.setattr("apps.animes.services.anilist.AniListService", fake)

    totals = sync_adult_flags_from_anilist(chunk_size=2)

    assert totals == {
        "checked": 6,
        "payloads": 6,
        "flagged": 3,
        "cleared": 0,
        "last_pk": mal_only.pk,
    }
    assert flagged_ids() == {rows[1].pk, rows[3].pk, mal_only.pk, no_ids.pk}
    assert len(fake.calls) == 3  # 6 rows with IDs, 2 per chunk


def test_a_failed_chunk_never_makes_a_row_visible(monkeypatch):
    adult = make_anime(anilist_id=7101, is_adult=True)
    fake = _FakeAniList([{"id": 7101, "isAdult": False}], fail_ids={7101})
    monkeypatch.setattr("apps.animes.services.anilist.AniListService", fake)

    totals = sync_adult_flags_from_anilist()

    assert totals["cleared"] == 0
    assert flagged_ids() == {adult.pk}


def test_management_command_and_task_run_the_sync(monkeypatch):
    from django.core.management import call_command

    from apps.animes.tasks.adult_content import sync_adult_flags

    calls = []

    def fake_sync(**kwargs):
        calls.append(kwargs)
        return {"checked": 0, "payloads": 0, "flagged": 0, "cleared": 0, "last_pk": 0}

    monkeypatch.setattr(adult_content, "sync_adult_flags_from_anilist", fake_sync)
    monkeypatch.setattr(
        "apps.animes.management.commands.sync_adult_flags.sync_adult_flags_from_anilist",
        adult_content.sync_adult_flags_from_anilist,
    )

    call_command("sync_adult_flags", "--limit", "3")
    sync_adult_flags.apply()

    assert calls == [{"limit": 3}, {"after_pk": 0, "limit": 500}]

    # --enqueue (what deploy-prod.sh runs) queues the task instead.
    from unittest import mock

    with mock.patch.object(sync_adult_flags, "apply_async") as apply_async:
        call_command("sync_adult_flags", "--enqueue")
    apply_async.assert_called_once_with(queue="low_priority")


# ------------------------------------------------------- migration and reads


def test_migration_seeds_from_anilist_markers_and_keeps_unverified_rows(genres):
    hentai_genre, erotica_only = make_anime(), make_anime()
    thematic = make_anime(tags=["prostitution", "succubus"])  # e.g. The Apothecary Diaries
    offline_tagged = make_anime(tags=["drama", "Hentai"])  # offline row, no AniList data
    offline_legacy = make_anime(tags=["nsfw"])  # hidden by the old rule, no genres yet
    plain = make_anime(is_adult=True)  # no genres: not verified, stays hidden
    for anime in (hentai_genre,):
        anime.genres.add(genres["hentai"])
    erotica_only.genres.add(genres["erotica"])
    thematic.genres.add(genres["drama"])
    Anime.objects.filter(pk__in=[erotica_only.pk, thematic.pk, offline_legacy.pk]).update(
        is_adult=True
    )

    migration = importlib.import_module("apps.animes.migrations.0060_adult_flag_from_anilist")
    with connection.schema_editor() as schema_editor:
        migration.seed_from_anilist_genre(django_apps, schema_editor)
    # AniList data and no marker: cleared. No AniList data: nothing is unhidden.
    assert flagged_ids() == {
        hentai_genre.pk,
        erotica_only.pk,  # MAL's adult genre: hidden until AniList answers
        offline_tagged.pk,
        offline_legacy.pk,
        plain.pk,
    }

    # Reversing restores 0054's genre/tag rule.
    with connection.schema_editor() as schema_editor:
        migration.restore_legacy_rule(django_apps, schema_editor)
    assert {hentai_genre.pk, erotica_only.pk, thematic.pk, offline_legacy.pk} <= flagged_ids()


def test_public_list_hides_exactly_the_flagged_rows(client):
    visible = make_anime(title="The Apothecary Diaries", tags=["prostitution"])
    hidden = make_anime(is_adult=True)

    response = client.get("/api/v1/anime/?page_size=50")

    ids = {item["id"] for item in response.json()["results"]}
    assert visible.pk in ids
    assert hidden.pk not in ids


def test_exclusion_is_a_plain_flag_filter():
    sql = str(AnimeQueryService._exclude_adult_content(Anime.objects.all()).query)
    assert '"anime_anime"."is_adult"' in sql
    assert "?|" not in sql and "IN (SELECT" not in sql


def test_the_task_runs_in_chunks_that_queue_the_next(monkeypatch):
    """One worker process (lean profile) serves other queues between chunks."""
    from unittest import mock

    from apps.animes.tasks import adult_content as task_module

    runs = iter(
        [
            {"checked": 2, "payloads": 2, "flagged": 0, "cleared": 0, "last_pk": 41},
            {"checked": 1, "payloads": 1, "flagged": 0, "cleared": 0, "last_pk": 77},
        ]
    )
    seen = []

    def fake_sync(**kwargs):
        seen.append(kwargs)
        return next(runs)

    monkeypatch.setattr(adult_content, "sync_adult_flags_from_anilist", fake_sync)
    monkeypatch.setattr(task_module, "ROWS_PER_RUN", 2)
    with mock.patch.object(task_module.sync_adult_flags, "apply_async") as apply_async:
        task_module.sync_adult_flags.apply()
    apply_async.assert_called_once_with(kwargs={"after_pk": 41}, queue="low_priority")
    assert seen == [{"after_pk": 0, "limit": 2}]


def test_the_sync_resumes_after_a_row():
    first, second = make_anime(anilist_id=7301), make_anime(anilist_id=7302)
    from unittest import mock

    with mock.patch("apps.animes.services.anilist.AniListService", _FakeAniList([])) as fake:
        totals = sync_adult_flags_from_anilist(after_pk=first.pk)
    assert totals["checked"] == 1 and totals["last_pk"] == second.pk
    assert fake.calls == [([7302], [])]


@pytest.fixture
def _pending_checks_on(settings, monkeypatch):
    """public_caches_are_current as in production (the test settings turn it off)."""
    settings.PUBLIC_CACHE_PENDING_CHECK_SECONDS = 10
    monkeypatch.setattr(adult_content, "_pending_check", {"at": float("-inf"), "outage_events": 0})
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


def _lose_the_invalidation(anime):
    """What an adult flag set while Redis was down leaves: the row flagged, the
    cached copies untouched (they persist across the outage), a pending row.
    """
    from apps.animes.models import PendingPublicCacheInvalidation

    Anime.objects.filter(pk=anime.pk).update(is_adult=True)
    PendingPublicCacheInvalidation.objects.create(slug=anime.slug)


def test_a_reader_replays_a_pending_invalidation_before_the_task_does(_pending_checks_on):
    """Council r2: Redis back, replay task not run yet: the cached not-adult copy
    of a title flagged adult meanwhile must not be served.
    """
    from django.urls import reverse
    from rest_framework.test import APIClient

    from apps.animes.models import PendingPublicCacheInvalidation

    anime = make_anime(anilist_id=5103)
    client = APIClient()
    detail = reverse("anime-detail", args=[anime.slug])
    listing = f"{reverse('anime-list')}?page_size=24"
    assert client.get(detail).status_code == 200
    assert anime.slug in str(client.get(listing).content)

    _lose_the_invalidation(anime)
    # This process saw the outage: its next read looks for pending rows at once.
    adult_content._pending_check["at"] = adult_content.time.monotonic()
    from apps.shared.throttling import warn_cache_outage

    warn_cache_outage("test outage")

    gated = client.get(detail)
    assert gated.status_code == 403
    assert gated.json()["code"] == adult_content_gate_code()
    assert anime.slug not in str(client.get(listing).content)
    assert not PendingPublicCacheInvalidation.objects.exists()


def test_a_reader_bypasses_the_cache_while_the_replay_still_fails(_pending_checks_on):
    from unittest import mock

    from django.urls import reverse
    from redis.exceptions import ConnectionError as RedisConnectionError
    from rest_framework.test import APIClient

    from apps.animes.models import PendingPublicCacheInvalidation

    anime = make_anime(anilist_id=5104)
    client = APIClient()
    detail = reverse("anime-detail", args=[anime.slug])
    assert client.get(detail).status_code == 200
    _lose_the_invalidation(anime)
    from apps.shared.throttling import warn_cache_outage

    warn_cache_outage("test outage")  # this process sees the outage

    with mock.patch(
        "apps.animes.services.public_anime_service."
        "AnimePublicPayloadService.bump_collection_cache_namespace",
        side_effect=RedisConnectionError("still down"),
    ):
        gated = client.get(detail)
    assert gated.status_code == 403  # built from the database, not the cached copy
    assert PendingPublicCacheInvalidation.objects.count() == 1


def test_the_timed_look_runs_at_most_once_per_interval(_pending_checks_on, monkeypatch):
    from apps.animes.models import PendingPublicCacheInvalidation

    clock = [1000.0]
    monkeypatch.setattr(adult_content.time, "monotonic", lambda: clock[0])
    assert adult_content.public_caches_are_current()
    PendingPublicCacheInvalidation.objects.create(slug="no-such-anime")
    with mock_no_replay() as replay:
        clock[0] += 5
        assert adult_content.public_caches_are_current()  # within 10 s: no look
        replay.assert_not_called()
        clock[0] += 6
        adult_content.public_caches_are_current()
        replay.assert_called_once()


def adult_content_gate_code() -> str:
    from apps.animes.views.anime import ADULT_GATE_CODE

    return ADULT_GATE_CODE


def mock_no_replay():
    from unittest import mock

    return mock.patch.object(adult_content, "replay_public_cache_invalidations", return_value=1)


def test_a_save_that_flags_a_title_adult_during_an_outage_is_replayed(
    _pending_checks_on, django_capture_on_commit_callbacks
):
    """Council r3: a provider save (AniList's isAdult) whose post-commit
    invalidation fails keeps the slug for the replay and still raises.
    """
    from unittest import mock

    from django.urls import reverse
    from redis.exceptions import ConnectionError as RedisConnectionError
    from rest_framework.test import APIClient

    from apps.animes.models import PendingPublicCacheInvalidation
    from apps.shared.throttling import warn_cache_outage

    anime = make_anime(anilist_id=5105)
    client = APIClient()
    detail = reverse("anime-detail", args=[anime.slug])
    assert client.get(detail).status_code == 200  # cached as not adult

    anime.is_adult = True
    with (
        mock.patch(
            "apps.animes.services.public_anime_service."
            "AnimePublicPayloadService.bump_collection_cache_namespace",
            side_effect=RedisConnectionError("down"),
        ),
        pytest.raises(RedisConnectionError),
        django_capture_on_commit_callbacks(execute=True),
    ):
        anime.save()
    assert list(PendingPublicCacheInvalidation.objects.values_list("slug", flat=True)) == [
        anime.slug
    ]

    warn_cache_outage("test outage")  # this process saw it; Redis is back now
    assert client.get(detail).status_code == 403
    assert not PendingPublicCacheInvalidation.objects.exists()
