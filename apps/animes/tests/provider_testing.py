"""Helpers for driving the catalog providers in tests.

Phase 4 moves the providers from async to sync (decision D4). These helpers
work against either style, so the golden tests in ``test_provider_golden.py``
can run unchanged before and after that change:

- ``resolve`` returns a provider call's result, awaiting it if it is a coroutine.
- ``ProviderHTTP`` routes every httpx client, sync or async and however it was
  built, through one ``httpx.MockTransport`` that serves recorded payloads.
- ``fake_method`` replaces a provider method with one returning canned data,
  matching the method's sync/async style.
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

import httpx
from asgiref.sync import async_to_sync

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "providers"

# Recorded Jikan responses by path (and page), relative to the Jikan base URL.
JIKAN_ROUTES = {
    "/anime/52991/full": "jikan/anime_52991_full.json",
    "/anime/52991": "jikan/anime_52991_full.json",
    "/anime/52991/characters": "jikan/anime_52991_characters.json",
    "/anime/52991/staff": "jikan/anime_52991_staff.json",
    "/anime/52991/themes": "jikan/anime_52991_themes.json",
    "/anime/52991/statistics": "jikan/anime_52991_statistics.json",
    "/anime/52991/videos/episodes": "jikan/anime_52991_videos_episodes.json",
    "/anime/52991/recommendations": "jikan/anime_52991_recommendations.json",
    "/anime/21/full": "jikan/anime_21_full.json",
    "/anime/21": "jikan/anime_21_full.json",
    "/anime/21/characters": {"data": []},
    "/anime/21/themes": {"data": {"openings": [], "endings": []}},
    "/anime/21/statistics": "jikan/anime_21_statistics.json",
    ("/anime/21/episodes", "1"): "jikan/anime_21_episodes_page1.json",
    ("/anime/21/episodes", "2"): "jikan/anime_21_episodes_page2.json",
    ("/seasons/now", "1"): "jikan/seasons_now_page1.json",
    ("/seasons/now", "2"): "jikan/seasons_now_page2.json",
    ("/top/anime", "1"): "jikan/top_airing_page1.json",
    "/anime": "jikan/anime_search_frieren.json",
}


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def resolve(value):
    """Return ``value``, or what it evaluates to when it is awaitable."""
    if inspect.isawaitable(value):

        async def _await():
            return await value

        return async_to_sync(_await)()
    return value


def styled_like(reference, func):
    """Wrap ``func`` as a coroutine function when ``reference`` is one."""
    if inspect.iscoroutinefunction(reference):

        async def replacement(*args, **kwargs):
            return func(*args, **kwargs)

    else:

        def replacement(*args, **kwargs):
            return func(*args, **kwargs)

    return replacement


def fake_method(obj, name: str, func):
    """Replace ``obj.name`` with ``func``, wrapped as a coroutine if the original is one."""
    replacement = styled_like(getattr(type(obj), name), func)
    setattr(obj, name, replacement)
    return replacement


def http_client_for(func, **kwargs):
    """An httpx client of the kind ``func`` takes: async for a coroutine function."""
    if inspect.iscoroutinefunction(func):
        return httpx.AsyncClient(**kwargs)
    return httpx.Client(**kwargs)


class ProviderHTTP:
    """A MockTransport serving fixtures by path (and ``page`` query param).

    ``routes`` maps ``path`` or ``(path, page)`` to a fixture file name, a
    ``(status, body)`` tuple, a dict body, or a callable taking the request.
    Paths are relative to ``base_url``. Unrouted requests get a Jikan-style 404.
    """

    def __init__(self, routes: dict, *, base_url: str = ""):
        self.routes = routes
        self.base_url = base_url.rstrip("/")
        self.requests: list[httpx.Request] = []
        self.transport = httpx.MockTransport(self._handle)

    def install(self, monkeypatch) -> ProviderHTTP:
        transport = self.transport

        def handle_request(_self, request):
            return transport.handle_request(request)

        async def handle_async_request(_self, request):
            return await transport.handle_async_request(request)

        monkeypatch.setattr(httpx.HTTPTransport, "handle_request", handle_request)
        monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", handle_async_request)
        return self

    def relative_path(self, request: httpx.Request) -> str:
        url = str(request.url).split("?", 1)[0]
        if self.base_url and url.startswith(self.base_url):
            return url[len(self.base_url) :] or "/"
        return url

    def calls(self) -> list[str]:
        """Requests made so far as sorted ``path?query`` strings (order-independent)."""
        rendered = []
        for request in self.requests:
            query = sorted(parse_qsl(request.url.query.decode()))
            suffix = "&".join(f"{key}={value}" for key, value in query)
            path = self.relative_path(request)
            rendered.append(
                f"{request.method} {path}?{suffix}" if suffix else f"{request.method} {path}"
            )
        return sorted(rendered)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = self.relative_path(request)
        page = request.url.params.get("page")
        route = self.routes.get((path, page), self.routes.get(path))
        if callable(route):
            route = route(request)
        if isinstance(route, httpx.Response):
            # A fresh copy: a route may answer several requests.
            return httpx.Response(route.status_code, headers=route.headers, content=route.content)
        if route is None:
            return httpx.Response(404, json=load_fixture("jikan/not_found.json"))
        status = 200
        if isinstance(route, tuple):
            status, route = route
        if isinstance(route, str):
            route = load_fixture(route)
        return httpx.Response(status, json=route)
