"""Per-request correlation id for logs (production only).

``RequestIdMiddleware`` takes the id from Cloudflare's ``CF-Ray`` (so a log
line can be matched to Cloudflare's own logs), else from ``X-Request-ID``,
else generates one. It stores it in a contextvar that
``root.log_formatting.RequestIdFilter`` reads, and echoes it in the
``X-Request-ID`` response header. Client-supplied values are accepted only
when short and plain, so a header can never inject text into a log line.

``root/settings/production.py`` puts it first in ``MIDDLEWARE``, so every
later middleware and view logs with the id.
"""

from __future__ import annotations

import re
import uuid
from contextvars import ContextVar, Token

from asgiref.sync import iscoroutinefunction, markcoroutinefunction

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

_VALID_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
# Header names in request.META form, in order of preference.
_SOURCE_HEADERS = ("HTTP_CF_RAY", "HTTP_X_REQUEST_ID")
RESPONSE_HEADER = "X-Request-ID"


def get_request_id() -> str | None:
    return _request_id.get()


def set_request_id(value: str | None) -> Token:
    return _request_id.set(value)


def reset_request_id(token: Token) -> None:
    _request_id.reset(token)


def request_id_from_meta(meta) -> str:
    """The incoming id when it is well-formed, else a new random one."""
    for header in _SOURCE_HEADERS:
        candidate = (meta.get(header) or "").strip()
        if candidate and _VALID_ID.match(candidate):
            return candidate
    return uuid.uuid4().hex


class RequestIdMiddleware:
    sync_capable = True
    async_capable = True

    def __init__(self, get_response):
        self.get_response = get_response
        self._is_async = iscoroutinefunction(get_response)
        if self._is_async:
            markcoroutinefunction(self)

    def __call__(self, request):
        if self._is_async:
            return self.__acall__(request)
        request_id = request_id_from_meta(request.META)
        request.request_id = request_id
        token = set_request_id(request_id)
        try:
            response = self.get_response(request)
        finally:
            reset_request_id(token)
        response[RESPONSE_HEADER] = request_id
        return response

    async def __acall__(self, request):
        request_id = request_id_from_meta(request.META)
        request.request_id = request_id
        token = set_request_id(request_id)
        try:
            response = await self.get_response(request)
        finally:
            reset_request_id(token)
        response[RESPONSE_HEADER] = request_id
        return response
