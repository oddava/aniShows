import socket

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
    """Fail real outbound HTTP and DNS immediately, as if offline.

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

    real_getaddrinfo = socket.getaddrinfo

    def local_only_getaddrinfo(host, *args, **kwargs):
        # Code under test resolves user-supplied hosts (URL validation); that
        # must not depend on the runner's DNS. Patch the resolver in tests.
        if host in ("localhost", "127.0.0.1", "::1", None):
            return real_getaddrinfo(host, *args, **kwargs)
        raise socket.gaierror(socket.EAI_NONAME, "DNS is disabled in tests")

    monkeypatch.setattr(socket, "getaddrinfo", local_only_getaddrinfo)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", blocked_async)
    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", blocked_requests)
