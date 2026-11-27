import os
import socket

import httpx
import pytest
import requests
from django.conf import settings
from django.core.cache import cache


def pytest_collection_modifyitems(config, items):
    """Run one shard of the suite when PYTEST_SHARD is set ("2/3": the second of three).

    CI runs the shards as parallel jobs. Every nth test in collection order goes to
    the same shard, so the slow modules spread across all of them; the order is
    deterministic, so each xdist worker keeps the same slice.
    """
    shard = os.environ.get("PYTEST_SHARD")
    if not shard:
        return
    index, total = (int(part) for part in shard.split("/"))
    kept = items[index - 1 :: total]
    kept_ids = {id(item) for item in kept}
    config.hook.pytest_deselected(items=[item for item in items if id(item) not in kept_ids])
    items[:] = kept


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

    Signals and eager Celery tasks call AniList; without this, tests hang
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
    # psycopg 3 resolves the database host in Python (psycopg2 did it inside
    # libpq), so the configured database hosts must stay resolvable.
    allowed_hosts = {"localhost", "127.0.0.1", "::1", None}
    allowed_hosts.update(db.get("HOST") for db in settings.DATABASES.values())

    def local_only_getaddrinfo(host, *args, **kwargs):
        # Code under test resolves user-supplied hosts (URL validation); that
        # must not depend on the runner's DNS. Patch the resolver in tests.
        if host in allowed_hosts:
            return real_getaddrinfo(host, *args, **kwargs)
        raise socket.gaierror(socket.EAI_NONAME, "DNS is disabled in tests")

    monkeypatch.setattr(socket, "getaddrinfo", local_only_getaddrinfo)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", blocked_async)
    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", blocked_requests)
