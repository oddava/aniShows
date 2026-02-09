from celery import shared_task
import asyncio
from datetime import datetime
from .services.anilist import AniListService, MediaSort
from .models import Anime
from asgiref.sync import sync_to_async
from django.utils.text import slugify
import logging

logger = logging.getLogger(__name__)


# Helper to run async code in sync celery task
def run_async(coro):
    return asyncio.run(coro)


@shared_task(bind=True, max_retries=3)
def fetch_deep_metadata(self, anime_id):
    """
    Fetches deep metadata (characters, staff) for a specific anime.
    Triggered by post_save signal on creation.
    Routes to 'low_priority' queue.
    """
    logger.info(f"Starting metadata fetch for Anime ID: {anime_id}")

    async def _process():
        service = AniListService()
        try:
            # Fetch anime from DB
            from .models import Anime

            anime = await sync_to_async(Anime.objects.get)(id=anime_id)

            # Use search_anime/process_media_list to fetch full details
            # Assuming process_media_list handles deep fetching or we need to call it specifically
            # Current process_media_list fetches detailed data including chars/staff if configured in query

            # We strictly want to update this specific anime, so we search by ID via service if possible
            # or strictly by title if ID lookup isn't exposed.
            # Ideally we'd have get_by_id in service. Let's use search for now or add get_by_id.
            # Actually, existing backfill uses search_anime(title). Let's do that for consistency
            # or better: rely on AniList ID if we stored it? We don't seemingly store AniList ID explicitly in model?
            # We do store slug. Let's use get_anime with slug? Or search by title.

            results = await service.search_anime(anime.title)
            if results:
                # Use manual update to ensure we populate THIS specific instance
                # regardless of slug differences (prevents duplicate creation or ignoring)
                await service.update_anime_manual(anime, results[0])
                logger.info(
                    f"Metadata fetch complete for {anime.title} (ID: {anime.id})"
                )
                return {"updated": 1}
            else:
                logger.warning(
                    f"No results found for {anime.title} during deep metadata fetch"
                )

        except Exception as e:
            logger.error(f"Error fetching metadata for {anime_id}: {e}")
            raise self.retry(exc=e, countdown=60)  # Retry in 1 min
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def sync_trending_anime(limit=50):
    """
    Fetches the currently trending anime.
    Useful for keeping updated with currently airing shows (episodes, scores).
    Run this frequently (e.g. hourly).
    """
    logger.info(f"Starting trending anime sync (limit: {limit})")

    async def _process():
        service = AniListService()
        try:
            data = await service.get_recent_updates(limit=limit)
            stats = await service.process_media_list(data)

            # Update trending ranks
            # Reset all trending ranks first to ensure fresh list
            await sync_to_async(
                Anime.objects.filter(trending_rank__isnull=False).update
            )(trending_rank=None)

            # Set new ranks
            trending_ids = []
            for i, item in enumerate(data):
                # We need to find the anime object again to update rank
                # process_media_list handles creation/update but doesn't return objects directly easily
                # So we lookup by slug or title match logic used in service
                title = item.get("title", {}).get("english") or item.get(
                    "title", {}
                ).get("romaji")
                if title:
                    slug = slugify(title)
                    try:
                        anime = await sync_to_async(Anime.objects.get)(slug=slug)
                        anime.trending_rank = i + 1
                        await sync_to_async(anime.save)()
                        trending_ids.append(anime.id)
                    except Anime.DoesNotExist:
                        continue

            logger.info(
                f"Trending Sync Complete. Created: {stats['created']}, Updated: {stats['updated']}, Ranked: {len(trending_ids)}"
            )
            return stats
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def sync_seasonal_anime(limit=100):
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
            year += 1  # Season starts in Dec implies next year's winter season usually
    elif month in [3, 4, 5]:
        season = "SPRING"
    elif month in [6, 7, 8]:
        season = "SUMMER"
    else:
        season = "FALL"

    logger.info(f"Starting seasonal sync for {season} {year}")

    async def _process():
        service = AniListService()
        try:
            data = await service.get_by_season(
                season, year, limit=limit, sort=MediaSort.POPULARITY
            )
            stats = await service.process_media_list(data)
            logger.info(f"Seasonal Sync Complete. Stats: {stats}")
            return stats
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def backfill_catalog(start_page=1, pages=5):
    """
    Scrapes the entire catalog page by page to fill in older anime.
    Can be chained to run continuously if needed, but safer to run in chunks.
    """
    logger.info(f"Starting catalog backfill from page {start_page} for {pages} pages")

    async def _process():
        service = AniListService()
        try:
            # We construct a custom fetch here to just iterate pages
            total_stats = {"created": 0, "updated": 0, "skipped": 0}

            for page in range(start_page, start_page + pages):
                logger.info(f"Backfilling Page {page}...")
                data = await service._fetch_paginated(
                    variables={
                        "page": page,
                        "sort": [MediaSort.ID_DESC.value],
                    },  # Newest IDs first
                    limit=50,  # Per page fetch
                )
                if not data:
                    break

                stats = await service.process_media_list(data)
                total_stats["created"] += stats["created"]
                total_stats["updated"] += stats["updated"]
                total_stats["skipped"] += stats["skipped"]

            logger.info(f"Backfill Chunk Complete. Total Stats: {total_stats}")
            return total_stats
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def backfill_metadata_task():
    """
    Backfills metadata for existing anime using a background Celery task.
    """
    logger.info("Starting metadata backfill task...")

    async def _process():
        service = AniListService()
        try:
            # Get all anime from DB that donor't have characters AND staff
            # This identifies anime that haven't been backfilled yet
            all_anime = await sync_to_async(list)(
                Anime.objects.filter(characters__isnull=True, staff__isnull=True)
                .distinct()
                .order_by("-popularity_rank")
            )
            total = len(all_anime)
            logger.info(f"Found {total} newly imported anime to update.")

            updated_count = 0
            error_count = 0

            for i, anime in enumerate(all_anime):
                try:
                    results = await service.search_anime(anime.title)
                    if results:
                        item = results[0]
                        await service.process_media_list([item])
                        updated_count += 1
                        if (i + 1) % 10 == 0 or (i + 1) == total:
                            logger.info(f"Progress: {i + 1}/{total} anime updated.")
                    else:
                        logger.warning(f"No results found for {anime.title}")
                except Exception as e:
                    logger.error(f"Error updating {anime.title}: {e}")
                    error_count += 1

                # Small base delay between processed items (the service handles API rate limits)
                await asyncio.sleep(0.5)

            logger.info(
                f"Backfill Complete. Updated: {updated_count}, Total: {total}, Errors: {error_count}"
            )
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def sync_next_season_anime(limit=100):
    """
    Fetches anime for the NEXT season (not yet airing).
    Run this weekly to catch newly announced anime.
    """
    current_date = datetime.now()
    year = current_date.year
    month = current_date.month

    # Determine NEXT season (one season ahead of current)
    if month in [12, 1, 2]:
        # Currently Winter -> Next is Spring
        next_season = "SPRING"
        next_year = year if month != 12 else year + 1
    elif month in [3, 4, 5]:
        # Currently Spring -> Next is Summer
        next_season = "SUMMER"
        next_year = year
    elif month in [6, 7, 8]:
        # Currently Summer -> Next is Fall
        next_season = "FALL"
        next_year = year
    else:
        # Currently Fall -> Next is Winter
        next_season = "WINTER"
        next_year = year + 1

    logger.info(f"Starting next season sync for {next_season} {next_year}")

    async def _process():
        service = AniListService()
        try:
            data = await service.get_by_season(
                next_season, next_year, limit=limit, sort=MediaSort.POPULARITY
            )
            stats = await service.process_media_list(data)
            logger.info(f"Next Season Sync Complete. Stats: {stats}")
            return stats
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def generate_user_recommendations():
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
        raise


@shared_task
def generate_recommendations_for_user(user_id: int):
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
        raise


@shared_task
def sync_airing_anime():
    """
    Fetches and updates ALL currently airing anime to ensure next_airing_date is populated.
    This is critical for the schedule feature to work correctly.
    Run this hourly to catch all airing shows, not just trending ones.
    """
    logger.info("Starting sync for all airing anime...")

    async def _process():
        service = AniListService()
        try:
            # Get all airing anime from our database
            airing_anime = await sync_to_async(list)(
                Anime.objects.filter(status=Anime.AnimeStatus.airing)
            )
            total = len(airing_anime)
            logger.info(f"Found {total} airing anime to update")

            updated_count = 0
            missing_date_count = 0
            error_count = 0

            for i, anime in enumerate(airing_anime):
                try:
                    # Search by AniList ID if available, otherwise by title
                    if anime.anilist_id:
                        result = await service.get_anime_by_id(anime.anilist_id)
                    else:
                        results = await service.search_anime(anime.title)
                        result = results[0] if results else None

                    if result:
                        # Update the anime with fresh data
                        await service.update_anime_manual(anime, result)

                        # Check if we got the airing date
                        next_airing = result.get("nextAiringEpisode")
                        if not next_airing or not next_airing.get("airingAt"):
                            missing_date_count += 1
                            logger.warning(
                                f"No nextAiringEpisode data for: {anime.title} "
                                f"(AniList ID: {anime.anilist_id})"
                            )

                        updated_count += 1
                    else:
                        logger.warning(
                            f"No results found for airing anime: {anime.title}"
                        )

                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        logger.info(f"Progress: {i + 1}/{total} airing anime processed")

                except Exception as e:
                    logger.error(f"Error updating airing anime {anime.title}: {e}")
                    error_count += 1

                # Polite delay to avoid rate limits
                await asyncio.sleep(0.7)

            logger.info(
                f"Airing sync complete. Updated: {updated_count}, "
                f"Missing dates: {missing_date_count}, Errors: {error_count}, Total: {total}"
            )
            return {
                "updated": updated_count,
                "missing_dates": missing_date_count,
                "errors": error_count,
                "total": total,
            }
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def cleanup_finished_airing_dates():
    """
    Clears next_airing_date for anime that have finished airing.
    Also updates status from 'Airing' to 'Finished' if detected.
    Run this daily to keep schedule clean.
    """
    logger.info("Starting cleanup of finished airing dates...")

    async def _process():
        service = AniListService()
        try:
            # Find anime with next_airing_date in the past
            from django.utils import timezone

            past_airing = await sync_to_async(list)(
                Anime.objects.filter(
                    next_airing_date__isnull=False,
                    next_airing_date__lt=timezone.now(),
                )
            )

            cleared_count = 0
            status_changed_count = 0

            for anime in past_airing:
                try:
                    # Check current status from AniList
                    if anime.anilist_id:
                        result = await service.get_anime_by_id(anime.anilist_id)
                        if result:
                            anilist_status = result.get("status", "")
                            if anilist_status == "FINISHED":
                                # Clear the airing date and update status
                                anime.next_airing_date = None
                                anime.next_airing_episode = None
                                anime.status = Anime.AnimeStatus.finished
                                await sync_to_async(anime.save)()
                                cleared_count += 1
                                status_changed_count += 1
                                logger.info(f"Updated {anime.title} to Finished status")
                            elif anilist_status == "RELEASING":
                                # Still airing, just episode aired - will be updated by sync_airing_anime
                                logger.debug(
                                    f"{anime.title} still releasing, next episode pending"
                                )
                    else:
                        # No AniList ID, just clear old dates
                        anime.next_airing_date = None
                        anime.next_airing_episode = None
                        await sync_to_async(anime.save)()
                        cleared_count += 1

                except Exception as e:
                    logger.error(f"Error cleaning up {anime.title}: {e}")

                await asyncio.sleep(0.5)

            # Also clear dates for explicitly finished anime
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
                f"Status changed to Finished: {status_changed_count}, "
                f"Finished anime cleaned: {finished_with_dates}"
            )
            return {
                "cleared_past_dates": cleared_count,
                "status_changed": status_changed_count,
                "finished_cleaned": finished_with_dates,
            }
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def backfill_airing_dates():
    """
    One-time backfill task for airing anime missing next_airing_date.
    Can be run manually when needed.
    """
    logger.info("Starting backfill of missing airing dates...")

    async def _process():
        service = AniListService()
        try:
            # Get airing anime without next_airing_date
            missing_dates = await sync_to_async(list)(
                Anime.objects.filter(
                    status=Anime.AnimeStatus.airing,
                    next_airing_date__isnull=True,
                )
            )
            total = len(missing_dates)
            logger.info(f"Found {total} airing anime missing next_airing_date")

            updated_count = 0
            still_missing_count = 0
            error_count = 0

            for i, anime in enumerate(missing_dates):
                try:
                    if anime.anilist_id:
                        result = await service.get_anime_by_id(anime.anilist_id)
                    else:
                        results = await service.search_anime(anime.title)
                        result = results[0] if results else None

                    if result:
                        await service.update_anime_manual(anime, result)

                        # Check if date was populated
                        next_airing = result.get("nextAiringEpisode")
                        if next_airing and next_airing.get("airingAt"):
                            updated_count += 1
                            logger.info(f"Populated date for: {anime.title}")
                        else:
                            still_missing_count += 1
                            logger.warning(
                                f"Still no date available for: {anime.title} "
                                f"(AniList may not have schedule yet)"
                            )
                    else:
                        logger.warning(f"No AniList data for: {anime.title}")

                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        logger.info(f"Backfill progress: {i + 1}/{total}")

                except Exception as e:
                    logger.error(f"Error backfilling {anime.title}: {e}")
                    error_count += 1

                await asyncio.sleep(0.7)

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
        finally:
            await service.close()

    return run_async(_process())
