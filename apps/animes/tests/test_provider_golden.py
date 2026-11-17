"""Golden tests for the provider normalization layer.

Recorded (hand-written, field-for-field realistic) AniList GraphQL payloads
from ``fixtures/providers/anilist`` go through the provider's fetch and
normalization code, with ``_query`` replaced by one serving the fixtures by
operation name; the normalized dicts must match ``snapshots/provider_golden.json``
byte for byte. (``test_provider_http.py`` covers ``_query`` itself.)

After an approved change to normalized output, regenerate the snapshot and
review the diff:

    UPDATE_PROVIDER_GOLDEN=1 make test ARGS="apps/animes/tests/test_provider_golden.py"
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from apps.animes.services.anilist import AniListService
from apps.animes.tests.provider_testing import fake_method, load_fixture, operation_name, resolve

SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "provider_golden.json"
UPDATE = os.getenv("UPDATE_PROVIDER_GOLDEN") == "1"

# 2023-10-06 14:00 UTC: Friday 23:00 in Japan.
FIXED_AIRING = {"episode": 5, "airingAt": 1696600800}


def _render(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2, default=str) + "\n"


@pytest.fixture
def anilist():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    yield service
    resolve(service.close())


def _anilist_cases(service: AniListService) -> dict:
    cases = {}
    media = load_fixture("anilist/media_154587.json")["Media"]
    page = load_fixture("anilist/page_trending.json")
    responses = {
        "GetAnimeById": load_fixture("anilist/media_154587.json"),
        "SearchByMalId": load_fixture("anilist/media_154587.json"),
        "GetAiringAnime": load_fixture("anilist/media_154587.json"),
        "GetAnimeRecommendations": load_fixture("anilist/recommendations_154587.json"),
        "GetAnimeEpisodes": load_fixture("anilist/streaming_154587.json"),
        "GetAiringByIds": {"Page": {"media": page["Page"]["media"]}},
        "GetAnime": page,
        "BySeason": page,
        "SearchAnime": {"Page": {"media": page["Page"]["media"][:1]}},
    }
    query_calls = []

    def query(query, variables, *args, **kwargs):
        # As a successful network query would, start from a clean error state.
        service._reset_last_error()
        name = operation_name(query)
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
    cases["prepare_anime_data.154587.airing"] = service._prepare_anime_data(
        {**media, "status": "RELEASING", "nextAiringEpisode": FIXED_AIRING},
        media["title"]["english"],
        media["title"]["native"],
        "frieren",
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
    record(
        "get_airing_by_ids",
        ids(service.get_airing_by_ids(anilist_ids=[154587, 1], mal_ids=[52991])),
    )
    record("get_airing_anime.154587", ids([service.get_airing_anime(anilist_id=154587)]))
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
    record("recommendations.by_mal", len(service.get_recommendations_for_anime(mal_id=52991)))
    record("recommendations.invalid", resolve(service.get_recommendations_for_anime(0)))
    record("episode_schedule.154587", service.get_episode_schedule(anilist_id=154587))
    record(
        "episode_schedule.by_mal.interactive",
        service.get_episode_schedule(mal_id=52991, anilist_id=-1, request_budget="interactive"),
    )
    record("episode_schedule.no_ids", service.get_episode_schedule())

    cases["helpers"] = {
        "broadcast_from_airing": [
            service._broadcast_from_airing(value)
            for value in (
                FIXED_AIRING,
                {"airingAt": 1696600800 + 3600},  # midnight in Japan: Saturday 00:00
                {"airingAt": 0},
                {"airingAt": "1696600800"},
                {},
            )
        ],
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


def test_provider_golden_snapshot(anilist):
    rendered = _render({"anilist": _anilist_cases(anilist)})

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


def test_broadcast_slot_is_japan_time():
    slot = AniListService._broadcast_from_airing(FIXED_AIRING)

    assert slot == {"day": "Friday", "time": "23:00", "timezone": "Asia/Tokyo"}
