"""
Circuit Breaker pattern implementation for external API calls.

Provides protection against cascading failures when external services are down.

Features:
- Automatic failure detection and circuit opening
- Gradual recovery with health checks
- Decorator for easy integration with existing functions
- Redis-backed state storage for distributed systems
"""

import asyncio
import functools
import logging
import time
from enum import Enum
from typing import Optional, Callable, Any
from django.core.cache import cache

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered


class CircuitBreaker:
    """
    Circuit breaker for protecting external API calls.

    Automatically opens when failure threshold is reached, preventing
    cascading failures. Gradually tests recovery with half-open state.

    Usage:
        breaker = CircuitBreaker("anilist", failure_threshold=5, recovery_timeout=60)

        @breaker
        async def fetch_anime_data(anime_id):
            # Your API call here
            pass
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        half_open_max_calls: int = 3,
        success_threshold: int = 2,
        cache_prefix: str = "circuit_breaker",
    ):
        """
        Initialize circuit breaker.

        Args:
            name: Unique name for this circuit breaker
            failure_threshold: Number of failures before opening circuit
            recovery_timeout: Seconds to wait before testing recovery
            half_open_max_calls: Max calls in half-open state
            success_threshold: Successful calls needed to close circuit
            cache_prefix: Prefix for cache keys
        """
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self.success_threshold = success_threshold
        self.cache_prefix = cache_prefix

        # Cache key prefixes
        self._state_key = f"{cache_prefix}:{name}:state"
        self._failure_count_key = f"{cache_prefix}:{name}:failures"
        self._success_count_key = f"{cache_prefix}:{name}:successes"
        self._last_failure_time_key = f"{cache_prefix}:{name}:last_failure"
        self._half_open_calls_key = f"{cache_prefix}:{name}:half_open_calls"

    def _get_state(self) -> CircuitState:
        """Get current circuit state from cache."""
        state = cache.get(self._state_key)
        if state is None:
            return CircuitState.CLOSED
        return CircuitState(state)

    def _set_state(self, state: CircuitState):
        """Set circuit state in cache."""
        cache.set(self._state_key, state.value, timeout=None)

    def _increment_failure(self):
        """Increment failure count."""
        failures = cache.get(self._failure_count_key) or 0
        failures += 1
        cache.set(self._failure_count_key, failures, timeout=self.recovery_timeout * 2)
        cache.set(
            self._last_failure_time_key, time.time(), timeout=self.recovery_timeout * 2
        )
        return failures

    def _increment_success(self):
        """Increment success count."""
        successes = cache.get(self._success_count_key) or 0
        successes += 1
        cache.set(self._success_count_key, successes, timeout=self.recovery_timeout * 2)
        return successes

    def _reset_counts(self):
        """Reset failure and success counts."""
        cache.delete(self._failure_count_key)
        cache.delete(self._success_count_key)
        cache.delete(self._half_open_calls_key)

    def _get_last_failure_time(self) -> Optional[float]:
        """Get timestamp of last failure."""
        return cache.get(self._last_failure_time_key)

    def _increment_half_open_call(self):
        """Increment half-open call count."""
        calls = cache.get(self._half_open_calls_key) or 0
        calls += 1
        cache.set(self._half_open_calls_key, calls, timeout=self.recovery_timeout)
        return calls

    def is_open(self) -> bool:
        """
        Check if circuit is open (failing).

        Returns:
            True if circuit is open and requests should be rejected
        """
        state = self._get_state()

        if state == CircuitState.CLOSED:
            # Check if we've hit failure threshold
            failures = cache.get(self._failure_count_key) or 0
            if failures >= self.failure_threshold:
                logger.warning(
                    f"Circuit breaker '{self.name}' opened after {failures} failures"
                )
                self._set_state(CircuitState.OPEN)
                return True
            return False

        elif state == CircuitState.OPEN:
            # Check if recovery timeout has passed
            last_failure = self._get_last_failure_time()
            if last_failure and (time.time() - last_failure) >= self.recovery_timeout:
                logger.info(f"Circuit breaker '{self.name}' entering half-open state")
                self._set_state(CircuitState.HALF_OPEN)
                cache.set(self._half_open_calls_key, 0, timeout=self.recovery_timeout)
                return False
            return True

        elif state == CircuitState.HALF_OPEN:
            # Allow limited calls in half-open state
            calls = cache.get(self._half_open_calls_key) or 0
            if calls >= self.half_open_max_calls:
                return True
            return False

        return False

    def record_success(self):
        """Record a successful call."""
        state = self._get_state()

        if state == CircuitState.HALF_OPEN:
            successes = self._increment_success()
            if successes >= self.success_threshold:
                logger.info(f"Circuit breaker '{self.name}' closed after recovery")
                self._set_state(CircuitState.CLOSED)
                self._reset_counts()
        else:
            # Reset failures on success in closed state
            self._reset_counts()

    def record_failure(self):
        """Record a failed call."""
        state = self._get_state()

        if state == CircuitState.HALF_OPEN:
            # Re-open circuit immediately on failure in half-open
            logger.warning(
                f"Circuit breaker '{self.name}' re-opened due to failure in half-open state"
            )
            self._set_state(CircuitState.OPEN)
            self._increment_failure()
        else:
            failures = self._increment_failure()
            if failures >= self.failure_threshold:
                logger.warning(
                    f"Circuit breaker '{self.name}' opened after {failures} failures"
                )
                self._set_state(CircuitState.OPEN)

    def __call__(self, func: Callable) -> Callable:
        """
        Decorator to protect a function with circuit breaker.

        Args:
            func: Function to protect

        Returns:
            Wrapped function
        """

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if self.is_open():
                raise CircuitBreakerOpenError(
                    f"Circuit breaker '{self.name}' is OPEN - service unavailable"
                )

            # Track half-open calls
            if self._get_state() == CircuitState.HALF_OPEN:
                self._increment_half_open_call()

            try:
                result = func(*args, **kwargs)
                self.record_success()
                return result
            except Exception as e:
                self.record_failure()
                raise

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            if self.is_open():
                raise CircuitBreakerOpenError(
                    f"Circuit breaker '{self.name}' is OPEN - service unavailable"
                )

            # Track half-open calls
            if self._get_state() == CircuitState.HALF_OPEN:
                self._increment_half_open_call()

            try:
                result = await func(*args, **kwargs)
                self.record_success()
                return result
            except Exception as e:
                self.record_failure()
                raise

        # Return appropriate wrapper based on whether function is async
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper

    def get_stats(self) -> dict:
        """
        Get circuit breaker statistics.

        Returns:
            dict with current state and metrics
        """
        return {
            "name": self.name,
            "state": self._get_state().value,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
            "current_failures": cache.get(self._failure_count_key) or 0,
            "current_successes": cache.get(self._success_count_key) or 0,
            "half_open_calls": cache.get(self._half_open_calls_key) or 0,
            "last_failure": self._get_last_failure_time(),
        }


class CircuitBreakerOpenError(Exception):
    """Exception raised when circuit breaker is open."""

    pass


# Pre-configured circuit breakers for external services
CIRCUIT_BREAKERS = {
    "anilist": CircuitBreaker(
        name="anilist",
        failure_threshold=5,
        recovery_timeout=60,
        half_open_max_calls=3,
        success_threshold=2,
    ),
    "jikan": CircuitBreaker(
        name="jikan",
        failure_threshold=3,
        recovery_timeout=30,
        half_open_max_calls=2,
        success_threshold=1,
    ),
    "themes_moe": CircuitBreaker(
        name="themes_moe",
        failure_threshold=5,
        recovery_timeout=120,
        half_open_max_calls=3,
        success_threshold=2,
    ),
}


def get_circuit_breaker(name: str) -> CircuitBreaker:
    """
    Get a pre-configured circuit breaker by name.

    Args:
        name: Name of the circuit breaker (anilist, jikan, themes_moe)

    Returns:
        CircuitBreaker instance
    """
    if name not in CIRCUIT_BREAKERS:
        raise ValueError(f"Unknown circuit breaker: {name}")
    return CIRCUIT_BREAKERS[name]


def with_circuit_breaker(service_name: str):
    """
    Decorator factory to apply circuit breaker to a function.

    Args:
        service_name: Name of the service to protect (anilist, jikan, themes_moe)

    Usage:
        @with_circuit_breaker("anilist")
        async def fetch_anime_data(anime_id):
            # Your API call
            pass
    """
    breaker = get_circuit_breaker(service_name)
    return breaker


# For testing purposes
def reset_all_circuit_breakers():
    """Reset all circuit breakers to closed state."""
    for breaker in CIRCUIT_BREAKERS.values():
        breaker._set_state(CircuitState.CLOSED)
        breaker._reset_counts()
