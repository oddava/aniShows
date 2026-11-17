"""Helpers for driving the AniList provider in tests.

- ``resolve`` returns a provider call's result, awaiting it if it is a coroutine.
- ``ProviderHTTP`` routes every httpx client, sync or async and however it was
  built, through one ``httpx.MockTransport`` that serves canned responses by URL.
- ``AniListGraphQL`` does the same for AniList's single GraphQL endpoint,
  routing each POST by its GraphQL operation name.
- ``fake_method`` replaces a provider method with one returning canned data,
  matching the method's sync/async style.
"""

from __future__ import annotations

import inspect
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

import httpx
from asgiref.sync import async_to_sync

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "providers"

ANILIST_NOT_FOUND = {"errors": [{"message": "Not Found.", "status": 404}], "data": {"Media": None}}

_OPERATION_NAME = re.compile(r"query\s+(\w+)")


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


def sequence(*steps):
    """A route answering with each step in turn (a Response, a body, or an exception).

    The last step repeats once the others are used up.
    """
    remaining = list(steps)

    def route(*_request):
        step = remaining.pop(0) if len(remaining) > 1 else remaining[0]
        if isinstance(step, Exception):
            raise step
        return step

    return route


def _copy(response: httpx.Response) -> httpx.Response:
    # A fresh copy: a route may answer several requests.
    return httpx.Response(response.status_code, headers=response.headers, content=response.content)


class ProviderHTTP:
    """A MockTransport serving canned responses by path (and ``page`` query param).

    ``routes`` maps ``path`` or ``(path, page)`` to a fixture file name, a
    ``(status, body)`` tuple, a dict body, an ``httpx.Response``, or a callable
    taking the request. Paths are relative to ``base_url``. Unrouted requests
    get a 404.
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
            return _copy(route)
        if route is None:
            return httpx.Response(404, json={"message": "Not Found"})
        status = 200
        if isinstance(route, tuple):
            status, route = route
        if isinstance(route, str):
            route = load_fixture(route)
        return httpx.Response(status, json=route)


def graphql_body(request: httpx.Request) -> dict:
    return json.loads(request.content or b"{}")


def operation_name(query: str) -> str:
    match = _OPERATION_NAME.search(query or "")
    return match.group(1) if match else "anonymous"


class AniListGraphQL(ProviderHTTP):
    """A MockTransport for AniList: POSTs routed by GraphQL operation name.

    ``routes`` maps an operation name (``GetAnimeById``...) to:

    - a dict: the response's ``data`` object (served as ``{"data": ...}``),
    - a fixture file name (its JSON is the ``data`` object),
    - an ``httpx.Response``, served as is,
    - a callable taking ``(variables, request)`` and returning any of these.

    Unrouted operations get AniList's 404 ("Not Found.").
    """

    def operations(self) -> list[tuple[str, dict]]:
        """(operation name, variables) of each request, in order."""
        result = []
        for request in self.requests:
            body = graphql_body(request)
            result.append((operation_name(body.get("query", "")), body.get("variables") or {}))
        return result

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = graphql_body(request)
        route = self.routes.get(operation_name(body.get("query", "")))
        if callable(route):
            route = route(body.get("variables") or {}, request)
        if isinstance(route, httpx.Response):
            return _copy(route)
        if route is None:
            return httpx.Response(404, json=ANILIST_NOT_FOUND)
        if isinstance(route, str):
            route = load_fixture(route)
        return httpx.Response(200, json={"data": route})
