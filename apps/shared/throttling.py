"""Site-wide DRF rate limits that survive a cache (Redis) outage.

DRF's throttles keep their counters in the default cache. When Redis is down,
``allow_request`` raises and every API request answers 500, including pages
that never needed Redis. The two site-wide limits (``anon``, ``user``) exist to
smooth load, not to guard credentials, so they fail open: the request goes
through and the outage is logged. Scoped security throttles (login, sign-up,
password reset, email change: ``apps/users/throttling.py`` and the scoped
rates) keep their own behaviour.
"""

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from .errors import CACHE_ERRORS
from .logger import logger


class _FailOpenOnCacheErrors:
    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)  # type: ignore[misc]
        except CACHE_ERRORS:
            logger.warning(
                "Rate-limit cache unavailable; letting the request through (%s)",
                type(self).__name__,
                exc_info=True,
            )
            return True


class ResilientAnonRateThrottle(_FailOpenOnCacheErrors, AnonRateThrottle):
    pass


class ResilientUserRateThrottle(_FailOpenOnCacheErrors, UserRateThrottle):
    pass
