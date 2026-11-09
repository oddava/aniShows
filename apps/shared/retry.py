import asyncio
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

from django.conf import settings


async def backoff(seconds: float) -> None:
    """Wait before retrying a failed external API call.

    Scaled by settings.RETRY_BACKOFF_SCALE (0 in tests, so retries don't add
    real seconds to the suite).
    """
    delay = seconds * getattr(settings, "RETRY_BACKOFF_SCALE", 1.0)
    if delay > 0:
        await asyncio.sleep(delay)


def retry_after_seconds(value: str | None) -> float | None:
    """Seconds to wait from a Retry-After header, or None if it is unusable.

    The header is either a number of seconds or an HTTP date (RFC 9110).
    """
    if not value:
        return None
    value = value.strip()
    try:
        seconds = float(value)
    except ValueError:
        try:
            when = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        seconds = (when - datetime.now(UTC)).total_seconds()
    if seconds != seconds or seconds in (float("inf"), float("-inf")):
        return None
    return max(seconds, 0.0)
