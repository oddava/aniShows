"""Exception groups shared across apps, so ``except`` clauses can name real types."""

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
