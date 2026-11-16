"""Structured logging and redaction for production (stdlib only).

``JsonFormatter`` writes one JSON object per line, so ``docker logs`` and any
log shipper get the level, logger, request id and every ``extra={...}`` key as
fields. ``RequestIdFilter`` adds the id that ``root.request_id`` stores for the
current request (or Celery task context). The ``redact_*`` and ``scrub_*``
helpers keep account tokens and credentials out of logs and Sentry.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from root.request_id import get_request_id

# Attributes every LogRecord has; anything else came from ``extra=``.
_RESERVED_ATTRS = frozenset(
    vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()
    | {"message", "asctime", "request_id", "taskName"}
)

MAX_LINE_BYTES = 16 * 1024
_TRUNCATED_SUFFIX = "...[truncated]"

# Account links carry their secret in the path (G1 A14):
#   /reset-password/<uid>/<token>/, /verify-email/<uid>/<token>/,
#   /confirm-email-change/<uid>/<token>/<new_email>/ and the API forms.
_TOKEN_PATH_RE = re.compile(
    r"(/(?:reset-password|password-reset-confirm|verify-email|confirm-email-change|"
    r"email-change|activate)/)[^?#\s\"']+",
    re.IGNORECASE,
)
_SECRET_QUERY_RE = re.compile(
    r"([?&](?:token|uid|key|code|signature|password|secret|access|refresh)=)[^&#\s\"']*",
    re.IGNORECASE,
)
REDACTED = "<redacted>"

SENSITIVE_HEADERS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-csrftoken",
        "x-api-key",
    }
)


def redact_url(value: str) -> str:
    """Hide tokens in account-link paths and secret-looking query values."""
    if not value:
        return value
    value = _TOKEN_PATH_RE.sub(lambda m: m.group(1) + REDACTED, value)
    return _SECRET_QUERY_RE.sub(lambda m: m.group(1) + REDACTED, value)


class RequestIdFilter(logging.Filter):
    """Attach the current request id (``"-"`` outside a request)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.request_id = get_request_id() or "-"
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, logger, message, request_id, extras."""

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_url(message),
            "request_id": getattr(record, "request_id", None) or get_request_id() or "-",
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED_ATTRS or key.startswith("_") or key in payload:
                continue
            payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        elif record.exc_text:
            payload["exc_info"] = record.exc_text
        if record.stack_info:
            payload["stack_info"] = self.formatStack(record.stack_info)

        # default=str: datetimes, Decimals, model instances, ... never raise.
        # json.dumps escapes newlines, so a traceback stays on one line.
        line = json.dumps(payload, default=str, ensure_ascii=False)
        if len(line.encode("utf-8")) > MAX_LINE_BYTES:
            line = self._truncated(payload)
        return line

    @staticmethod
    def _truncated(payload: dict[str, Any]) -> str:
        """Keep the envelope intact; shorten the largest text fields."""
        keep = {k: payload[k] for k in ("ts", "level", "logger", "request_id") if k in payload}
        budget = MAX_LINE_BYTES // 2
        keep["message"] = str(payload.get("message", ""))[:budget] + _TRUNCATED_SUFFIX
        if "exc_info" in payload:
            keep["exc_info"] = str(payload["exc_info"])[-budget // 2 :]
        keep["truncated"] = True
        line = json.dumps(keep, default=str, ensure_ascii=False)
        encoded = line.encode("utf-8")
        if len(encoded) > MAX_LINE_BYTES:  # multi-byte text: hard cut, still valid JSON
            keep["message"] = keep["message"][: MAX_LINE_BYTES // 8] + _TRUNCATED_SUFFIX
            keep.pop("exc_info", None)
            line = json.dumps(keep, default=str, ensure_ascii=False)
        return line


# ---------------------------------------------------------------------------
# Sentry hooks (pure functions; registered in root/settings/production.py)
# ---------------------------------------------------------------------------


def _scrub_headers(headers: Any) -> Any:
    if isinstance(headers, Mapping):
        return {
            name: value
            for name, value in headers.items()
            if str(name).lower() not in SENSITIVE_HEADERS
        }
    if isinstance(headers, list):  # [[name, value], ...]
        return [
            pair
            for pair in headers
            if not (
                isinstance(pair, list | tuple)
                and pair
                and str(pair[0]).lower() in SENSITIVE_HEADERS
            )
        ]
    return headers


def redact_query(query: str) -> str:
    """``redact_url`` for a bare query string (no leading ``?``)."""
    return redact_url("?" + query)[1:] if query else query


def _scrub_request(request: dict[str, Any]) -> None:
    if isinstance(request.get("url"), str):
        request["url"] = redact_url(request["url"])
    if isinstance(request.get("query_string"), str):
        request["query_string"] = redact_query(request["query_string"])
    if "headers" in request:
        request["headers"] = _scrub_headers(request["headers"])
    request.pop("cookies", None)


def scrub_sentry_event(event: dict[str, Any]) -> dict[str, Any]:
    """Remove account tokens and credentials from an event before it is sent."""
    request = event.get("request")
    if isinstance(request, dict):
        _scrub_request(request)
    for key in ("transaction", "culprit", "message"):
        if isinstance(event.get(key), str):
            event[key] = redact_url(event[key])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if isinstance(logentry.get(key), str):
                logentry[key] = redact_url(logentry[key])
    breadcrumbs = event.get("breadcrumbs")
    values = breadcrumbs.get("values") if isinstance(breadcrumbs, dict) else breadcrumbs
    if isinstance(values, list):
        for crumb in values:
            if isinstance(crumb, dict):
                scrub_sentry_breadcrumb(crumb)
    return event


def scrub_sentry_breadcrumb(crumb: dict[str, Any]) -> dict[str, Any]:
    """Redact URLs and drop auth headers in HTTP/navigation breadcrumbs."""
    if isinstance(crumb.get("message"), str):
        crumb["message"] = redact_url(crumb["message"])
    data = crumb.get("data")
    if isinstance(data, dict):
        for key in ("url", "from", "to"):
            if isinstance(data.get(key), str):
                data[key] = redact_url(data[key])
        if isinstance(data.get("http.query"), str):
            data["http.query"] = redact_query(data["http.query"])
        for key in list(data):
            if str(key).lower() in SENSITIVE_HEADERS:
                data.pop(key)
        if "headers" in data:
            data["headers"] = _scrub_headers(data["headers"])
    return crumb
