"""Exception groups shared across apps, so ``except`` clauses can name real types."""

from collections.abc import Iterator

from django_redis.exceptions import ConnectionInterrupted
from kombu.exceptions import KombuError
from redis.exceptions import RedisError

# What a Django cache call (or a raw client taken from the cache) raises when
# Redis is down or misbehaving. django-redis wraps connection, timeout and
# response errors in ConnectionInterrupted; other redis-py errors pass through
# unwrapped, and a few socket errors can surface as plain OSError.
# LocMemCache (tests) raises none of these.
CACHE_ERRORS: tuple[type[Exception], ...] = (ConnectionInterrupted, RedisError, OSError)

# What queueing a Celery task (apply_async, delay, send_task) raises when the
# broker is unreachable or a message cannot be encoded: kombu's own errors, or
# the Redis transport's errors when kombu re-raises them unchanged. Callers that
# also touch the cache around the enqueue (dedupe keys) are covered as well.
ENQUEUE_ERRORS: tuple[type[Exception], ...] = (KombuError, *CACHE_ERRORS)


def iter_exception_chain(exc: BaseException | None) -> Iterator[BaseException]:
    """Yield ``exc`` and then each exception it was raised from or during.

    Follows ``__cause__`` (``raise ... from``) and otherwise ``__context__``, and
    stops at a cycle, so callers can ask "was this caused by X anywhere?".
    """
    seen: set[int] = set()
    current = exc
    while current is not None and id(current) not in seen:
        yield current
        seen.add(id(current))
        current = current.__cause__ or current.__context__
