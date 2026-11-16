import random
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache

PayloadValidator = Callable[[object], bool]
PayloadBuilder = Callable[[], object]


# How long a payload built while a dependency failed is kept (``Degraded``).
DEGRADED_TTL_SECONDS = 60
# The longest a request waits for another builder before building itself, whatever
# ``PUBLIC_API_CACHE_WAIT_TIMEOUT_MS`` says (``PUBLIC_API_CACHE_WAIT_CAP_MS``).
DEFAULT_WAIT_CAP_MS = 3000


@dataclass(frozen=True, slots=True)
class Degraded:
    """What a builder returns when it had to fall back (a provider failed).

    The payload is served, but cached only briefly and reported with the
    cache status "degraded", so a fallback is not kept as if it were the
    real answer; it never replaces the stale copy of a good payload.
    """

    payload: object


def public_cache_stale_key(cache_key: str) -> str:
    return f"{cache_key}:stale"


def public_cache_lock_key(cache_key: str) -> str:
    return f"{cache_key}:lock"


def public_cache_variant_keys(*cache_keys: str) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for cache_key in cache_keys:
        for key in (cache_key, public_cache_stale_key(cache_key), public_cache_lock_key(cache_key)):
            if key not in seen:
                seen.add(key)
                keys.append(key)
    return keys


def invalidate_public_cache_keys(*cache_keys: str) -> None:
    cache.delete_many(public_cache_variant_keys(*cache_keys))


def _is_valid(payload, validator: PayloadValidator | None) -> bool:
    if payload is None:
        return False
    if isinstance(payload, Degraded):
        return _is_valid(payload.payload, validator)
    if validator is None:
        return True
    return bool(validator(payload))


def lock_wait_timeout_ms() -> int:
    """How long to poll for another builder's payload before rebuilding.

    The configured timeout, capped: a slow builder (or one that died holding
    the lock) must not hold every other reader for the lock TTL.
    """
    configured = max(int(settings.PUBLIC_API_CACHE_WAIT_TIMEOUT_MS), 0)
    cap = max(int(getattr(settings, "PUBLIC_API_CACHE_WAIT_CAP_MS", DEFAULT_WAIT_CAP_MS)), 0)
    return min(configured, cap)


def _jittered_ttl(base_ttl: int) -> int:
    jitter = max(int(settings.PUBLIC_API_CACHE_TTL_JITTER_SECONDS), 0)
    if jitter == 0:
        return max(base_ttl, 1)
    return max(base_ttl + random.randint(0, jitter), 1)


def get_or_build_public_payload(
    cache_key: str,
    builder: PayloadBuilder,
    *,
    ttl: int,
    validator: PayloadValidator | None = None,
) -> tuple[object, str]:
    fresh = cache.get(cache_key)
    if _is_valid(fresh, validator):
        return _served(fresh, "hit")
    if fresh is not None:
        invalidate_public_cache_keys(cache_key)

    stale_key = public_cache_stale_key(cache_key)
    stale_payload = cache.get(stale_key)
    if stale_payload is not None and not _is_valid(stale_payload, validator):
        invalidate_public_cache_keys(cache_key)
        stale_payload = None

    lock_key = public_cache_lock_key(cache_key)
    lock_token = uuid.uuid4().hex
    lock_ttl = max(int(settings.PUBLIC_API_CACHE_LOCK_TTL_SECONDS), 1)
    stale_ttl = max(int(settings.PUBLIC_API_CACHE_STALE_TTL_SECONDS), ttl)

    if cache.add(lock_key, lock_token, timeout=lock_ttl):
        try:
            fresh = cache.get(cache_key)
            if _is_valid(fresh, validator):
                return _served(fresh, "hit")

            return _store(cache_key, stale_key, builder(), ttl, stale_ttl, "miss", validator)
        finally:
            if cache.get(lock_key) == lock_token:
                cache.delete(lock_key)

    if stale_payload is not None:
        return stale_payload, "stale"

    wait_timeout_ms = lock_wait_timeout_ms()
    poll_interval_ms = max(int(settings.PUBLIC_API_CACHE_WAIT_POLL_INTERVAL_MS), 1)
    deadline = time.monotonic() + (wait_timeout_ms / 1000.0)

    while time.monotonic() < deadline:
        time.sleep(poll_interval_ms / 1000.0)
        fresh = cache.get(cache_key)
        if _is_valid(fresh, validator):
            return _served(fresh, "lock-wait")

    stale_payload = cache.get(stale_key)
    if _is_valid(stale_payload, validator):
        return stale_payload, "stale"

    return _store(cache_key, stale_key, builder(), ttl, stale_ttl, "rebuild", validator)


def _served(cached, status: str) -> tuple[object, str]:
    if isinstance(cached, Degraded):
        return cached.payload, "degraded"
    return cached, status


def _store(cache_key, stale_key, result, ttl: int, stale_ttl: int, status: str, validator):
    if isinstance(result, Degraded):
        # A good copy, even an old one, beats the fallback: serve it for now.
        stale_payload = cache.get(stale_key)
        if _is_valid(stale_payload, validator):
            cache.set(cache_key, stale_payload, DEGRADED_TTL_SECONDS)
            return stale_payload, "stale"
        cache.set(cache_key, result, DEGRADED_TTL_SECONDS)
        return result.payload, "degraded"
    ttl_with_jitter = _jittered_ttl(ttl)
    cache.set(cache_key, result, ttl_with_jitter)
    cache.set(stale_key, result, ttl_with_jitter + stale_ttl)
    return result, status
