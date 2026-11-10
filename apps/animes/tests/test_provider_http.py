"""HTTP behaviour of the provider clients: retries, error codes, caching, rate limits.

Requests go through ``httpx.MockTransport`` (see ``provider_testing``); the
tests use ``resolve`` so they hold for the async and the sync provider API.
"""

from __future__ import annotations

import time
from datetime import datetime

import httpx
import pytest
from django.core.cache import cache

from apps.animes.services.anilist import AniListService
from apps.animes.services.jikan import (
    JIKAN_COOLDOWN_CACHE_KEY,
    JikanRateLimiter,
    JikanService,
    fetch_themes_from_jikan,
    fetch_themes_from_jikan_with_reason,
    get_jikan_base_url,
)
from apps.animes.tests.provider_testing import ProviderHTTP, http_client_for, resolve

ANIME = {"data": {"mal_id": 1, "title": "Cowboy Bebop"}}


def sequence(*steps):
    """A route answering with each step in turn (a Response, or an exception to raise)."""
    remaining = list(steps)

    def route(request):
        step = remaining.pop(0) if len(remaining) > 1 else remaining[0]
        if isinstance(step, Exception):
            raise step
        return step

    return route


def install(monkeypatch, routes):
    return ProviderHTTP(routes, base_url=get_jikan_base_url()).install(monkeypatch)


@pytest.fixture
def jikan():
    service = JikanService(enable_caching=False, enable_rate_limiting=False)
    yield service
    resolve(service.close())


def get(service, path="/anime/1/full", **kwargs):
    return resolve(service._get(path, endpoint="anime_full", **kwargs))


class TestJikanGet:
    def test_retries_after_429_then_returns_payload(self, monkeypatch, jikan):
        http = install(
            monkeypatch,
            {
                "/anime/1/full": sequence(
                    httpx.Response(429, headers={"Retry-After": "0"}),
                    httpx.Response(200, json=ANIME),
                )
            },
        )

        assert get(jikan) == ANIME
        assert len(http.requests) == 2
        assert jikan.last_error_code == ""

    def test_429_beyond_the_wait_budget_fails_fast(self, monkeypatch, jikan):
        http = install(
            monkeypatch,
            {"/anime/1/full": httpx.Response(429, headers={"Retry-After": "30"})},
        )

        assert get(jikan, max_rate_limit_wait=0.0) == {}
        assert len(http.requests) == 1
        assert (jikan.last_error_code, jikan.last_error_message) == (
            "rate_limited",
            "http_429:anime_full",
        )

    def test_429_until_retries_run_out(self, monkeypatch, jikan):
        http = install(
            monkeypatch,
            {"/anime/1/full": httpx.Response(429, headers={"Retry-After": "0"})},
        )

        assert get(jikan, retry_count=2) == {}
        assert len(http.requests) == 2
        assert jikan.last_error_code == "rate_limited"

    def test_server_errors_are_retried_then_recorded_as_a_failure(self, monkeypatch, jikan):
        http = install(monkeypatch, {"/anime/1/full": httpx.Response(503)})

        assert get(jikan, retry_count=3) == {}
        assert len(http.requests) == 3
        assert (jikan.last_error_code, jikan.last_error_message) == (
            "transport_error",
            "http_503",
        )
        assert cache.get("cb:jikan_api:failures") == 1

    @pytest.mark.parametrize(
        ("response", "expected"),
        [
            (
                httpx.Response(404, json={"message": "Resource does not exist"}),
                ("not_found", "Resource does not exist"),
            ),
            (httpx.Response(404, json={}), ("not_found", "{}")),
            (httpx.Response(422, json={"error": "bad q"}), ("invalid_variable", "bad q")),
            (httpx.Response(400, json=["x"]), ("invalid_variable", '["x"]')),
            (httpx.Response(403, text="Forbidden"), ("transport_error", "Forbidden")),
            (httpx.Response(418, text=""), ("transport_error", "http_418")),
        ],
    )
    def test_client_errors_are_not_retried(self, monkeypatch, jikan, response, expected):
        http = install(monkeypatch, {"/anime/1/full": response})

        assert get(jikan) == {}
        assert len(http.requests) == 1
        assert (jikan.last_error_code, jikan.last_error_message) == expected

    @pytest.mark.parametrize(
        "error",
        [
            httpx.ConnectError("connection refused"),
            httpx.ReadTimeout("read timed out"),
            httpx.RemoteProtocolError("peer closed connection"),
        ],
    )
    def test_transport_errors_are_retried_then_reported(self, monkeypatch, jikan, error):
        http = install(monkeypatch, {"/anime/1/full": sequence(error)})

        assert get(jikan, retry_count=2) == {}
        assert len(http.requests) == 2
        assert (jikan.last_error_code, jikan.last_error_message) == (
            "transport_error",
            str(error),
        )

    def test_transport_error_then_success(self, monkeypatch, jikan):
        install(
            monkeypatch,
            {
                "/anime/1/full": sequence(
                    httpx.ConnectError("refused"), httpx.Response(200, json=ANIME)
                )
            },
        )

        assert get(jikan) == ANIME
        assert jikan.last_error_code == ""

    def test_invalid_json_is_retried_then_reported(self, monkeypatch, jikan):
        http = install(monkeypatch, {"/anime/1/full": httpx.Response(200, text="<html>")})

        assert get(jikan, retry_count=2) == {}
        assert len(http.requests) == 2
        assert jikan.last_error_code == "transport_error"

    def test_drops_empty_params_and_passes_the_timeout(self, monkeypatch, jikan):
        http = install(monkeypatch, {"/anime": {"data": []}})

        resolve(
            jikan._get(
                "/anime",
                params={"q": "bebop", "page": None, "genres": [], "type": ""},
                request_timeout=8.0,
            )
        )

        (request,) = http.requests
        assert dict(request.url.params) == {"q": "bebop"}
        assert request.extensions["timeout"]["read"] == 8.0

    def test_successful_payloads_are_cached(self, monkeypatch):
        http = install(monkeypatch, {"/anime/1/full": ANIME, "/anime/2/full": {}})
        service = JikanService(enable_caching=True, enable_rate_limiting=False)

        assert get(service) == ANIME
        assert get(service) == ANIME
        assert get(service, use_cache=False) == ANIME
        # Empty payloads are not cached.
        assert get(service, "/anime/2/full") == {}
        assert get(service, "/anime/2/full") == {}
        resolve(service.close())

        assert http.calls() == [
            "GET /anime/1/full",
            "GET /anime/1/full",
            "GET /anime/2/full",
            "GET /anime/2/full",
        ]

    def test_open_circuit_breaker_skips_the_request(self, monkeypatch, jikan):
        http = install(monkeypatch, {"/anime/1/full": ANIME})
        cache.set("cb:jikan_api:state", "OPEN")
        cache.set("cb:jikan_api:last_failure", datetime.now())

        assert get(jikan) == {}
        assert http.requests == []
        assert jikan.last_error_message == "circuit_breaker_open"

    def test_rate_limited_service_records_successes(self, monkeypatch):
        install(monkeypatch, {"/anime/1/full": ANIME})
        service = JikanService(enable_caching=False, enable_rate_limiting=True)
        service.rate_limiter.current_delay = 0.0

        assert get(service) == ANIME
        assert service.rate_limiter.total_requests == 1
        resolve(service.close())


class TestJikanRateLimiter:
    def test_success_streak_shortens_the_delay(self):
        limiter = JikanRateLimiter(base_delay=2.0, min_delay=1.0, success_streak_threshold=2)
        limiter.record_success()
        assert limiter.current_delay == 2.0
        limiter.record_success()
        assert limiter.current_delay == pytest.approx(1.9)
        assert limiter.success_streak == 0

    def test_429_backs_off_and_sets_a_shared_cooldown(self):
        limiter = JikanRateLimiter(base_delay=1.0, max_delay=5.0)
        before = time.time()
        limiter.record_429(cooldown_hint=12.0)

        assert limiter.consecutive_429s == 1
        assert 3.0 <= limiter.current_delay <= 3.6
        assert cache.get(JIKAN_COOLDOWN_CACHE_KEY) >= before + 12.0
        assert limiter.get_stats()["total_429s"] == 1

        limiter.record_error()
        assert limiter.current_delay <= 5.0
        assert limiter.success_streak == 0

    def test_acquire_waits_out_the_shared_cooldown_and_spacing(self):
        limiter = JikanRateLimiter(base_delay=0.05, min_delay=0.05)
        cache.set(JIKAN_COOLDOWN_CACHE_KEY, time.time() + 0.05)

        started = time.monotonic()
        resolve(limiter.acquire())
        resolve(limiter.acquire())
        elapsed = time.monotonic() - started

        assert elapsed >= 0.09
        assert limiter.total_requests == 2


class TestJikanThemes:
    URL = "/anime/5/themes"

    def fetch(
        self, monkeypatch, response, *, max_retries=0, func=fetch_themes_from_jikan_with_reason
    ):
        http = install(monkeypatch, {self.URL: response})
        limiter = JikanRateLimiter(base_delay=0.0, min_delay=0.0)
        client = http_client_for(func, timeout=15.0)
        try:
            result = resolve(
                func(http_client=client, mal_id=5, rate_limiter=limiter, max_retries=max_retries)
            )
        finally:
            resolve(client.aclose() if isinstance(client, httpx.AsyncClient) else client.close())
        return result, http, limiter

    def test_success(self, monkeypatch):
        result, http, limiter = self.fetch(
            monkeypatch, {"data": {"openings": ["1: A by B"], "endings": []}}
        )

        assert result.success is True
        assert result.themes == {"openings": ["1: A by B"], "endings": []}
        assert limiter.success_streak == 1
        assert http.calls() == ["GET /anime/5/themes"]

    def test_wrapper_returns_themes_or_none(self, monkeypatch):
        themes, _, _ = self.fetch(monkeypatch, {"data": {}}, func=fetch_themes_from_jikan)
        assert themes == {"openings": [], "endings": []}

        missing, _, _ = self.fetch(
            monkeypatch, httpx.Response(404, json={}), func=fetch_themes_from_jikan
        )
        assert missing is None

    @pytest.mark.parametrize(
        ("response", "expected"),
        [
            (httpx.Response(404, json={}), ("not_found", "http_404", False)),
            (httpx.Response(422, json={}), ("invalid_variable", "http_422", False)),
            (httpx.Response(403, json={}), ("transport_error", "http_403", False)),
            (httpx.Response(429, headers={"Retry-After": "0"}), ("rate_limited", "http_429", True)),
            (httpx.Response(503), ("transport_error", "http_503", True)),
        ],
    )
    def test_failures_carry_a_reason(self, monkeypatch, response, expected):
        result, http, _ = self.fetch(monkeypatch, response)

        assert result.success is False
        assert (result.reason_code, result.message, result.transient) == expected
        assert len(http.requests) == 1

    @pytest.mark.parametrize(
        "error",
        [httpx.ConnectError("refused"), httpx.RemoteProtocolError("closed")],
    )
    def test_transport_errors_are_transient(self, monkeypatch, error):
        result, _, limiter = self.fetch(monkeypatch, sequence(error))

        assert (result.success, result.reason_code, result.transient) == (
            False,
            "transport_error",
            True,
        )
        assert result.message == str(error)
        assert limiter.current_delay > 0.0 or limiter.success_streak == 0

    def test_invalid_json_is_reported(self, monkeypatch):
        result, _, _ = self.fetch(monkeypatch, httpx.Response(200, text="nope"))

        assert (result.success, result.reason_code) == (False, "transport_error")

    def test_retries_after_429(self, monkeypatch):
        result, http, limiter = self.fetch(
            monkeypatch,
            sequence(
                httpx.Response(429, headers={"Retry-After": "0"}),
                httpx.Response(200, json={"data": {"openings": [], "endings": ["1: E"]}}),
            ),
            max_retries=1,
        )

        assert result.success is True
        assert result.themes["endings"] == ["1: E"]
        assert len(http.requests) == 2
        assert limiter.total_429s == 1


class TestImageDownloads:
    IMAGE = "https://cdn.myanimelist.net/images/anime/1/1.jpg"

    @pytest.fixture(params=[JikanService, AniListService])
    def service(self, request):
        service = request.param(enable_caching=False, enable_rate_limiting=False)
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
