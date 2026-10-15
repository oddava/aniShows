import asyncio

from django.conf import settings


async def backoff(seconds: float) -> None:
    """Wait before retrying a failed external API call.

    Scaled by settings.RETRY_BACKOFF_SCALE (0 in tests, so retries don't add
    real seconds to the suite).
    """
    delay = seconds * getattr(settings, "RETRY_BACKOFF_SCALE", 1.0)
    if delay > 0:
        await asyncio.sleep(delay)
