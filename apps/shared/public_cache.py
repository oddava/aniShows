import random
import time
import uuid
from collections.abc import Callable

from django.conf import settings
from django.core.cache import cache

PayloadValidator = Callable[[object], bool]
PayloadBuilder = Callable[[], object]


def _setting(name: str, default):
    return getattr(settings, name, default)


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
    if validator is None:
        return True
    return bool(validator(payload))


def _jittered_ttl(base_ttl: int) -> int:
    jitter = max(int(_setting("PUBLIC_API_CACHE_TTL_JITTER_SECONDS", 0)), 0)
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
        return fresh, "hit"
    if fresh is not None:
        invalidate_public_cache_keys(cache_key)

    stale_key = public_cache_stale_key(cache_key)
    stale_payload = cache.get(stale_key)
    if stale_payload is not None and not _is_valid(stale_payload, validator):
        invalidate_public_cache_keys(cache_key)
        stale_payload = None

    lock_key = public_cache_lock_key(cache_key)
    lock_token = uuid.uuid4().hex
    lock_ttl = max(int(_setting("PUBLIC_API_CACHE_LOCK_TTL_SECONDS", 15)), 1)
    stale_ttl = max(int(_setting("PUBLIC_API_CACHE_STALE_TTL_SECONDS", 900)), ttl)

    if cache.add(lock_key, lock_token, timeout=lock_ttl):
        try:
            fresh = cache.get(cache_key)
            if _is_valid(fresh, validator):
                return fresh, "hit"

            payload = builder()
            ttl_with_jitter = _jittered_ttl(ttl)
            cache.set(cache_key, payload, ttl_with_jitter)
            cache.set(stale_key, payload, ttl_with_jitter + stale_ttl)
            return payload, "miss"
        finally:
            if cache.get(lock_key) == lock_token:
                cache.delete(lock_key)

    if stale_payload is not None:
        return stale_payload, "stale"

    wait_timeout_ms = max(int(_setting("PUBLIC_API_CACHE_WAIT_TIMEOUT_MS", 250)), 0)
    poll_interval_ms = max(int(_setting("PUBLIC_API_CACHE_WAIT_POLL_INTERVAL_MS", 25)), 1)
    deadline = time.monotonic() + (wait_timeout_ms / 1000.0)

    while time.monotonic() < deadline:
        time.sleep(poll_interval_ms / 1000.0)
        fresh = cache.get(cache_key)
        if _is_valid(fresh, validator):
            return fresh, "lock-wait"

    stale_payload = cache.get(stale_key)
    if _is_valid(stale_payload, validator):
        return stale_payload, "stale"

    payload = builder()
    ttl_with_jitter = _jittered_ttl(ttl)
    cache.set(cache_key, payload, ttl_with_jitter)
    cache.set(stale_key, payload, ttl_with_jitter + stale_ttl)
    return payload, "rebuild"
