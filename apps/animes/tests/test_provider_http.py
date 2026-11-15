"""HTTP behaviour of the AniList client: retries, error codes, caching, rate limits.

Requests go through ``httpx.MockTransport`` (see ``provider_testing``), routed
by GraphQL operation name. ``RETRY_BACKOFF_SCALE`` is 0 in tests, so retry
waits cost nothing.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

import httpx
import pytest
from django.core.cache import cache
from django.test import override_settings

from apps.animes.services.anilist import AniListService
from apps.animes.services.rate_limiting import AniListRateLimiter, APICallCache
from apps.animes.tests.provider_testing import (
    ANILIST_NOT_FOUND,
    AniListGraphQL,
    ProviderHTTP,
    resolve,
    sequence,
)

MEDIA = {"Media": {"id": 1, "idMal": 1, "title": {"romaji": "Cowboy Bebop"}}}
QUERY = "query GetThing($id: Int) { Media(id: $id) { id } }"


def install(monkeypatch, routes):
    return AniListGraphQL(routes).install(monkeypatch)


@pytest.fixture
def anilist():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    yield service
    resolve(service.close())


def query(service, **kwargs):
    return service._query(QUERY, {"id": 1}, **kwargs)


def ok(data):
    return httpx.Response(200, json={"data": data})


class TestQuery:
    def test_success_returns_the_data_object(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetThing": MEDIA})

        assert query(anilist) == MEDIA
        (request,) = http.requests
        assert request.method == "POST"
        assert str(request.url) == "https://graphql.anilist.co"
        assert http.operations() == [("GetThing", {"id": 1})]
        assert anilist.last_error_code == ""

    @override_settings(ANILIST_API_URL="https://anilist.internal/graphql")
    def test_endpoint_comes_from_settings(self, monkeypatch):
        http = install(monkeypatch, {"GetThing": MEDIA})
        service = AniListService(enable_caching=False, enable_rate_limiting=False)

        assert query(service) == MEDIA
        assert str(http.requests[0].url) == "https://anilist.internal/graphql"
        service.close()

    def test_retries_after_429_then_returns_data(self, monkeypatch, anilist):
        http = install(
            monkeypatch,
            {"GetThing": sequence(httpx.Response(429, headers={"Retry-After": "2"}), ok(MEDIA))},
        )

        assert query(anilist) == MEDIA
        assert len(http.requests) == 2
        assert anilist.last_error_code == ""

    def test_429_with_rate_limit_reset_header_is_retried(self, monkeypatch, anilist):
        http = install(
            monkeypatch,
            {
                "GetThing": sequence(
                    httpx.Response(429, headers={"X-RateLimit-Reset": "1"}), ok(MEDIA)
                )
            },
        )

        assert query(anilist) == MEDIA
        assert len(http.requests) == 2

    def test_429_beyond_the_wait_budget_fails_fast(self, monkeypatch, anilist):
        http = install(
            monkeypatch, {"GetThing": httpx.Response(429, headers={"Retry-After": "30"})}
        )

        assert query(anilist, max_rate_limit_wait=0.0) == {}
        assert len(http.requests) == 1
        assert (anilist.last_error_code, anilist.last_error_message) == (
            "rate_limited",
            "http_429:GetThing",
        )
        # Being throttled is not an outage: the breaker is untouched.
        assert cache.get("cb:anilist_api:failures") is None

    def test_429_until_retries_run_out(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetThing": httpx.Response(429, headers={"Retry-After": "0"})})

        assert query(anilist, retry_count=2) == {}
        assert len(http.requests) == 2
        assert anilist.last_error_code == "rate_limited"

    def test_server_errors_are_retried_then_trip_the_breaker(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetThing": httpx.Response(503)})

        assert query(anilist, retry_count=3) == {}
        assert len(http.requests) == 3
        assert (anilist.last_error_code, anilist.last_error_message) == (
            "transport_error",
            "http_503",
        )
        assert cache.get("cb:anilist_api:failures") == 1

    @pytest.mark.parametrize(
        "error",
        [
            httpx.ConnectError("connection refused"),
            httpx.ReadTimeout("read timed out"),
            httpx.RemoteProtocolError("peer closed connection"),
        ],
    )
    def test_transport_errors_are_retried_then_reported(self, monkeypatch, anilist, error):
        http = install(monkeypatch, {"GetThing": sequence(error)})

        assert query(anilist, retry_count=2) == {}
        assert len(http.requests) == 2
        assert (anilist.last_error_code, anilist.last_error_message) == (
            "transport_error",
            str(error),
        )

    def test_transport_error_then_success(self, monkeypatch, anilist):
        install(monkeypatch, {"GetThing": sequence(httpx.ConnectError("refused"), ok(MEDIA))})

        assert query(anilist) == MEDIA
        assert anilist.last_error_code == ""

    @pytest.mark.parametrize(
        "response",
        [httpx.Response(200, text="<html>"), httpx.Response(200, json=["not", "a", "dict"])],
    )
    def test_undecodable_bodies_are_retried_then_reported(self, monkeypatch, anilist, response):
        http = install(monkeypatch, {"GetThing": response})

        assert query(anilist, retry_count=2) == {}
        assert len(http.requests) == 2
        assert anilist.last_error_code == "transport_error"

    def test_graphql_not_found_is_final(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetThing": httpx.Response(404, json=ANILIST_NOT_FOUND)})

        assert query(anilist) == {}
        assert len(http.requests) == 1
        assert (anilist.last_error_code, anilist.last_error_message) == ("not_found", "Not Found.")
        assert cache.get("cb:anilist_api:failures") is None

    def test_not_found_inside_a_200_is_still_not_found(self, monkeypatch, anilist):
        install(monkeypatch, {"GetThing": httpx.Response(200, json=ANILIST_NOT_FOUND)})

        assert query(anilist) == {}
        assert anilist.last_error_code == "not_found"

    @pytest.mark.parametrize(
        ("response", "expected"),
        [
            (
                httpx.Response(
                    400,
                    json={
                        "errors": [{"message": 'Variable "$id" got invalid value', "status": 400}],
                        "data": None,
                    },
                ),
                ("invalid_variable", 'Variable "$id" got invalid value'),
            ),
            # The query itself was rejected (schema change, complexity limit):
            # not the row's fault, so it stays retryable later.
            (
                httpx.Response(400, json={"errors": [{"message": "Syntax Error", "status": 400}]}),
                ("transport_error", "Syntax Error"),
            ),
            (httpx.Response(403, json={}), ("transport_error", "http_403:GetThing")),
        ],
    )
    def test_client_errors_are_not_retried(self, monkeypatch, anilist, response, expected):
        http = install(monkeypatch, {"GetThing": response})

        assert query(anilist) == {}
        assert len(http.requests) == 1
        assert (anilist.last_error_code, anilist.last_error_message) == expected

    def test_partial_data_with_errors_is_returned(self, monkeypatch, anilist):
        install(
            monkeypatch,
            {
                "GetThing": httpx.Response(
                    200, json={"data": MEDIA, "errors": [{"message": "staff unavailable"}]}
                )
            },
        )

        assert query(anilist) == MEDIA

    def test_passes_the_request_timeout(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetThing": MEDIA})

        query(anilist, request_timeout=8.0)

        assert http.requests[0].extensions["timeout"]["read"] == 8.0

    def test_successful_responses_are_cached(self, monkeypatch):
        # GetOther is unrouted: AniList's 404, an error response.
        http = install(monkeypatch, {"GetThing": MEDIA})
        service = AniListService(enable_caching=True, enable_rate_limiting=False)

        assert query(service) == MEDIA
        assert query(service) == MEDIA
        assert query(service, use_cache=False) == MEDIA
        other = "query GetOther { Media { id } }"
        # Error responses are not cached.
        assert service._query(other, {}) == {}
        assert service._query(other, {}) == {}
        service.close()

        assert [name for name, _ in http.operations()] == [
            "GetThing",
            "GetThing",
            "GetOther",
            "GetOther",
        ]

    def test_cache_key_is_a_stable_digest(self):
        params = '{"query": "q", "variables": {}}'
        digest = hashlib.sha256(params.encode()).hexdigest()[:32]

        assert APICallCache()._get_cache_key("GetThing", params) == f"api:cache:GetThing:{digest}"

    def test_open_circuit_breaker_skips_the_request(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetThing": MEDIA})
        cache.set("cb:anilist_api:state", "OPEN")
        cache.set("cb:anilist_api:last_failure", datetime.now())

        assert query(anilist) == {}
        assert http.requests == []
        assert (anilist.last_error_code, anilist.last_error_message) == (
            "transport_error",
            "circuit_breaker_open",
        )

    def test_rate_limiter_is_consulted_per_attempt(self, monkeypatch):
        install(monkeypatch, {"GetThing": sequence(httpx.Response(503), ok(MEDIA))})
        service = AniListService(enable_caching=False, enable_rate_limiting=True)
        calls = []
        monkeypatch.setattr(
            service.rate_limiter, "acquire", lambda max_wait=None: calls.append(max_wait) or True
        )

        assert query(service) == MEDIA
        assert calls == [None, None]
        service.close()


class TestRateLimiter:
    @override_settings(ANILIST_RATE_LIMIT_PER_MINUTE=90)
    def test_limit_comes_from_settings(self):
        limiter = AniListRateLimiter()

        assert (limiter.rate_limit, limiter.safety_margin) == (90, 9)
        assert limiter.min_delay == pytest.approx(60 / 81)

    def test_default_is_the_degraded_limit(self):
        limiter = AniListRateLimiter()

        assert (limiter.rate_limit, limiter.safety_margin) == (30, 3)
        assert limiter.min_delay == pytest.approx(60 / 27)

    def test_explicit_limit_and_a_limit_of_one(self):
        assert AniListRateLimiter(rate_limit=10).min_delay == pytest.approx(60 / 9)
        single = AniListRateLimiter(rate_limit=1)
        assert (single.safety_margin, single.min_delay) == (0, 60.0)


class TestBatchAndDetailQueries:
    def test_airing_ids_are_fetched_fifty_per_request(self, monkeypatch, anilist):
        def page(variables, request):
            return {"Page": {"media": [{"id": i, "idMal": i + 1000} for i in variables["ids"]]}}

        http = install(monkeypatch, {"GetAiringByIds": page})

        results = anilist.get_airing_by_ids(anilist_ids=[*range(1, 52), 1, 0, -3])

        assert [len(variables["ids"]) for _, variables in http.operations()] == [50, 1]
        assert [variables["perPage"] for _, variables in http.operations()] == [50, 1]
        assert [item["id"] for item in results] == list(range(1, 52))

    def test_airing_by_mal_ids_uses_the_mal_filter(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetAiringByIds": {"Page": {"media": [{"id": 5}]}}})

        assert anilist.get_airing_by_ids(mal_ids=[21]) == [{"id": 5}]
        body = http.requests[0].content.decode()
        assert "idMal_in: $ids" in body
        assert anilist.get_airing_by_ids() == []
        assert len(http.requests) == 1

    def test_single_airing_payload_and_its_errors(self, monkeypatch, anilist):
        http = install(
            monkeypatch, {"GetAiringAnime": {"Media": {"id": 21, "status": "RELEASING"}}}
        )

        assert anilist.get_airing_anime(anilist_id=21) == {"id": 21, "status": "RELEASING"}
        assert anilist.get_airing_anime(mal_id=21) == {"id": 21, "status": "RELEASING"}
        assert http.operations() == [
            ("GetAiringAnime", {"id": 21}),
            ("GetAiringAnime", {"idMal": 21}),
        ]

        assert anilist.get_airing_anime() is None
        assert anilist.last_error_code == "invalid_variable"
        assert len(http.requests) == 2

    def test_missing_airing_payload_is_not_found(self, monkeypatch, anilist):
        install(monkeypatch, {"GetAiringAnime": {"Media": None}})

        assert anilist.get_airing_anime(anilist_id=99) is None
        assert (anilist.last_error_code, anilist.last_error_message) == ("not_found", "airing:99")

    def test_episode_schedule_follows_pages(self, monkeypatch, anilist):
        def schedule(variables, request):
            page = variables["page"]
            return {
                "Media": {
                    "id": 21,
                    "idMal": 21,
                    "episodes": None,
                    "status": "RELEASING",
                    "nextAiringEpisode": {"episode": 4, "airingAt": 1},
                    "streamingEpisodes": [{"title": "Episode 1 - A"}, "junk"],
                    "airingSchedule": {
                        "pageInfo": {"hasNextPage": page < 3},
                        "nodes": [{"episode": page, "airingAt": page * 10}, None],
                    },
                }
            }

        http = install(monkeypatch, {"GetAnimeEpisodes": schedule})

        result = anilist.get_episode_schedule(anilist_id=21)

        assert [variables["page"] for _, variables in http.operations()] == [1, 2, 3]
        assert result == {
            "id": 21,
            "idMal": 21,
            "episodes": None,
            "status": "RELEASING",
            "nextAiringEpisode": {"episode": 4, "airingAt": 1},
            "streamingEpisodes": [{"title": "Episode 1 - A"}],
            "airingSchedule": [
                {"episode": 1, "airingAt": 10},
                {"episode": 2, "airingAt": 20},
                {"episode": 3, "airingAt": 30},
            ],
        }

    def test_interactive_episode_schedule_caps_pages_and_retries(self, monkeypatch, anilist):
        endless = {
            "Media": {
                "id": 1,
                "airingSchedule": {"pageInfo": {"hasNextPage": True}, "nodes": []},
            }
        }
        http = install(monkeypatch, {"GetAnimeEpisodes": endless})

        anilist.get_episode_schedule(mal_id=1, request_budget="interactive")

        assert len(http.requests) == AniListService.EPISODE_SCHEDULE_INTERACTIVE_PAGES
        # Streaming links only on the first page.
        assert [variables for _, variables in http.operations()[:2]] == [
            {"idMal": 1, "page": 1, "withStreaming": True},
            {"idMal": 1, "page": 2, "withStreaming": False},
        ]
        assert http.requests[0].extensions["timeout"]["read"] == 8.0

    def test_episode_schedule_not_found(self, monkeypatch, anilist):
        install(monkeypatch, {})

        assert anilist.get_episode_schedule(anilist_id=5) is None
        assert anilist.last_error_code == "not_found"
        assert anilist.get_episode_schedule() is None
        assert anilist.last_error_code == "invalid_variable"

    def test_recommendations_by_mal_id(self, monkeypatch, anilist):
        http = install(
            monkeypatch, {"GetAnimeRecommendations": "anilist/recommendations_154587.json"}
        )

        recommendations = anilist.get_recommendations_for_anime(mal_id=52991, limit=3)

        assert recommendations
        assert http.operations() == [("GetAnimeRecommendations", {"idMal": 52991, "perPage": 3})]
        assert "idMal: $idMal" in http.requests[0].content.decode()

    def test_recommendations_prefer_the_anilist_id(self, monkeypatch, anilist):
        http = install(monkeypatch, {"GetAnimeRecommendations": {"Media": None}})

        assert anilist.get_recommendations_for_anime(154587, mal_id=52991) == []
        assert http.operations() == [("GetAnimeRecommendations", {"id": 154587, "perPage": 8})]
        assert anilist.get_recommendations_for_anime(None) == []
        assert anilist.last_error_code == "invalid_variable"


class TestImageDownloads:
    IMAGE = "https://cdn.myanimelist.net/images/anime/1/1.jpg"

    @pytest.fixture
    def service(self):
        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        yield service
        resolve(service.close())

    @pytest.fixture
    def image_route(self, monkeypatch):
        routes = {
            self.IMAGE: httpx.Response(
                200, content=b"jpeg-bytes", headers={"content-type": "image/jpeg"}
            ),
            self.IMAGE.replace("1.jpg", "2.jpg"): httpx.Response(
                200, text="<html>", headers={"content-type": "text/html"}
            ),
            self.IMAGE.replace("1.jpg", "3.jpg"): httpx.Response(500),
        }
        return ProviderHTTP(routes).install(monkeypatch)

    def test_downloads_trusted_images(self, service, image_route):
        assert resolve(service.download_image(self.IMAGE)) == b"jpeg-bytes"

    def test_rejects_non_image_content(self, service, image_route):
        assert resolve(service.download_image(self.IMAGE.replace("1.jpg", "2.jpg"))) is None

    def test_http_errors_return_none(self, service, image_route):
        assert resolve(service.download_image(self.IMAGE.replace("1.jpg", "3.jpg"))) is None

    def test_untrusted_or_empty_urls_make_no_request(self, service, image_route):
        assert resolve(service.download_image("https://evil.example.com/x.jpg")) is None
        assert resolve(service.download_image("")) is None
        assert image_route.requests == []


class TestAniListClientState:
    def test_cache_circuit_breaker_and_rate_limit_helpers(self):
        service = AniListService(enable_caching=True, enable_rate_limiting=True)

        assert service._get_cached_result("graphql", "k") is None
        service._cache_result("graphql", "k", {"Media": {"id": 1}})
        assert service._get_cached_result("graphql", "k") == {"Media": {"id": 1}}

        assert service._check_circuit_breaker() is True
        service._record_failure()
        assert cache.get("cb:anilist_api:failures") == 1
        service._record_success()
        assert cache.get("cb:anilist_api:failures") == 0

        # The test cache has no raw Redis client, so this takes the local fallback.
        resolve(service._acquire_rate_limit())
        resolve(service.close())

    def test_disabled_helpers_are_no_ops(self):
        service = AniListService(enable_caching=False, enable_rate_limiting=False)

        service._cache_result("graphql", "k", {"x": 1})
        assert service._get_cached_result("graphql", "k") is None
        resolve(service._acquire_rate_limit())
        resolve(service.close())


class TestRequestsWhileAUserWaits:
    """Interactive calls must not hold a web worker waiting for a rate-limit slot."""

    @pytest.fixture
    def limited(self):
        service = AniListService(enable_caching=False, enable_rate_limiting=True)
        yield service
        service.close()

    @staticmethod
    def no_sleeping(monkeypatch):
        def fail(seconds):
            raise AssertionError(f"slept {seconds}s")

        monkeypatch.setattr("apps.animes.services.rate_limiting.time.sleep", fail)

    def test_full_window_fails_fast_without_a_request(self, monkeypatch, limited):
        http = install(monkeypatch, {"GetThing": MEDIA})
        monkeypatch.setattr(limited.rate_limiter, "_take_shared_slot", lambda: False)
        self.no_sleeping(monkeypatch)

        assert query(limited, max_rate_limit_wait=0.0) == {}
        assert limited.last_error_code == "rate_limited"
        assert http.requests == []

    def test_interactive_service_caps_every_query(self, monkeypatch):
        http = install(monkeypatch, {"GetThing": httpx.Response(503)})
        service = AniListService(
            enable_caching=False, enable_rate_limiting=True, request_budget="interactive"
        )
        monkeypatch.setattr(service.rate_limiter, "_take_shared_slot", lambda: False)
        self.no_sleeping(monkeypatch)

        assert query(service) == {}
        assert service.last_error_code == "rate_limited"
        assert http.requests == []

        monkeypatch.setattr(service.rate_limiter, "_take_shared_slot", lambda: True)
        assert query(service) == {}
        assert len(http.requests) == 1  # one try only
        assert http.requests[0].extensions["timeout"]["read"] == 8.0
        service.close()

    def test_a_429_pauses_every_worker(self, monkeypatch, limited):
        install(monkeypatch, {"GetThing": httpx.Response(429, headers={"Retry-After": "30"})})
        assert query(limited, max_rate_limit_wait=0.0) == {}

        other_worker = AniListService(enable_caching=False, enable_rate_limiting=True)
        http = install(monkeypatch, {"GetThing": MEDIA})
        self.no_sleeping(monkeypatch)
        assert query(other_worker, max_rate_limit_wait=0.0) == {}
        assert other_worker.last_error_code == "rate_limited"
        assert http.requests == []
        other_worker.close()

    def test_background_calls_wait_out_the_pause(self, monkeypatch):
        limiter = AniListRateLimiter()
        limiter.pause(5)
        slept = []

        def sleep(seconds):
            slept.append(seconds)
            cache.delete(AniListRateLimiter.PAUSE_KEY)

        monkeypatch.setattr("apps.animes.services.rate_limiting.time.sleep", sleep)

        assert limiter.acquire() is True
        assert 4 < slept[0] <= 5


class TestPagination:
    def test_last_page_keeps_the_page_size_so_no_row_repeats(self, monkeypatch, anilist):
        def page(variables, _request):
            first = (variables["page"] - 1) * variables["perPage"]
            media = [{"id": first + n + 1} for n in range(variables["perPage"])]
            return {"Page": {"pageInfo": {"hasNextPage": True}, "media": media}}

        http = install(monkeypatch, {"GetAnime": page})

        ids = [item["id"] for item in anilist.get_recent_updates(limit=40)]

        assert ids == list(range(1, 41))
        assert [variables["perPage"] for _, variables in http.operations()] == [25, 25]
