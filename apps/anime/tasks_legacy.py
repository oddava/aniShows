from celery import shared_task
import asyncio
import time
import random
from datetime import datetime
from typing import List, Dict
from django.db import transaction
from django.utils import timezone
from .services.anilist import AniListService, MediaSort
from .services.rate_limiting import APICallCache
from .models import Anime, ThemeSong
from asgiref.sync import sync_to_async
from django.utils.text import slugify
import logging

logger = logging.getLogger(__name__)

JIKAN_BASE_URL = "https://api.jikan.moe/v4"


# Helper to run async code in sync celery task
def run_async(coro):
    return asyncio.run(coro)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def fetch_deep_metadata(self, anime_id):
    """
    Fetches deep metadata (characters, staff) for a specific anime.
    Triggered by post_save signal on creation.
    Routes to 'low_priority' queue.
    """
    logger.info(f"Starting metadata fetch for Anime ID: {anime_id}")

    async def _process():
        service = AniListService(enable_caching=True)
        try:
            anime = await sync_to_async(Anime.objects.get)(id=anime_id)

            results = await service.search_anime(anime.title)
            if results:
                await service.update_anime_manual(anime, results[0])
                logger.info(
                    f"Metadata fetch complete for {anime.title} (ID: {anime.id})"
                )
                return {"updated": 1}
            else:
                logger.warning(f"No results found for {anime.title}")

        except Exception as e:
            logger.error(f"Error fetching metadata for {anime_id}: {e}")
            raise self.retry(exc=e, countdown=60)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    time_limit=1800,  # 30 minutes max
    soft_time_limit=1500,  # 25 minutes soft limit
)
def sync_trending_anime(self, limit=50):
    """
    Fetches the currently trending anime.
    Optimized with batch database updates to reduce N+1 queries.
    Run this frequently (e.g. hourly).
    """
    logger.info(f"Starting trending anime sync (limit: {limit})")

    async def _process():
        service = AniListService(enable_caching=True)
        try:
            data = await service.get_recent_updates(limit=limit)
            stats = await service.process_media_list(data)

            # Build slug-to-rank mapping for batch update
            rank_updates = {}
            for i, item in enumerate(data):
                title = item.get("title", {}).get("english") or item.get(
                    "title", {}
                ).get("romaji")
                if title:
                    rank_updates[slugify(title)] = i + 1

            # Batch update in single transaction - reduces N+1 queries
            @sync_to_async
            def batch_update_trending_ranks():
                with transaction.atomic():
                    # Clear all trending ranks in one query
                    Anime.objects.filter(trending_rank__isnull=False).update(
                        trending_rank=None
                    )

                    # Update new ranks in batch
                    for slug, rank in rank_updates.items():
                        Anime.objects.filter(slug=slug).update(trending_rank=rank)

            await batch_update_trending_ranks()

            logger.info(
                f"Trending Sync Complete. Created: {stats['created']}, "
                f"Updated: {stats['updated']}, Ranked: {len(rank_updates)}"
            )
            return {**stats, "ranked": len(rank_updates)}

        except Exception as e:
            logger.error(f"Error in trending sync: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=180,
    retry_backoff=True,
    retry_backoff_max=900,
    retry_jitter=True,
    time_limit=3600,  # 1 hour max
)
def sync_seasonal_anime(self, limit=100):
    """
    Fetches anime for the current season.
    Run this daily.
    """
    current_date = datetime.now()
    year = current_date.year
    month = current_date.month

    # Determine season
    if month in [12, 1, 2]:
        season = "WINTER"
        if month == 12:
            year += 1
    elif month in [3, 4, 5]:
        season = "SPRING"
    elif month in [6, 7, 8]:
        season = "SUMMER"
    else:
        season = "FALL"

    logger.info(f"Starting seasonal sync for {season} {year}")

    async def _process():
        service = AniListService(enable_caching=True)
        try:
            data = await service.get_by_season(
                season, year, limit=limit, sort=MediaSort.POPULARITY
            )
            stats = await service.process_media_list(data)
            logger.info(f"Seasonal Sync Complete. Stats: {stats}")
            return stats
        except Exception as e:
            logger.error(f"Error in seasonal sync: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    time_limit=7200,  # 2 hours max for large batches
)
def backfill_catalog(self, start_page=1, pages=5):
    """
    Scrapes the entire catalog page by page to fill in older anime.
    Optimized for EC2 instances with circuit breaker protection.
    """
    logger.info(f"Starting catalog backfill from page {start_page} for {pages} pages")

    async def _process():
        service = AniListService(enable_caching=True)
        try:
            total_stats = {"created": 0, "updated": 0, "skipped": 0}

            for page in range(start_page, start_page + pages):
                logger.info(f"Backfilling Page {page}...")

                # Check if service is still healthy (circuit breaker)
                if not service._check_circuit_breaker():
                    logger.error("Circuit breaker is OPEN - stopping backfill")
                    break

                data = await service._fetch_paginated(
                    variables={
                        "page": page,
                        "sort": [MediaSort.ID_DESC.value],
                    },
                    limit=50,
                )

                if not data:
                    logger.info(f"No more data at page {page}, stopping")
                    break

                stats = await service.process_media_list(data)
                total_stats["created"] += stats["created"]
                total_stats["updated"] += stats["updated"]
                total_stats["skipped"] += stats["skipped"]

                logger.info(f"Page {page} complete: {stats}")

            logger.info(f"Backfill Chunk Complete. Total Stats: {total_stats}")
            return total_stats

        except Exception as e:
            logger.error(f"Error in catalog backfill: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    retry_backoff=True,
    time_limit=7200,  # 2 hours max
)
def backfill_metadata_task(self):
    """
    Backfills metadata for existing anime using a background Celery task.
    Processes in batches to avoid overwhelming small EC2 instances.
    """
    logger.info("Starting metadata backfill task...")

    async def _process():
        service = AniListService(enable_caching=True)
        try:
            # Get anime without metadata, limited batch size for EC2
            BATCH_SIZE = 50  # Process in smaller batches

            all_anime = await sync_to_async(list)(
                Anime.objects.filter(characters__isnull=True, staff__isnull=True)
                .distinct()
                .order_by("-popularity_rank")[:BATCH_SIZE]  # Limit for EC2
            )

            total = len(all_anime)
            logger.info(f"Found {total} newly imported anime to update (batch limited)")

            updated_count = 0
            error_count = 0

            for i, anime in enumerate(all_anime):
                try:
                    # Skip if recently updated (deduplication)
                    if service.call_cache and service.call_cache.is_recently_updated(
                        anime.anilist_id or 0, window=3600
                    ):
                        logger.debug(f"Skipping {anime.title} - recently updated")
                        continue

                    results = await service.search_anime(anime.title)
                    if results:
                        item = results[0]
                        await service.process_media_list([item])
                        updated_count += 1

                        # Mark as recently updated
                        if service.call_cache and anime.anilist_id:
                            service.call_cache.mark_updated(anime.anilist_id)

                        if (i + 1) % 10 == 0 or (i + 1) == total:
                            logger.info(f"Progress: {i + 1}/{total} anime updated.")
                    else:
                        logger.warning(f"No results found for {anime.title}")

                except Exception as e:
                    logger.error(f"Error updating {anime.title}: {e}")
                    error_count += 1

            logger.info(
                f"Backfill Complete. Updated: {updated_count}, "
                f"Total: {total}, Errors: {error_count}"
            )
            return {"updated": updated_count, "total": total, "errors": error_count}

        except Exception as e:
            logger.error(f"Error in metadata backfill: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=180,
    retry_backoff=True,
    retry_backoff_max=900,
    retry_jitter=True,
    time_limit=1800,
)
def sync_next_season_anime(self, limit=100):
    """
    Fetches anime for the NEXT season (not yet airing).
    Run this weekly to catch newly announced anime.
    """
    current_date = datetime.now()
    year = current_date.year
    month = current_date.month

    # Determine NEXT season
    if month in [12, 1, 2]:
        next_season = "SPRING"
        next_year = year if month != 12 else year + 1
    elif month in [3, 4, 5]:
        next_season = "SUMMER"
        next_year = year
    elif month in [6, 7, 8]:
        next_season = "FALL"
        next_year = year
    else:
        next_season = "WINTER"
        next_year = year + 1

    logger.info(f"Starting next season sync for {next_season} {next_year}")

    async def _process():
        service = AniListService(enable_caching=True)
        try:
            data = await service.get_by_season(
                next_season, next_year, limit=limit, sort=MediaSort.POPULARITY
            )
            stats = await service.process_media_list(data)
            logger.info(f"Next Season Sync Complete. Stats: {stats}")
            return stats
        except Exception as e:
            logger.error(f"Error in next season sync: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    retry_backoff=True,
    time_limit=7200,  # 2 hours for all users
)
def generate_user_recommendations(self):
    """
    Generate personalized recommendations for all active users.
    Run this daily to keep recommendations fresh.
    """
    from .recommendations import RecommendationService

    logger.info("Starting daily recommendation generation task")

    try:
        service = RecommendationService()
        stats = service.generate_for_all_users()

        logger.info(
            f"Recommendation generation complete: "
            f"{stats['processed']}/{stats['total_users']} users processed, "
            f"{stats['total_recommendations']} recommendations created"
        )

        return stats

    except Exception as e:
        logger.exception("Error in recommendation generation task")
        raise self.retry(exc=e)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    time_limit=300,  # 5 minutes max per anime
)
def generate_image_thumbnails(self, anime_id: int):
    """
    Generate optimized thumbnails for anime images.
    Runs asynchronously to avoid blocking import process.
    Generates WebP thumbnails in small, medium, and large sizes.
    """
    logger.info(f"Starting thumbnail generation for Anime ID: {anime_id}")

    try:
        from .models import Anime

        anime = Anime.objects.get(id=anime_id)
        generated_count = 0

        # Generate cover image thumbnails
        if anime.cover_image:
            try:
                # Access each spec field to trigger generation
                _ = anime.cover_image_small.url
                _ = anime.cover_image_medium.url
                _ = anime.cover_image_large.url
                generated_count += 3
                logger.info(f"Generated cover thumbnails for {anime.title}")
            except Exception as e:
                logger.warning(
                    f"Failed to generate cover thumbnails for {anime.title}: {e}"
                )

        # Generate banner image thumbnails
        if anime.banner_image:
            try:
                _ = anime.banner_image_small.url
                _ = anime.banner_image_medium.url
                _ = anime.banner_image_large.url
                generated_count += 3
                logger.info(f"Generated banner thumbnails for {anime.title}")
            except Exception as e:
                logger.warning(
                    f"Failed to generate banner thumbnails for {anime.title}: {e}"
                )

        logger.info(
            f"Thumbnail generation complete for {anime.title}. Generated: {generated_count}"
        )
        return {"anime_id": anime_id, "thumbnails_generated": generated_count}

    except Anime.DoesNotExist:
        logger.error(f"Anime with ID {anime_id} not found")
        return {"status": "error", "reason": "anime_not_found"}
    except Exception as e:
        logger.error(f"Error generating thumbnails for anime {anime_id}: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    retry_backoff=True,
    time_limit=300,  # 5 minutes for single user
)
def generate_recommendations_for_user(self, user_id: int):
    """
    Generate recommendations for a specific user.
    Useful for on-demand generation when user adds new anime to their list.
    """
    from .recommendations import RecommendationService
    from django.contrib.auth import get_user_model

    User = get_user_model()

    try:
        user = User.objects.get(id=user_id)
        service = RecommendationService()
        recs = service.generate_for_user(user)

        logger.info(f"Generated {len(recs)} recommendations for user {user.username}")
        return {"user_id": user_id, "recommendations_count": len(recs)}

    except User.DoesNotExist:
        logger.error(f"User {user_id} not found")
        return {"error": "User not found"}
    except Exception as e:
        logger.exception(f"Error generating recommendations for user {user_id}")
        raise self.retry(exc=e)


@shared_task(
    bind=True,
    max_retries=5,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    time_limit=3600,  # 1 hour max
    soft_time_limit=3300,  # 55 min soft limit
)
def sync_airing_anime(self):
    """
    Fetches and updates ALL currently airing anime to ensure next_airing_date is populated.
    Critical for schedule feature. Optimized with deduplication and batching.
    Run this hourly.
    """
    logger.info("Starting sync for all airing anime...")

    async def _process():
        # Use deduplication cache to prevent redundant API calls
        call_cache = APICallCache(ttl=1800)  # 30 min cache
        service = AniListService(enable_caching=True)

        try:
            # Get airing anime with AniList IDs for efficient lookup
            airing_anime = await sync_to_async(list)(
                Anime.objects.filter(status=Anime.AnimeStatus.airing).exclude(
                    anilist_id__isnull=True
                )  # Only those with AniList IDs
            )

            total = len(airing_anime)
            logger.info(f"Found {total} airing anime with AniList IDs to update")

            updated_count = 0
            missing_date_count = 0
            error_count = 0
            skipped_count = 0

            for i, anime in enumerate(airing_anime):
                try:
                    # Deduplication: Skip if updated recently by another task
                    if call_cache.is_recently_updated(anime.anilist_id, window=1800):
                        skipped_count += 1
                        continue

                    result = await service.get_anime_by_id(anime.anilist_id)

                    if result:
                        await service.update_anime_manual(anime, result)

                        # Check if we got the airing date
                        next_airing = result.get("nextAiringEpisode")
                        if not next_airing or not next_airing.get("airingAt"):
                            missing_date_count += 1
                            logger.debug(
                                f"No nextAiringEpisode data for: {anime.title}"
                            )

                        updated_count += 1
                        call_cache.mark_updated(anime.anilist_id)
                    else:
                        logger.warning(f"No results for anime ID: {anime.anilist_id}")

                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        logger.info(
                            f"Progress: {i + 1}/{total} airing anime processed "
                            f"(updated: {updated_count}, skipped: {skipped_count})"
                        )

                except Exception as e:
                    logger.error(f"Error updating airing anime {anime.title}: {e}")
                    error_count += 1

            logger.info(
                f"Airing sync complete. Updated: {updated_count}, "
                f"Skipped (recently updated): {skipped_count}, "
                f"Missing dates: {missing_date_count}, Errors: {error_count}"
            )
            return {
                "updated": updated_count,
                "skipped": skipped_count,
                "missing_dates": missing_date_count,
                "errors": error_count,
                "total": total,
            }

        except Exception as e:
            logger.error(f"Error in airing sync: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    retry_backoff=True,
    time_limit=1800,  # 30 minutes
)
def cleanup_finished_airing_dates(self):
    """
    Clears next_airing_date for anime that have finished airing.
    Also updates status from 'Airing' to 'Finished' if detected.
    Run this daily.
    """
    logger.info("Starting cleanup of finished airing dates...")

    async def _process():
        from django.utils import timezone

        service = AniListService(enable_caching=True)

        try:
            # Find anime with next_airing_date in the past
            past_airing = await sync_to_async(list)(
                Anime.objects.filter(
                    next_airing_date__isnull=False,
                    next_airing_date__lt=timezone.now(),
                ).exclude(anilist_id__isnull=True)[:100]  # Limit for EC2
            )

            cleared_count = 0
            status_changed_count = 0

            for anime in past_airing:
                try:
                    result = await service.get_anime_by_id(anime.anilist_id)

                    if result:
                        anilist_status = result.get("status", "")

                        if anilist_status == "FINISHED":
                            # Batch clear in single save
                            anime.next_airing_date = None
                            anime.next_airing_episode = None
                            anime.status = Anime.AnimeStatus.finished
                            await sync_to_async(anime.save)()
                            cleared_count += 1
                            status_changed_count += 1
                            logger.info(f"Updated {anime.title} to Finished")
                        elif anilist_status == "RELEASING":
                            # Episode aired but still releasing
                            anime.next_airing_date = None
                            anime.next_airing_episode = None
                            await sync_to_async(anime.save)()
                            cleared_count += 1

                except Exception as e:
                    logger.error(f"Error cleaning up {anime.title}: {e}")

            # Batch clear for explicitly finished anime
            finished_with_dates = await sync_to_async(
                Anime.objects.filter(
                    status=Anime.AnimeStatus.finished,
                    next_airing_date__isnull=False,
                ).update
            )(
                next_airing_date=None,
                next_airing_episode=None,
            )

            logger.info(
                f"Cleanup complete. Cleared past dates: {cleared_count}, "
                f"Status changed: {status_changed_count}, "
                f"Batch cleared finished: {finished_with_dates}"
            )
            return {
                "cleared_past_dates": cleared_count,
                "status_changed": status_changed_count,
                "finished_cleaned": finished_with_dates,
            }

        except Exception as e:
            logger.error(f"Error in cleanup: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    time_limit=3600,
)
def backfill_airing_dates(self):
    """
    One-time backfill task for airing anime missing next_airing_date.
    Can be run manually when needed.
    """
    logger.info("Starting backfill of missing airing dates...")

    async def _process():
        service = AniListService(enable_caching=True)
        try:
            missing_dates = await sync_to_async(list)(
                Anime.objects.filter(
                    status=Anime.AnimeStatus.airing,
                    next_airing_date__isnull=True,
                ).exclude(anilist_id__isnull=True)[:200]  # Limit for EC2
            )

            total = len(missing_dates)
            logger.info(f"Found {total} airing anime missing next_airing_date")

            updated_count = 0
            still_missing_count = 0
            error_count = 0

            for i, anime in enumerate(missing_dates):
                try:
                    result = await service.get_anime_by_id(anime.anilist_id)

                    if result:
                        await service.update_anime_manual(anime, result)

                        next_airing = result.get("nextAiringEpisode")
                        if next_airing and next_airing.get("airingAt"):
                            updated_count += 1
                            logger.info(f"Populated date for: {anime.title}")
                        else:
                            still_missing_count += 1
                            logger.debug(f"No date for: {anime.title}")
                    else:
                        logger.warning(f"No AniList data for: {anime.title}")

                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        logger.info(f"Backfill progress: {i + 1}/{total}")

                except Exception as e:
                    logger.error(f"Error backfilling {anime.title}: {e}")
                    error_count += 1

            logger.info(
                f"Backfill complete. Populated: {updated_count}, "
                f"Still missing: {still_missing_count}, Errors: {error_count}"
            )
            return {
                "populated": updated_count,
                "still_missing": still_missing_count,
                "errors": error_count,
                "total": total,
            }

        except Exception as e:
            logger.error(f"Error in backfill: {e}")
            raise self.retry(exc=e)
        finally:
            await service.close()

    return run_async(_process())


# ============================================================================
# JIKAN API THEME SYNC TASKS
# ============================================================================


class JikanRateLimiter:
    """
    Adaptive rate limiter for Jikan API.
    Jikan limit: ~3 requests per second (60 req/min).
    Uses adaptive delays and exponential backoff for 429 errors.
    """

    def __init__(
        self, base_delay: float = 0.35, min_delay: float = 0.25, max_delay: float = 5.0
    ):
        self.base_delay = base_delay
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.current_delay = base_delay
        self.consecutive_429s = 0
        self.last_request_time = 0
        self.success_streak = 0

    async def acquire(self) -> None:
        """Acquire permission to make a request with adaptive rate limiting."""
        now = time.time()
        elapsed = now - self.last_request_time

        # Ensure minimum time between requests
        if elapsed < self.current_delay:
            wait_time = self.current_delay - elapsed
            await asyncio.sleep(wait_time)

        self.last_request_time = time.time()

    def record_success(self) -> None:
        """Record successful request - gradually reduce delay."""
        self.consecutive_429s = 0
        self.success_streak += 1

        # Gradually reduce delay after streak of successes
        if self.success_streak >= 10 and self.current_delay > self.min_delay:
            self.current_delay = max(self.min_delay, self.current_delay * 0.95)

    def record_429(self) -> None:
        """Record 429 error - exponential backoff with jitter."""
        self.consecutive_429s += 1
        self.success_streak = 0

        # Exponential backoff: 2^failures + random jitter
        backoff = min(2**self.consecutive_429s, 60)  # Cap at 60 seconds
        jitter = random.uniform(0, backoff * 0.3)  # 0-30% jitter
        self.current_delay = min(self.max_delay, self.base_delay + backoff + jitter)

        logger.warning(
            f"Jikan 429 hit (consecutive: {self.consecutive_429s}). "
            f"Backing off for {self.current_delay:.2f}s"
        )

    def record_error(self) -> None:
        """Record general error - slight increase in delay."""
        self.success_streak = 0
        self.current_delay = min(self.max_delay, self.current_delay * 1.1)


async def fetch_themes_from_jikan(
    http_client, mal_id: int, rate_limiter: JikanRateLimiter, max_retries: int = 3
):
    """Fetch theme songs from Jikan API with smart retry logic."""
    import httpx

    url = f"{JIKAN_BASE_URL}/anime/{mal_id}/themes"

    for attempt in range(max_retries + 1):
        try:
            response = await http_client.get(url)

            # Handle rate limiting with exponential backoff
            if response.status_code == 429:
                rate_limiter.record_429()

                # Try to get retry-after header
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    wait_time = float(retry_after)
                else:
                    # Exponential backoff with jitter
                    wait_time = min(2**attempt + random.uniform(0, 2), 60)

                if attempt < max_retries:
                    logger.warning(
                        f"Jikan 429 for MAL ID {mal_id}, waiting {wait_time:.1f}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"Jikan 429 max retries exceeded for MAL ID {mal_id}")
                    return None

            # Handle other HTTP errors
            if response.status_code >= 500:
                if attempt < max_retries:
                    wait_time = min(2**attempt, 10)
                    logger.warning(
                        f"Jikan server error {response.status_code}, "
                        f"retrying in {wait_time:.1f}s"
                    )
                    await asyncio.sleep(wait_time)
                    continue

            response.raise_for_status()
            data = response.json().get("data", {})
            return data

        except httpx.HTTPError as e:
            logger.error(f"Jikan HTTP error for MAL ID {mal_id}: {e}")
            if attempt < max_retries:
                wait_time = min(2**attempt, 10)
                await asyncio.sleep(wait_time)
                continue
            return None
        except Exception as e:
            logger.error(f"Unexpected error fetching themes for MAL ID {mal_id}: {e}")
            return None

    return None


@sync_to_async
def _get_anime_without_themes(limit: int = 100):
    """Get anime that don't have theme songs yet.
    
    Only fetches for anime that have aired (not upcoming) to avoid
    wasting API calls on anime without themes yet.
    """
    from django.utils import timezone
    from datetime import timedelta
    
    return list(
        Anime.objects.filter(
            theme_songs__isnull=True,
            mal_id__isnull=False,  # Has MAL ID
            status__in=['FINISHED', 'Airing'],  # Has aired or finished
        )
        .exclude(  # Exclude recently aired (give time for themes to be added)
            status='Airing',
            release_date__gt=timezone.now().date() - timedelta(days=7)
        )
        .order_by('-popularity_rank')  # Prioritize popular anime
        .distinct()[:limit]
    )


@sync_to_async
def _save_theme_songs(anime: Anime, themes_data: dict, source: str = "jikan"):
    """Save theme songs to database. Returns count of saved themes."""
    import re

    count = 0

    # Clear existing themes from this source
    ThemeSong.objects.filter(anime=anime).delete()

    openings = themes_data.get("openings", [])
    for idx, opening_text in enumerate(openings, 1):
        if opening_text:
            # Strip leading number prefix like "1: " from Jikan format
            clean_text = re.sub(r"^\d+:\s*", "", opening_text)
            parsed = _parse_theme_song(clean_text)

            # Truncate fields to fit database limits
            title = (parsed.get("title") or "")[:200]
            artist = (parsed.get("artist") or "")[:200]
            episodes = (parsed.get("episodes") or "")[:100]
            
            ThemeSong.objects.create(
                anime=anime,
                song_type=ThemeSong.SongType.OPENING,
                track_number=idx,
                title=title,
                artist=artist,
                episodes=episodes,
                anilist_raw=opening_text[:500],
                sync_source=source,
                last_synced=timezone.now(),
            )
            count += 1

    endings = themes_data.get("endings", [])
    for idx, ending_text in enumerate(endings, 1):
        if ending_text:
            clean_text = re.sub(r"^\d+:\s*", "", ending_text)
            parsed = _parse_theme_song(clean_text)

            # Truncate fields to fit database limits
            title = (parsed.get("title") or "")[:200]
            artist = (parsed.get("artist") or "")[:200]
            episodes = (parsed.get("episodes") or "")[:100]
            
            ThemeSong.objects.create(
                anime=anime,
                song_type=ThemeSong.SongType.ENDING,
                track_number=idx,
                title=title,
                artist=artist,
                episodes=episodes,
                anilist_raw=ending_text[:500],
                sync_source=source,
                last_synced=timezone.now(),
            )
            count += 1

    return count


def _parse_theme_song(text: str):
    """Parse theme song format: 'Song Title' by Artist (eps X-Y)"""
    import re

    result = {"title": text, "artist": "", "episodes": ""}

    if not text:
        return result

    # Extract episode range (eps X-Y)
    episode_match = re.search(r"\s*\(eps?\s*([\d\-\s,]+)\)\s*$", text, re.IGNORECASE)
    if episode_match:
        result["episodes"] = episode_match.group(1).strip()
        text = text[: episode_match.start()].strip()

    # Extract artist: look for ' by ' pattern
    if text.startswith('"') and '" by ' in text:
        parts = text.split('" by ', 1)
        if len(parts) == 2:
            result["title"] = parts[0][1:].strip()
            result["artist"] = parts[1].strip()
    elif text.startswith("'") and "' by " in text:
        parts = text.split("' by ", 1)
        if len(parts) == 2:
            result["title"] = parts[0][1:].strip()
            result["artist"] = parts[1].strip()
    elif " by " in text:
        parts = text.rsplit(" by ", 1)
        if len(parts) == 2:
            result["title"] = parts[0].strip().strip('"').strip("'")
            result["artist"] = parts[1].strip()
    else:
        result["title"] = text.strip()

    return result


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    time_limit=3600,  # 1 hour max for large batches
    soft_time_limit=3300,
)
def sync_themes_for_new_anime(self, limit: int = 100):
    """
    Fetches theme songs for anime that don't have themes yet.
    Uses Jikan API (MyAnimeList) to get openings and endings.
    Run this daily to enrich new anime with theme data.

    Args:
        limit: Maximum number of anime to process in one run
    """
    import httpx

    logger.info(f"Starting theme sync for up to {limit} anime without themes")

    async def _process():
        rate_limiter = JikanRateLimiter(base_delay=0.35)

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            # Get anime without themes that have MAL IDs
            anime_list = await _get_anime_without_themes(limit)
            total = len(anime_list)

            if total == 0:
                logger.info("No anime without themes found")
                return {"processed": 0, "successful": 0, "failed": 0}

            logger.info(f"Found {total} anime without themes")

            successful = 0
            failed = 0
            themes_loaded = 0

            for i, anime in enumerate(anime_list):
                try:
                    # Acquire rate limit permission
                    await rate_limiter.acquire()

                    if not anime.mal_id:
                        logger.debug(f"Skipping {anime.title} - no MAL ID")
                        continue

                    # Fetch themes from Jikan
                    themes = await fetch_themes_from_jikan(
                        http_client, anime.mal_id, rate_limiter, max_retries=3
                    )

                    if themes:
                        # Save themes to database
                        count = await _save_theme_songs(anime, themes, source="jikan")
                        themes_loaded += count
                        successful += 1
                        rate_limiter.record_success()

                        logger.info(
                            f"✓ ({i + 1}/{total}) {anime.title}: "
                            f"{count} themes loaded (OP: {len(themes.get('openings', []))}, "
                            f"ED: {len(themes.get('endings', []))})"
                        )
                    else:
                        # No themes found - mark with empty themes to avoid re-processing
                        await sync_to_async(ThemeSong.objects.get_or_create)(
                            anime=anime,
                            song_type=ThemeSong.SongType.OPENING,
                            track_number=1,
                            defaults={
                                "title": "No themes available",
                                "sync_source": "jikan",
                                "last_synced": datetime.now(),
                            },
                        )
                        successful += 1
                        rate_limiter.record_success()
                        logger.info(
                            f"⚠ ({i + 1}/{total}) {anime.title}: No themes found"
                        )

                    # Progress indicator
                    if (i + 1) % 10 == 0:
                        logger.info(
                            f"--- Progress: {i + 1}/{total} "
                            f"(Success: {successful}, Failed: {failed}, "
                            f"Current delay: {rate_limiter.current_delay:.2f}s) ---"
                        )

                except Exception as e:
                    failed += 1
                    rate_limiter.record_error()
                    logger.error(f"✗ Error processing {anime.title}: {e}")
                    continue

            logger.info(
                f"Theme sync complete. Processed: {total}, "
                f"Successful: {successful}, Failed: {failed}, "
                f"Total themes loaded: {themes_loaded}"
            )

            return {
                "processed": total,
                "successful": successful,
                "failed": failed,
                "themes_loaded": themes_loaded,
            }

    return run_async(_process())


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    time_limit=300,  # 5 minutes max
)
def fetch_themes_for_anime(self, anime_id: int):
    """
    Fetch theme songs for a specific anime by ID.
    Used for on-demand theme loading when a new anime is added.
    """
    import httpx

    logger.info(f"Fetching themes for anime ID: {anime_id}")

    async def _process():
        rate_limiter = JikanRateLimiter(base_delay=0.35)

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            try:
                anime = await sync_to_async(Anime.objects.get)(id=anime_id)

                if not anime.mal_id:
                    logger.warning(f"Anime {anime.title} has no MAL ID")
                    return {"status": "error", "reason": "no_mal_id"}

                await rate_limiter.acquire()

                themes = await fetch_themes_from_jikan(
                    http_client, anime.mal_id, rate_limiter, max_retries=3
                )

                if themes:
                    count = await _save_theme_songs(anime, themes, source="jikan")
                    logger.info(f"Loaded {count} themes for {anime.title}")
                    return {"status": "success", "themes_loaded": count}
                else:
                    logger.warning(f"No themes found for {anime.title}")
                    return {"status": "success", "themes_loaded": 0}

            except Anime.DoesNotExist:
                logger.error(f"Anime with ID {anime_id} not found")
                return {"status": "error", "reason": "anime_not_found"}
            except Exception as e:
                logger.error(f"Error fetching themes for anime {anime_id}: {e}")
                raise self.retry(exc=e)

    return run_async(_process())


# ============================================================================
# FRANCHISE SYNC TASKS (Also defined in anime/tasks/franchises.py)
# These are duplicated here to ensure Celery worker registration
# ============================================================================

from apps.anime.tasks.franchises import sync_franchises, update_relation_slugs

# Re-export for Celery discovery
__all__ = [
    'sync_franchises',
    'update_relation_slugs',
]
