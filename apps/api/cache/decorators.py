"""Cache decorators for viewsets and functions."""

from functools import wraps
from django.core.cache import cache
import logging

logger = logging.getLogger(__name__)


def cached_response(key_func, ttl=300):
    """
    Decorator to cache viewset responses.

    Args:
        key_func: Function to generate cache key from (self, request, *args, **kwargs)
        ttl: Cache TTL in seconds
    """

    def decorator(func):
        @wraps(func)
        def wrapper(self, request, *args, **kwargs):
            from rest_framework.response import Response

            cache_key = key_func(self, request, *args, **kwargs)

            # Try to get from cache
            cached = cache.get(cache_key)
            if cached is not None:
                logger.debug(f"Cache hit: {cache_key}")
                return Response(cached)

            # Execute and cache
            response = func(self, request, *args, **kwargs)

            if response.status_code == 200:
                cache.set(cache_key, response.data, ttl)
                logger.debug(f"Cache set: {cache_key}")

            return response

        return wrapper

    return decorator


def invalidate_cache(*keys):
    """
    Decorator to invalidate cache keys after successful operation.
    """

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            response = func(*args, **kwargs)

            if 200 <= response.status_code < 300:
                for key in keys:
                    cache.delete(key)
                    logger.debug(f"Cache invalidated: {key}")

            return response

        return wrapper

    return decorator


def cached_queryset(cache_key, ttl=300):
    """
    Decorator to cache queryset results.

    Args:
        cache_key: String or callable that returns cache key
        ttl: Cache TTL in seconds
    """

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            key = cache_key(*args, **kwargs) if callable(cache_key) else cache_key

            cached = cache.get(key)
            if cached is not None:
                logger.debug(f"Cache hit: {key}")
                return cached

            result = func(*args, **kwargs)
            cache.set(key, result, ttl)
            logger.debug(f"Cache set: {key}")
            return result

        return wrapper

    return decorator
