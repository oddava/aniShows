from ...shared.logger import logger

"""
Rate limiting and circuit breaker utilities for AniList API.
Optimized for small EC2 instances with minimal Redis overhead.
"""

import contextlib
import hashlib
import time
from datetime import datetime
from typing import Any

from django.conf import settings
from django.core.cache import cache

from ...shared.errors import CACHE_ERRORS

# Reading the shared pause value: the cache can fail, or hold something odd.
_PAUSE_ERRORS: tuple[type[Exception], ...] = (TypeError, ValueError, *CACHE_ERRORS)
# Breaker state: the cache can fail, or hold a value of the wrong type.
_STATE_ERRORS: tuple[type[Exception], ...] = (TypeError, *CACHE_ERRORS)


class AniListRateLimiter:
    """Distributed rate limiter using Redis for multi-worker coordination.

    AniList documents 90 requests per minute per IP but has run in a degraded
    mode at 30; ``ANILIST_RATE_LIMIT_PER_MINUTE`` sets the limit (default 30).
    Every worker counts against one per-minute Redis counter, keeping a 10%
    margin under the limit, and background callers also space their own
    requests. A 429 from AniList pauses every worker (``pause``), not only the
    one that got it.
    """

    WINDOW_SECONDS = 60
    # Requests made while a user waits may use only this share of a minute's
    # budget, so web traffic (a crawler walking detail pages) cannot starve
    # the background sync that keeps the catalog fresh.
    INTERACTIVE_SHARE = 0.5
    PAUSE_KEY = "anilist:paused_until"
    # How long to sleep before asking again when this minute's slots are gone.
    FULL_WINDOW_RETRY_SECONDS = 1.0

    def __init__(self, rate_limit: int | None = None):
        limit = rate_limit or settings.ANILIST_RATE_LIMIT_PER_MINUTE
        self.rate_limit = max(int(limit), 1)
        self.safety_margin = max(self.rate_limit // 10, 1) if self.rate_limit > 1 else 0
        self.min_delay = self.WINDOW_SECONDS / (self.rate_limit - self.safety_margin)
        self._local_last_request = 0.0

    def _get_current_window_key(self) -> str:
        """Get Redis key for current minute window."""
        current_minute = int(time.time()) // self.WINDOW_SECONDS
        return f"anilist:rate:{current_minute}"

    def acquire(self, max_wait: float | None = None) -> bool:
        """Wait for a request slot; False if none is free within ``max_wait`` seconds.

        ``max_wait=None`` (background tasks) waits as long as needed and keeps
        this process's requests spaced out. A bounded wait (requests made while
        a user waits) skips the spacing and gives up instead of holding the
        web worker; the caller reports it as rate limited.
        """
        deadline = None if max_wait is None else time.monotonic() + max(max_wait, 0.0)

        def can_wait(seconds: float) -> bool:
            return deadline is None or time.monotonic() + seconds <= deadline

        while True:
            wait = self._paused_for()
            if max_wait is None:
                wait = max(wait, self.min_delay - (time.time() - self._local_last_request))
            if wait > 0:
                if not can_wait(wait):
                    return False
                time.sleep(wait)
                continue

            if self._take_shared_slot(interactive=max_wait is not None):
                self._local_last_request = time.time()
                return True

            logger.warning("AniList rate limit reached for this minute (%s/min)", self.rate_limit)
            if not can_wait(self.FULL_WINDOW_RETRY_SECONDS):
                return False
            time.sleep(self.FULL_WINDOW_RETRY_SECONDS)

    def _take_shared_slot(self, *, interactive: bool = False) -> bool:
        """Count one request against this minute's shared budget; False if it is used up.

        An interactive caller only gets a slot while the minute's count is
        under its share; a refused interactive try gives its count back.
        """
        current_key = self._get_current_window_key()
        cache_client = getattr(cache, "client", None)
        if cache_client is None:
            # A cache backend without a raw Redis client (tests, local
            # development): only this process's spacing applies.
            return True
        redis_client = cache_client.get_client()
        budget = self.rate_limit - self.safety_margin
        if interactive:
            budget = max(int(budget * self.INTERACTIVE_SHARE), 1)
        try:
            pipe = redis_client.pipeline()
            pipe.incr(current_key)
            pipe.expire(current_key, self.WINDOW_SECONDS + 10)
            count = pipe.execute()[0]
            if count <= budget:
                return True
            if interactive:
                redis_client.decr(current_key)
            return False
        except CACHE_ERRORS:
            logger.warning(
                "Redis rate limiter unavailable; using local spacing only", exc_info=True
            )
            return True

    def _paused_for(self) -> float:
        """Seconds left on a pause set after a 429 by any worker."""
        try:
            paused_until = float(cache.get(self.PAUSE_KEY) or 0.0)
        except _PAUSE_ERRORS:
            return 0.0
        return max(paused_until - time.time(), 0.0)

    def pause(self, seconds: float) -> None:
        """Stop every worker's requests for ``seconds`` (AniList answered 429)."""
        if seconds <= 0:
            return
        until = time.time() + seconds
        with contextlib.suppress(*_PAUSE_ERRORS):
            if until > float(cache.get(self.PAUSE_KEY) or 0.0):
                cache.set(self.PAUSE_KEY, until, timeout=int(seconds) + 5)


class CircuitBreaker:
    """Circuit breaker pattern for external API calls.
    Prevents cascading failures when API is down.

    States:
    - CLOSED: Normal operation
    - OPEN: Failing fast, no API calls
    - HALF_OPEN: Testing if service recovered
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: int = 300,  # 5 minutes
        half_open_max_calls: int = 3,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls

    def _get_state_key(self) -> str:
        return f"cb:{self.name}:state"

    def _get_failures_key(self) -> str:
        return f"cb:{self.name}:failures"

    def _get_last_failure_key(self) -> str:
        return f"cb:{self.name}:last_failure"

    def _get_half_open_calls_key(self) -> str:
        return f"cb:{self.name}:half_open_calls"

    def is_open(self) -> bool:
        """Check if circuit is open (failing fast)."""
        try:
            state = cache.get(self._get_state_key())

            if state == "OPEN":
                # Check if we should try half-open
                last_failure = cache.get(self._get_last_failure_key())
                if last_failure:
                    elapsed = (datetime.now() - last_failure).total_seconds()
                    if elapsed >= self.recovery_timeout:
                        # Try half-open state
                        cache.set(self._get_state_key(), "HALF_OPEN", self.recovery_timeout)
                        cache.set(self._get_half_open_calls_key(), 0, self.recovery_timeout)
                        from .metrics import update_circuit_breaker_state

                        update_circuit_breaker_state(self.name, "HALF_OPEN")
                        logger.info(f"Circuit breaker {self.name} entering HALF_OPEN state")
                        return False
                return True

            elif state == "HALF_OPEN":
                # Allow limited calls in half-open state
                calls = cache.get(self._get_half_open_calls_key()) or 0
                if calls < self.half_open_max_calls:
                    cache.set(
                        self._get_half_open_calls_key(),
                        calls + 1,
                        self.recovery_timeout,
                    )
                    return False
                return True  # Max calls reached, wait for next cycle

            return False  # CLOSED state - normal operation

        except _STATE_ERRORS:
            # TypeError: a last-failure value that is not a datetime.
            logger.exception("Circuit breaker check failed")
            return False  # Fail open on error

    def record_success(self) -> None:
        """Record a successful API call."""
        try:
            state = cache.get(self._get_state_key())
            if state == "HALF_OPEN":
                # Recovery successful - close the circuit
                cache.set(self._get_state_key(), "CLOSED", self.recovery_timeout)
                cache.set(self._get_failures_key(), 0, self.recovery_timeout)
                from .metrics import update_circuit_breaker_state

                update_circuit_breaker_state(self.name, "CLOSED")
                logger.info(f"Circuit breaker {self.name} CLOSED - service recovered")
            else:
                # Just reset failure count
                cache.set(self._get_failures_key(), 0, self.recovery_timeout)
        except CACHE_ERRORS:
            logger.exception("Failed to record circuit breaker success")

    def record_failure(self) -> None:
        """Record a failed API call."""
        try:
            failures = (cache.get(self._get_failures_key()) or 0) + 1
            cache.set(self._get_failures_key(), failures, self.recovery_timeout)
            cache.set(self._get_last_failure_key(), datetime.now(), self.recovery_timeout)

            state = cache.get(self._get_state_key())

            if state == "HALF_OPEN" or failures >= self.failure_threshold:
                cache.set(self._get_state_key(), "OPEN", self.recovery_timeout)
                from .metrics import update_circuit_breaker_state

                update_circuit_breaker_state(self.name, "OPEN")
                logger.critical(
                    f"Circuit breaker {self.name} OPENED after {failures} failures. "
                    f"API calls will fail fast for {self.recovery_timeout}s"
                )

        except _STATE_ERRORS:
            # TypeError: a failure counter that is not a number.
            logger.exception("Failed to record circuit breaker failure")


class APICallCache:
    """Cache for API responses to prevent duplicate calls.
    Optimized for EC2 instances with configurable TTL.
    """

    def __init__(self, ttl: int = 1800):  # 30 minutes default
        self.ttl = ttl

    def _get_cache_key(self, endpoint: str, params: str) -> str:
        """Cache key from endpoint and params.

        A digest, not ``hash()``: string hashes are salted per process, so
        workers would never share an entry.
        """
        digest = hashlib.sha256(params.encode("utf-8")).hexdigest()[:32]
        return f"api:cache:{endpoint}:{digest}"

    def _get_recent_key(self, anilist_id: int | str) -> str:
        return f"api:recent:{anilist_id}"

    def get(self, endpoint: str, params: str) -> Any | None:
        """Get cached API response if available."""
        try:
            return cache.get(self._get_cache_key(endpoint, params))
        except CACHE_ERRORS:
            return None

    def set(self, endpoint: str, params: str, value: Any) -> None:
        """Cache API response."""
        try:
            cache.set(self._get_cache_key(endpoint, params), value, self.ttl)
        except CACHE_ERRORS:
            logger.warning("Failed to cache API response", exc_info=True)

    def is_recently_updated(self, anilist_id: int | str, window: int = 1800) -> bool:
        """Check if anime was updated within the window (seconds)."""
        try:
            return cache.get(self._get_recent_key(anilist_id)) is not None
        except CACHE_ERRORS:
            return False

    def mark_updated(self, anilist_id: int | str, window: int = 1800) -> None:
        """Mark anime as recently updated."""
        with contextlib.suppress(*CACHE_ERRORS):
            cache.set(self._get_recent_key(anilist_id), True, window)

    def invalidate(self, anilist_id: int | str) -> None:
        """Invalidate cache for specific anime."""
        with contextlib.suppress(*CACHE_ERRORS):
            cache.delete(self._get_recent_key(anilist_id))
