"""
Jikan API rate limiter for theme song synchronization.

Provides adaptive rate limiting with exponential backoff for 429 errors.
"""

import time
import random
import asyncio
import logging
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

JIKAN_BASE_URL = "https://api.jikan.moe/v4"


class JikanRateLimiter:
    """
    Adaptive rate limiter for Jikan API.

    Jikan limit: ~3 requests per second (60 req/min).
    Uses adaptive delays and exponential backoff for 429 errors.

    Features:
    - Adaptive delay adjustment based on success/failure
    - Exponential backoff with jitter for rate limits
    - Success streak tracking to optimize delays
    - Thread-safe timing

    Usage:
        limiter = JikanRateLimiter(base_delay=0.35)

        async with httpx.AsyncClient() as client:
            await limiter.acquire()
            response = await client.get(url)

            if response.status_code == 429:
                limiter.record_429()
            else:
                limiter.record_success()
    """

    def __init__(
        self,
        base_delay: float = 0.35,
        min_delay: float = 0.25,
        max_delay: float = 5.0,
        success_streak_threshold: int = 10,
    ):
        """
        Initialize rate limiter.

        Args:
            base_delay: Base delay between requests in seconds
            min_delay: Minimum delay (after optimization)
            max_delay: Maximum delay (during backoff)
            success_streak_threshold: Successes needed to reduce delay
        """
        self.base_delay = base_delay
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.success_streak_threshold = success_streak_threshold

        self.current_delay = base_delay
        self.consecutive_429s = 0
        self.last_request_time = 0.0
        self.success_streak = 0
        self.total_requests = 0
        self.total_429s = 0

    async def acquire(self) -> None:
        """
        Acquire permission to make a request with adaptive rate limiting.

        Waits if necessary to maintain rate limit compliance.
        """
        now = time.time()
        elapsed = now - self.last_request_time

        # Ensure minimum time between requests
        if elapsed < self.current_delay:
            wait_time = self.current_delay - elapsed
            await asyncio.sleep(wait_time)

        self.last_request_time = time.time()
        self.total_requests += 1

    def record_success(self) -> None:
        """
        Record successful request.

        Gradually reduces delay after a streak of successes.
        """
        self.consecutive_429s = 0
        self.success_streak += 1

        # Gradually reduce delay after streak of successes
        if self.success_streak >= self.success_streak_threshold:
            if self.current_delay > self.min_delay:
                self.current_delay = max(self.min_delay, self.current_delay * 0.95)
                self.success_streak = 0
                logger.debug(
                    f"Reduced Jikan delay to {self.current_delay:.2f}s "
                    f"after {self.success_streak_threshold} successes"
                )

    def record_429(self) -> None:
        """
        Record 429 (Too Many Requests) error.

        Applies exponential backoff with jitter.
        """
        self.consecutive_429s += 1
        self.success_streak = 0
        self.total_429s += 1

        # Exponential backoff: 2^failures + random jitter
        backoff = min(2**self.consecutive_429s, 60)  # Cap at 60 seconds
        jitter = random.uniform(0, backoff * 0.3)  # 0-30% jitter
        self.current_delay = min(self.max_delay, self.base_delay + backoff + jitter)

        logger.warning(
            f"Jikan 429 hit (consecutive: {self.consecutive_429s}, "
            f"total: {self.total_429s}). "
            f"Backing off for {self.current_delay:.2f}s"
        )

    def record_error(self) -> None:
        """
        Record general error.

        Slightly increases delay to be more conservative.
        """
        self.success_streak = 0
        self.current_delay = min(self.max_delay, self.current_delay * 1.1)

    def get_stats(self) -> dict:
        """Get rate limiter statistics."""
        return {
            "total_requests": self.total_requests,
            "total_429s": self.total_429s,
            "current_delay": self.current_delay,
            "consecutive_429s": self.consecutive_429s,
            "success_streak": self.success_streak,
        }


async def fetch_themes_from_jikan(
    http_client: httpx.AsyncClient,
    mal_id: int,
    rate_limiter: JikanRateLimiter,
    max_retries: int = 3,
) -> Optional[dict]:
    """
    Fetch theme songs from Jikan API with smart retry logic.

    Args:
        http_client: httpx AsyncClient instance
        mal_id: MyAnimeList ID
        rate_limiter: JikanRateLimiter instance
        max_retries: Maximum number of retries

    Returns:
        Dictionary with 'openings' and 'endings' lists, or None on failure

    Usage:
        limiter = JikanRateLimiter()
        async with httpx.AsyncClient() as client:
            themes = await fetch_themes_from_jikan(
                client, 5114, limiter, max_retries=3
            )
            if themes:
                openings = themes.get('openings', [])
                endings = themes.get('endings', [])
    """
    url = f"{JIKAN_BASE_URL}/anime/{mal_id}/themes"
    transient_status_codes = {500, 502, 503, 504}

    for attempt in range(max_retries + 1):
        try:
            response = await http_client.get(url)

            # Handle rate limiting with exponential backoff
            if response.status_code == 429:
                rate_limiter.record_429()

                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    wait_time = float(retry_after)
                else:
                    wait_time = min(2**attempt + random.uniform(0, 2), 60)

                if attempt < max_retries:
                    logger.warning(
                        f"Jikan 429 for MAL ID {mal_id}, waiting {wait_time:.1f}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(wait_time)
                    continue

                logger.error(f"Jikan 429 max retries exceeded for MAL ID {mal_id}")
                return None

            # Handle transient upstream/server errors with retry
            if response.status_code in transient_status_codes:
                rate_limiter.record_error()
                if attempt < max_retries:
                    wait_time = min(2**attempt + random.uniform(0, 1), 15)
                    logger.warning(
                        f"Jikan transient error {response.status_code} for MAL ID {mal_id}, "
                        f"retrying in {wait_time:.1f}s (attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(wait_time)
                    continue

                logger.warning(
                    f"Jikan transient error {response.status_code} max retries exceeded "
                    f"for MAL ID {mal_id}"
                )
                return None

            response.raise_for_status()
            data = response.json().get("data", {})

            rate_limiter.record_success()

            return {
                "openings": data.get("openings", []),
                "endings": data.get("endings", []),
            }

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            rate_limiter.record_error()
            if attempt < max_retries:
                wait_time = min(2**attempt + random.uniform(0, 1), 15)
                logger.warning(
                    f"Jikan network timeout for MAL ID {mal_id}: {e}. "
                    f"Retrying in {wait_time:.1f}s (attempt {attempt + 1}/{max_retries})"
                )
                await asyncio.sleep(wait_time)
                continue

            logger.warning(f"Jikan network timeout max retries exceeded for MAL ID {mal_id}: {e}")
            return None
        except httpx.HTTPError as e:
            rate_limiter.record_error()
            if attempt < max_retries:
                wait_time = min(2**attempt + random.uniform(0, 1), 15)
                logger.warning(
                    f"Jikan HTTP error for MAL ID {mal_id}: {e}. "
                    f"Retrying in {wait_time:.1f}s (attempt {attempt + 1}/{max_retries})"
                )
                await asyncio.sleep(wait_time)
                continue

            logger.error(f"Jikan HTTP error max retries exceeded for MAL ID {mal_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error fetching themes for MAL ID {mal_id}: {e}")
            return None

    return None
