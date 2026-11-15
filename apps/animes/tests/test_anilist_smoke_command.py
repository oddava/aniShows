"""``manage.py anilist_smoke``: the deploy's check that AniList accepts every query."""

import httpx
import pytest
from django.core.management import CommandError, call_command

from apps.animes.services.rate_limiting import AniListRateLimiter
from apps.animes.tests.provider_testing import AniListGraphQL

MEDIA = {"id": 1, "idMal": 1, "title": {"romaji": "Cowboy Bebop"}, "status": "FINISHED"}
PAGE = {"Page": {"pageInfo": {"hasNextPage": False}, "media": [MEDIA]}}
ROUTES = {
    "GetAnimeById": {"Media": MEDIA},
    "SearchByMalId": {"Media": MEDIA},
    "SearchAnime": PAGE,
    "GetAnime": PAGE,
    "BySeason": PAGE,
    "GetAiringByIds": PAGE,
    "GetAiringAnime": {"Media": MEDIA},
    "GetAnimeEpisodes": {
        "Media": {**MEDIA, "episodes": 26, "streamingEpisodes": [], "airingSchedule": {"nodes": []}}
    },
    "GetAnimeRecommendations": {
        "Media": {"recommendations": {"nodes": [{"rating": 9, "mediaRecommendation": MEDIA}]}}
    },
}


@pytest.fixture(autouse=True)
def _free_slots(monkeypatch):
    monkeypatch.setattr(AniListRateLimiter, "acquire", lambda self, max_wait=None: True)


def run(capsys):
    call_command("anilist_smoke")
    return capsys.readouterr().out


def test_every_operation_is_checked(monkeypatch, capsys):
    http = AniListGraphQL(ROUTES)
    http.install(monkeypatch)

    output = run(capsys)

    assert output.count("ok ") == 9, output
    assert {operation for operation, _ in http.operations()} == set(ROUTES)


def test_a_rejected_query_fails_the_check(monkeypatch, capsys):
    rejected = httpx.Response(400, json={"errors": [{"message": 'Cannot query field "x"'}]})
    AniListGraphQL({**ROUTES, "GetAnimeEpisodes": rejected}).install(monkeypatch)

    with pytest.raises(CommandError, match="GetAnimeEpisodes"):
        run(capsys)


def test_busy_anilist_is_reported_but_does_not_fail(monkeypatch, capsys):
    AniListGraphQL({name: httpx.Response(503) for name in ROUTES}).install(monkeypatch)

    output = run(capsys)

    assert "skipped" in output
    assert "REJECTED" not in output


def test_an_old_query_breaker_does_not_block_the_check(monkeypatch, capsys):
    # The breaker of a query the previous release kept sending is open; the
    # new release's query is different text, so it is sent and checked.
    from apps.animes.services.anilist import AniListService

    old = AniListService._query_breaker("GetAnimeById", "query GetAnimeById { old }")
    for _ in range(5):
        old.record_failure()
    AniListGraphQL(ROUTES).install(monkeypatch)

    assert run(capsys).count("ok ") == 9
