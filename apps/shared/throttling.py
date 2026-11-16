"""Site-wide DRF rate limits that survive a cache (Redis) outage.

DRF's throttles keep their counters in the default cache. When Redis is down,
``allow_request`` raises and every API request answers 500, including pages
that never needed Redis. The two site-wide limits (``anon``, ``user``) exist to
smooth load, not to guard credentials, so they fail open: the request goes
through and the outage is logged. Scoped security throttles (login, sign-up,
password reset, email change: ``apps/users/throttling.py`` and the scoped
rates) keep their own behaviour.
"""

import time

from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle

from .errors import CACHE_ERRORS
from .logger import logger

_OUTAGE_LOG_INTERVAL_SECONDS = 60.0
_last_outage_log: dict[str, float] = {}


def warn_cache_outage(source: str) -> None:
    """Log a cache outage at most once a minute per ``source`` (with the traceback).

    During an outage every request hits it; one line a minute says the same.
    """
    now = time.monotonic()
    if now - _last_outage_log.get(source, float("-inf")) < _OUTAGE_LOG_INTERVAL_SECONDS:
        return
    _last_outage_log[source] = now
    logger.warning("Cache unavailable (%s); degrading", source, exc_info=True)


class _FailOpenOnCacheErrors:
    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)  # type: ignore[misc]
        except CACHE_ERRORS:
            warn_cache_outage(f"rate limit {type(self).__name__}; letting requests through")
            return True


class ResilientAnonRateThrottle(_FailOpenOnCacheErrors, AnonRateThrottle):
    pass


class ResilientUserRateThrottle(_FailOpenOnCacheErrors, UserRateThrottle):
    pass


class ResilientScopedRateThrottle(_FailOpenOnCacheErrors, ScopedRateThrottle):
    """For non-security scopes only (e.g. a refresh button); never login or sign-up."""
