"""Golden tests for the provider normalization layer.

Recorded (hand-written, field-for-field realistic) AniList and Jikan payloads
from ``fixtures/providers`` go through the providers' fetch and normalization
code; the normalized dicts must match ``snapshots/provider_golden.json``
byte for byte. Jikan HTTP is served by ``httpx.MockTransport``; AniList's
network access is disabled at runtime, so its GraphQL responses are fed to the
methods that parse them.

These tests are the Phase 4 safety net: the provider split and the sync
conversion must not change them or the snapshot. After an approved change to
normalized output, regenerate the snapshot and review the diff:

    UPDATE_PROVIDER_GOLDEN=1 make test ARGS="apps/animes/tests/test_provider_golden.py"
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from apps.animes.services.anilist import AniListService
from apps.animes.services.jikan import JikanService, get_jikan_base_url
from apps.animes.tests.provider_testing import (
    JIKAN_ROUTES,
    ProviderHTTP,
    fake_method,
    load_fixture,
    resolve,
)

SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "provider_golden.json"
UPDATE = os.getenv("UPDATE_PROVIDER_GOLDEN") == "1"

NEXT_BROADCAST = "<next broadcast>"


def _render(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2, default=str) + "\n"


def _assert_next_broadcast(timestamp, *, weekday: int, hour: int, minute: int, tz: str):
    """Check a time-relative airing estimate, then hide it from the snapshot."""
    assert isinstance(timestamp, int)
    local = datetime.fromtimestamp(timestamp, ZoneInfo(tz))
    assert (local.weekday(), local.hour, local.minute) == (weekday, hour, minute)
    assert 0 < timestamp - time.time() <= 7 * 24 * 3600
    return NEXT_BROADCAST


def _stable_airing(payload: dict, **broadcast) -> dict:
    payload = json.loads(json.dumps(payload))
    next_airing = payload.get("nextAiringEpisode") or {}
    if "airingAt" in next_airing:
        next_airing["airingAt"] = _assert_next_broadcast(next_airing["airingAt"], **broadcast)
    return payload


def _stable_prepared(prepared: dict, **broadcast) -> dict:
    prepared = dict(prepared)
    when = prepared.get("next_airing_date")
    if when is not None:
        _assert_next_broadcast(int(when.timestamp()), **broadcast)
        prepared["next_airing_date"] = NEXT_BROADCAST
    return prepared


def _operation_name(query: str) -> str:
    match = re.search(r"query\s+(\w+)", query)
    return match.group(1) if match else ""


@pytest.fixture
def jikan_http(monkeypatch):
    return ProviderHTTP(JIKAN_ROUTES, base_url=get_jikan_base_url()).install(monkeypatch)


@pytest.fixture
def jikan(jikan_http):
    service = JikanService(enable_caching=False, enable_rate_limiting=False)
    yield service
    resolve(service.close())


@pytest.fixture
def anilist():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    yield service
    resolve(service.close())


def _jikan_cases(service: JikanService, http: ProviderHTTP) -> dict:
    cases = {}

    def record(name, value, *, pin_error=True):
        cases[name] = {
            "result": value,
            "requests": http.calls(),
            # The full-detail lookup runs its requests concurrently; when some
            # fail and others succeed, which one sets last_error last is a race.
            "last_error": [service.last_error_code, service.last_error_message]
            if pin_error
            else "<not pinned>",
        }
        http.requests.clear()

    one_piece = {"weekday": 6, "hour": 23, "minute": 15, "tz": "Asia/Tokyo"}

    frieren = resolve(service.search_by_mal_id(52991, anilist_id=154587))
    record("search_by_mal_id.52991", frieren)
    cases["prepare_anime_data.52991"] = service._prepare_anime_data(
        frieren, "Frieren: Beyond Journey's End", "葬送のフリーレン", "sousou-no-frieren"
    )

    one_piece_full = resolve(service.search_by_mal_id(21))
    record("search_by_mal_id.21", _stable_airing(one_piece_full, **one_piece), pin_error=False)
    cases["prepare_anime_data.21"] = _stable_prepared(
        service._prepare_anime_data(one_piece_full, "One Piece", "ONE PIECE", "one-piece"),
        **one_piece,
    )

    airing = resolve(service.search_airing_by_mal_id(21, anilist_id=21))
    record("search_airing_by_mal_id.21", _stable_airing(airing, **one_piece))

    record("search_airing_by_mal_id.invalid", resolve(service.search_airing_by_mal_id(0)))
    record("search_by_mal_id.missing", resolve(service.search_by_mal_id(404)))

    recent = resolve(service.get_recent_updates(limit=5))
    record("get_recent_updates.5", recent)
    cases["prepare_anime_data.recent"] = [
        service._prepare_anime_data(
            item,
            item["title"]["english"] or item["title"]["romaji"],
            item["title"]["native"],
            f"slug-{item['idMal']}",
        )
        for item in recent
    ]

    record("search_anime.frieren", resolve(service.search_anime("  Frieren!!  ")))

    record(
        "streaming_episodes.52991",
        resolve(service.get_streaming_episodes_for_anime(anilist_id=154587, mal_id=52991)),
    )
    record("streaming_episodes.no_ids", resolve(service.get_streaming_episodes_for_anime()))
    record("recommendations.52991", resolve(service.get_recommendations_for_anime(52991)))
    record(
        "recommendations.52991.limit2",
        resolve(
            service.get_recommendations_for_anime(52991, limit=2, request_budget="interactive")
        ),
    )
    record("recommendations.invalid", resolve(service.get_recommendations_for_anime(-1)))

    cases["helpers"] = {
        "duration_minutes": {
            repr(value): JikanService._normalize_duration_minutes(value)
            for value in (
                "24 min per ep",
                "1 hr 2 min",
                "2 hr",
                "45 sec",
                "1 min 30 sec",
                "Unknown",
                None,
                13,
            )
        },
        "next_episode_airing_at": {
            repr(value): JikanService._parse_next_episode_airing_at(value)
            for value in (
                None,
                "",
                "  ",
                1732809360,
                1732809360.9,
                0,
                "1732809360",
                "2024-11-28T15:56:00Z",
                "2024-11-28T15:56:00",
                "2024-11-29T00:56:00+09:00",
                "not a date",
                [1],
            )
        },
        "merge_next_airing": [
            service._merge_next_airing_payload(item, estimate)
            for item, estimate in (
                ({"next_episode": {"episode": 7, "aired_at": "2024-11-28T15:56:00Z"}}, None),
                ({"nextEpisode": {"number": "8", "airedAt": 1732809360}}, None),
                (
                    {"next_episode": {"aired_at": 1732809360}},
                    {"episode": 9, "airingAt": 1},
                ),
                ({"next_episode": {"aired_at": 1732809360}}, None),
                ({"next_episode": {"episode": 3}}, {"episode": 4, "airingAt": 5}),
                ({"next_episode": "soon"}, None),
            )
        ],
        "jikan_date": [
            JikanService._normalize_jikan_date(value)
            for value in (
                {"year": 2024, "month": 2, "day": 3},
                {"year": "2024", "month": None, "day": None},
                {"year": None},
                None,
            )
        ],
        "broadcast": [
            service._normalize_broadcast_payload(value)
            for value in (
                {"day": "Saturdays", "time": " 01:30 ", "timezone": "Asia/Tokyo "},
                {"day": "someday"},
                None,
            )
        ],
        "format_status_source": [
            [
                JikanService._normalize_format(raw_type),
                JikanService._normalize_status(raw_status),
                JikanService._normalize_source(raw_source),
            ]
            for raw_type, raw_status, raw_source in (
                ("TV Special", "Not yet aired", "4-koma manga"),
                ("Movie", "Currently Airing", "Web novel"),
                (None, None, None),
                ("music", "cancelled", "Mixed media"),
            )
        ],
        "service_ids": [
            JikanService._character_sync_id(5),
            JikanService._staff_sync_id(5),
            JikanService._character_sync_id(None),
            JikanService._staff_sync_id(2_147_483_000),
        ],
        "latest_episode": [
            service._latest_episode_number(items)
            for items in ([{"mal_id": 3}, {"mal_id": 10}, {"mal_id": None}, {}], [])
        ],
    }
    return cases


def _anilist_cases(service: AniListService) -> dict:
    cases = {}
    media = load_fixture("anilist/media_154587.json")["Media"]
    page = load_fixture("anilist/page_trending.json")
    responses = {
        "GetAnimeById": load_fixture("anilist/media_154587.json"),
        "SearchByMalId": load_fixture("anilist/media_154587.json"),
        "GetAnimeRecommendations": load_fixture("anilist/recommendations_154587.json"),
        "GetAnimeStreamingEpisodes": load_fixture("anilist/streaming_154587.json"),
        "GetAnime": page,
        "BySeason": page,
        "SearchAnime": {"Page": {"media": page["Page"]["media"][:1]}},
    }
    query_calls = []

    def query(query, variables, *args, **kwargs):
        # As a successful network query would, start from a clean error state.
        service._reset_last_error()
        name = _operation_name(query)
        query_calls.append({"operation": name, "variables": dict(variables), "options": kwargs})
        return json.loads(json.dumps(responses.get(name, {})))

    fake_method(service, "_query", query)

    def record(name, value):
        cases[name] = {
            "result": value,
            "queries": list(query_calls),
            "last_error": [service.last_error_code, service.last_error_message],
        }
        query_calls.clear()

    def ids(items):
        return [item.get("id") for item in items]

    cases["prepare_anime_data.154587"] = service._prepare_anime_data(
        media, media["title"]["english"], media["title"]["native"], "frieren"
    )
    cases["prepare_anime_data.trending"] = [
        service._prepare_anime_data(
            item,
            item["title"].get("english") or item["title"].get("romaji"),
            item["title"].get("native"),
            f"slug-{item['id']}",
        )
        for item in page["Page"]["media"]
    ]

    record("get_anime_by_id.154587", resolve(service.get_anime_by_id(154587)))
    record("get_anime_by_id.invalid", resolve(service.get_anime_by_id(0)))
    record("search_by_mal_id.52991", ids([resolve(service.search_by_mal_id(52991))]))
    record("search_by_mal_id.invalid", resolve(service.search_by_mal_id(-5)))
    record("get_recent_updates.2", ids(resolve(service.get_recent_updates(limit=2))))
    record("get_top_rated.60", ids(resolve(service.get_top_rated(limit=60))))
    record("get_by_season.winter", ids(resolve(service.get_by_season("WINTER", 2025, limit=3))))
    record("search_anime.dandadan", ids(resolve(service.search_anime("Dan★Da★Dan", per_page=50))))
    record("search_anime.empty", resolve(service.search_anime("   ")))
    record("recommendations.154587", resolve(service.get_recommendations_for_anime(154587)))
    record(
        "recommendations.154587.interactive",
        len(
            resolve(
                service.get_recommendations_for_anime(
                    154587, limit=80, request_budget="interactive"
                )
            )
        ),
    )
    record("recommendations.invalid", resolve(service.get_recommendations_for_anime(0)))
    record(
        "streaming_episodes.154587",
        resolve(service.get_streaming_episodes_for_anime(anilist_id=154587)),
    )
    record(
        "streaming_episodes.by_mal",
        resolve(service.get_streaming_episodes_for_anime(mal_id=52991, anilist_id=-1)),
    )
    record("streaming_episodes.no_ids", resolve(service.get_streaming_episodes_for_anime()))

    cases["helpers"] = {
        "theme_songs": {
            text: service._parse_theme_song(text)
            for text in media["openings"] + media["endings"] + ['"Unclosed by Nobody', "x (ep 3)"]
        },
        "search_variants": {
            text: service._search_variants(text)
            for text in (
                "Dan★Da★Dan",
                "  plain   title ",
                "",
                "Re:Zero \N{MINUS SIGN} Starting Life",
            )
        },
        "graphql_error_codes": {
            text: service._parse_graphql_error_code(text)
            for text in (
                "Too Many Requests.",
                "Variable $id of type Int was provided invalid value",
                "Not Found.",
                "Internal Server Error",
                "",
            )
        },
        "image_urls": {
            url: [
                AniListService.normalize_external_image_url(url),
                AniListService.resolve_fetchable_image_url(url),
                JikanService.normalize_external_image_url(url),
                JikanService.resolve_fetchable_image_url(url),
            ]
            for url in (
                "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg",
                "http://s4.anilist.co/file/x.png",
                "https://myanimelist.net/images/anime/1/1.jpg",
                "http://www.myanimelist.net/anime/1/poster.webp",
                "https://myanimelist.net/anime/1",
                "https://media.kitsu.app/poster.jpg",
                "https://www.youtube.com/watch?v=abc",
                "ftp://cdn.myanimelist.net/a.jpg",
                "not a url",
                "",
            )
        },
    }
    return cases


def test_provider_golden_snapshot(jikan, jikan_http, anilist):
    rendered = _render(
        {"jikan": _jikan_cases(jikan, jikan_http), "anilist": _anilist_cases(anilist)}
    )

    if UPDATE or not SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.write_text(rendered, encoding="utf-8")
        if not UPDATE:
            pytest.fail(f"Wrote missing snapshot {SNAPSHOT_PATH.name}; review and commit it.")
        return

    expected = SNAPSHOT_PATH.read_text(encoding="utf-8")
    assert rendered == expected, (
        "Provider normalization changed. If intended, regenerate with "
        "UPDATE_PROVIDER_GOLDEN=1 and review the snapshot diff."
    )


def test_anilist_network_access_stays_disabled(anilist):
    with pytest.raises(RuntimeError, match="network access is disabled"):
        resolve(anilist._query("query { Viewer { id } }", {}))
    assert anilist.last_error_code == "disabled"
