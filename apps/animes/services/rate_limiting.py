"""
Rate limiting and circuit breaker utilities for AniList API.
Optimized for small EC2 instances with minimal Redis overhead.
"""

import asyncio
import time
import logging
from functools import wraps
from datetime import datetime
from typing import Optional, Callable, Any
from django.core.cache import cache

logger = logging.getLogger(__name__)


class AniListRateLimiter:
    """
    Distributed rate limiter using Redis for multi-worker coordination.
    AniList allows 90 requests per minute per IP.

    Optimized for small EC2 instances:
    - Minimal Redis operations
    - Local caching to reduce Redis load
    - Conservative rate limiting
    """

    RATE_LIMIT = 85  # Stay well under the 90 limit
    WINDOW_SECONDS = 60
    SAFETY_MARGIN = 5

    def __init__(self):
        self.min_delay = self.WINDOW_SECONDS / (self.RATE_LIMIT - self.SAFETY_MARGIN)
        self._local_last_request = 0
        self._local_count = 0

    def _get_current_window_key(self) -> str:
        """Get Redis key for current minute window."""
        current_minute = int(time.time()) // self.WINDOW_SECONDS
        return f"anilist:rate:{current_minute}"

    async def acquire(self) -> None:
        """
        Acquire permission to make an API request.
        Blocks until it's safe to proceed.
        """
        while True:
            # Local throttling first (faster, no Redis call)
            now = time.time()
            time_since_last = now - self._local_last_request

            if time_since_last < self.min_delay:
                wait_time = self.min_delay - time_since_last
                await asyncio.sleep(wait_time)
                continue

            # Check global rate limit via Redis
            current_key = self._get_current_window_key()

            try:
                # Use pipeline for atomic operation
                redis_client = cache.client.get_client()
                pipe = redis_client.pipeline()
                pipe.incr(current_key)
                pipe.expire(current_key, self.WINDOW_SECONDS + 10)
                results = await asyncio.to_thread(pipe.execute)
                count = results[0]

                if count <= self.RATE_LIMIT - self.SAFETY_MARGIN:
                    self._local_last_request = time.time()
                    return

                # Rate limit hit, wait until next window
                logger.warning(f"Rate limit approaching: {count}/{self.RATE_LIMIT} requests")
                await asyncio.sleep(1)

            except Exception as e:
                # Redis failure - fall back to local rate limiting
                logger.error(f"Redis rate limiter failed: {e}. Using local fallback.")
                if time_since_last >= self.min_delay:
                    self._local_last_request = time.time()
                    return
                await asyncio.sleep(self.min_delay)


class CircuitBreaker:
    """
    Circuit breaker pattern for external API calls.
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

        except Exception as e:
            logger.error(f"Circuit breaker check failed: {e}")
            return False  # Fail open on error

    def record_success(self) -> None:
        """Record a successful API call."""
        try:
            state = cache.get(self._get_state_key())
            if state == "HALF_OPEN":
                # Recovery successful - close the circuit
                cache.set(self._get_state_key(), "CLOSED", self.recovery_timeout)
                cache.set(self._get_failures_key(), 0, self.recovery_timeout)
                logger.info(f"Circuit breaker {self.name} CLOSED - service recovered")
            else:
                # Just reset failure count
                cache.set(self._get_failures_key(), 0, self.recovery_timeout)
        except Exception as e:
            logger.error(f"Failed to record success: {e}")

    def record_failure(self) -> None:
        """Record a failed API call."""
        try:
            failures = (cache.get(self._get_failures_key()) or 0) + 1
            cache.set(self._get_failures_key(), failures, self.recovery_timeout)
            cache.set(self._get_last_failure_key(), datetime.now(), self.recovery_timeout)

            state = cache.get(self._get_state_key())

            if state == "HALF_OPEN" or failures >= self.failure_threshold:
                cache.set(self._get_state_key(), "OPEN", self.recovery_timeout)
                logger.critical(
                    f"Circuit breaker {self.name} OPENED after {failures} failures. "
                    f"API calls will fail fast for {self.recovery_timeout}s"
                )

        except Exception as e:
            logger.error(f"Failed to record failure: {e}")


class APICallCache:
    """
    Cache for API responses to prevent duplicate calls.
    Optimized for EC2 instances with configurable TTL.
    """

    def __init__(self, ttl: int = 1800):  # 30 minutes default
        self.ttl = ttl

    def _get_cache_key(self, endpoint: str, params: str) -> str:
        """Generate cache key from endpoint and params."""
        return f"api:cache:{endpoint}:{hash(params) & 0xFFFFFFFF}"

    def _get_recent_key(self, anilist_id: int) -> str:
        return f"api:recent:{anilist_id}"

    def get(self, endpoint: str, params: str) -> Optional[Any]:
        """Get cached API response if available."""
        try:
            return cache.get(self._get_cache_key(endpoint, params))
        except Exception:
            return None

    def set(self, endpoint: str, params: str, value: Any) -> None:
        """Cache API response."""
        try:
            cache.set(self._get_cache_key(endpoint, params), value, self.ttl)
        except Exception as e:
            logger.warning(f"Failed to cache API response: {e}")

    def is_recently_updated(self, anilist_id: int, window: int = 1800) -> bool:
        """Check if anime was updated within the window (seconds)."""
        try:
            return cache.get(self._get_recent_key(anilist_id)) is not None
        except Exception:
            return False

    def mark_updated(self, anilist_id: int, window: int = 1800) -> None:
        """Mark anime as recently updated."""
        try:
            cache.set(self._get_recent_key(anilist_id), True, window)
        except Exception:
            pass

    def invalidate(self, anilist_id: int) -> None:
        """Invalidate cache for specific anime."""
        try:
            cache.delete(self._get_recent_key(anilist_id))
        except Exception:
            pass


def circuit_breaker_protected(
    name: str, failure_threshold: int = 5, recovery_timeout: int = 300
) -> Callable:
    """
    Decorator to protect functions with circuit breaker pattern.

    Usage:
        @circuit_breaker_protected("anilist_api")
        async def fetch_anime_data(anime_id):
            # API call here
            pass
    """
    breaker = CircuitBreaker(name, failure_threshold, recovery_timeout)

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            if breaker.is_open():
                raise Exception(f"Circuit breaker {name} is OPEN")

            try:
                result = await func(*args, **kwargs)
                breaker.record_success()
                return result
            except Exception as e:
                breaker.record_failure()
                raise

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            if breaker.is_open():
                raise Exception(f"Circuit breaker {name} is OPEN")

            try:
                result = func(*args, **kwargs)
                breaker.record_success()
                return result
            except Exception as e:
                breaker.record_failure()
                raise

        # Return appropriate wrapper based on function type
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator
