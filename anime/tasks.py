from celery import shared_task
import asyncio
from datetime import datetime
from typing import List, Dict
from django.db import transaction
from .services.anilist import AniListService, MediaSort
from .services.rate_limiting import APICallCache
from .models import Anime
from asgiref.sync import sync_to_async
from django.utils.text import slugify
import logging

logger = logging.getLogger(__name__)


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
