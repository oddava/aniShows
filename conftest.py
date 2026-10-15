import httpx
import pytest
import requests
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Start every test with an empty cache.

    The test settings use one in-process LocMemCache, so cached responses and
    throttle counters would otherwise leak between tests.
    """
    cache.clear()


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Fail real outbound HTTP immediately, as if offline.

    Signals and eager Celery tasks call AniList/Jikan; without this, tests hang
    on network timeouts or depend on live APIs. Tests that need HTTP should mock
    it (e.g. httpx.MockTransport, which is not affected).
    """

    def blocked(self, request, *args, **kwargs):
        raise httpx.ConnectError("Network access is disabled in tests", request=request)

    async def blocked_async(self, request, *args, **kwargs):
        raise httpx.ConnectError("Network access is disabled in tests", request=request)

    def blocked_requests(self, request, *args, **kwargs):
        raise requests.ConnectionError("Network access is disabled in tests", request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", blocked_async)
    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", blocked_requests)
