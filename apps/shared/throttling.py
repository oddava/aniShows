"""Site-wide DRF rate limits that survive a cache (Redis) outage.

DRF's throttles keep their counters in the default cache. When Redis is down,
``allow_request`` raises and every API request answers 500, including pages
that never needed Redis. The two site-wide limits (``anon``, ``user``) exist to
smooth load, not to guard credentials, so they fail open: the request goes
through and the outage is logged.

The throttles that guard credentials and mail (login, sign-up, password reset,
verification, email change: ``apps/users/throttling.py``) fail closed instead:
without their counters a password could be guessed without limit, so the
request is refused with a 503, a JSON error and ``Retry-After``, never a 500.
"""

import time
from typing import NoReturn

from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle

from .errors import CACHE_ERRORS
from .logger import logger

_OUTAGE_LOG_INTERVAL_SECONDS = 60.0
_last_outage_log: dict[str, float] = {}


def warn_cache_outage(source: str, *, outcome: str = "degrading") -> None:
    """Log a cache outage at most once a minute per ``source`` (with the traceback).

    During an outage every request hits it; one line a minute says the same.
    """
    now = time.monotonic()
    if now - _last_outage_log.get(source, float("-inf")) < _OUTAGE_LOG_INTERVAL_SECONDS:
        return
    _last_outage_log[source] = now
    logger.warning("Cache unavailable (%s); %s", source, outcome, exc_info=True)


# How long a client is told to wait when a fail-closed limit cannot be checked.
RATE_LIMIT_OUTAGE_RETRY_AFTER_SECONDS = 30


class RateLimitUnavailable(APIException):
    """503 for a request whose security rate limit cannot be checked (cache down).

    DRF's exception handler turns ``wait`` into a ``Retry-After`` header, and
    ``api_exception_handler`` wraps the detail in the usual error envelope.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "This is temporarily unavailable. Please try again in a moment."
    default_code = "rate_limit_unavailable"

    def __init__(self, wait: int = RATE_LIMIT_OUTAGE_RETRY_AFTER_SECONDS):
        super().__init__()
        self.wait = wait


def refuse_on_cache_outage(source: str) -> NoReturn:
    """Log the outage (at most once a minute per source) and refuse with a 503."""
    warn_cache_outage(source, outcome="refusing the request with 503 (fails closed)")
    raise RateLimitUnavailable()


class FailClosedOnCacheErrors:
    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)  # type: ignore[misc]
        except CACHE_ERRORS:
            refuse_on_cache_outage(f"rate limit {type(self).__name__}")


class FailOpenOnCacheErrors:
    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)  # type: ignore[misc]
        except CACHE_ERRORS:
            warn_cache_outage(f"rate limit {type(self).__name__}; letting requests through")
            return True


class ResilientAnonRateThrottle(FailOpenOnCacheErrors, AnonRateThrottle):
    pass


class ResilientUserRateThrottle(FailOpenOnCacheErrors, UserRateThrottle):
    pass


class ResilientScopedRateThrottle(FailOpenOnCacheErrors, ScopedRateThrottle):
    """For non-security scopes only (e.g. a refresh button); never login or sign-up."""
