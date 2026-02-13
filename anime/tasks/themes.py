"""
Unified theme song synchronization task.

Uses Jikan API to fetch opening and ending themes for anime.
"""

import logging
import re
from datetime import datetime
from typing import Dict, List, Optional
from asgiref.sync import sync_to_async
from celery import shared_task
from django.utils import timezone
import httpx

from anime.models import Anime, ThemeSong
from anime.services.jikan import JikanRateLimiter, fetch_themes_from_jikan
from .base import BaseTask, run_async_in_task

logger = logging.getLogger(__name__)


class ThemeSongSyncTask(BaseTask):
    """
    Unified task for syncing theme songs from Jikan API.

    Supports:
    - Batch sync for anime without themes
    - Single anime sync by ID
    - Smart rate limiting with adaptive delays
    - Automatic retry with exponential backoff

    Usage:
        # Sync themes for up to 100 anime without themes
        sync_theme_songs.delay(limit=100)

        # Sync themes for specific anime
        sync_theme_songs.delay(anime_id=123)

        # Force re-sync for anime with existing themes
        sync_theme_songs.delay(limit=50, force_resync=True)
    """

    def run(
        self,
        anime_id: Optional[int] = None,
        limit: int = 100,
        force_resync: bool = False,
        base_delay: float = 0.35,
    ):
        """
        Run theme song synchronization.

        Args:
            anime_id: Specific anime ID to sync (optional)
            limit: Maximum anime to process in batch mode
            force_resync: Re-sync anime that already have themes
            base_delay: Base delay between Jikan API requests

        Returns:
            Dict with sync results
        """
        self.metrics.start()

        if anime_id:
            return run_async_in_task(self._sync_single(anime_id, base_delay))
        else:
            return run_async_in_task(self._sync_batch(limit, force_resync, base_delay))

    async def _sync_single(self, anime_id: int, base_delay: float) -> Dict:
        """Sync themes for a single anime."""
        rate_limiter = JikanRateLimiter(base_delay=base_delay)

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            try:
                anime = await sync_to_async(Anime.objects.get)(id=anime_id)

                if not anime.mal_id:
                    logger.warning(f"Anime {anime.title} has no MAL ID")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "error",
                        "reason": "no_mal_id",
                    }

                await rate_limiter.acquire()

                themes = await fetch_themes_from_jikan(
                    http_client, anime.mal_id, rate_limiter, max_retries=3
                )

                if themes:
                    count = await self._save_theme_songs(anime, themes)
                    logger.info(f"Synced {count} themes for {anime.title}")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "success",
                        "themes_loaded": count,
                    }
                else:
                    logger.warning(f"No themes found for {anime.title}")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "success",
                        "themes_loaded": 0,
                    }

            except Anime.DoesNotExist:
                logger.error(f"Anime {anime_id} not found")
                return {
                    "mode": "single",
                    "anime_id": anime_id,
                    "status": "error",
                    "reason": "anime_not_found",
                }
            except Exception as e:
                logger.error(f"Error syncing themes for {anime_id}: {e}")
                raise self.retry(exc=e)

    async def _sync_batch(
        self,
        limit: int,
        force_resync: bool,
        base_delay: float,
    ) -> Dict:
        """Sync themes for multiple anime."""
        rate_limiter = JikanRateLimiter(base_delay=base_delay)

        # Get anime to process
        if force_resync:
            queryset = Anime.objects.exclude(mal_id__isnull=True)
        else:
            queryset = (
                Anime.objects.filter(theme_songs__isnull=True)
                .exclude(mal_id__isnull=True)
                .distinct()
            )

        anime_list = await sync_to_async(list)(queryset[:limit])
        total = len(anime_list)

        if total == 0:
            logger.info("No anime found needing theme sync")
            return {
                "mode": "batch",
                "processed": 0,
                "successful": 0,
                "failed": 0,
                "themes_loaded": 0,
            }

        logger.info(f"Found {total} anime to sync themes")

        successful = 0
        failed = 0
        themes_loaded = 0

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            for i, anime in enumerate(anime_list):
                try:
                    await rate_limiter.acquire()

                    if not anime.mal_id:
                        logger.debug(f"Skipping {anime.title} - no MAL ID")
                        continue

                    # Fetch themes
                    themes = await fetch_themes_from_jikan(
                        http_client, anime.mal_id, rate_limiter, max_retries=3
                    )

                    if themes:
                        count = await self._save_theme_songs(anime, themes)
                        themes_loaded += count
                        successful += 1
                        rate_limiter.record_success()

                        logger.info(
                            f"✓ ({i + 1}/{total}) {anime.title}: {count} themes loaded"
                        )
                    else:
                        # No themes found - mark with placeholder
                        await self._mark_no_themes(anime)
                        successful += 1
                        rate_limiter.record_success()
                        logger.info(f"⚠ ({i + 1}/{total}) {anime.title}: No themes")

                    # Progress indicator
                    if (i + 1) % 10 == 0:
                        logger.info(
                            f"--- Progress: {i + 1}/{total} "
                            f"(Success: {successful}, Failed: {failed}) ---"
                        )

                except Exception as e:
                    failed += 1
                    rate_limiter.record_error()
                    logger.error(f"✗ Error processing {anime.title}: {e}")
                    continue

        self.metrics.record_records(successful)

        return {
            "mode": "batch",
            "processed": total,
            "successful": successful,
            "failed": failed,
            "themes_loaded": themes_loaded,
        }

    @sync_to_async
    def _save_theme_songs(self, anime: Anime, themes_data: dict) -> int:
        """Save theme songs to database."""
        count = 0

        # Clear existing themes
        ThemeSong.objects.filter(anime=anime).delete()

        # Parse and save openings
        openings = themes_data.get("openings", [])
        for idx, opening_text in enumerate(openings, 1):
            if opening_text:
                clean_text = re.sub(r"^\d+:\s*", "", opening_text)
                parsed = self._parse_theme_song(clean_text)

                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.OPENING,
                    track_number=idx,
                    title=parsed["title"],
                    artist=parsed["artist"],
                    episodes=parsed["episodes"],
                    anilist_raw=opening_text,
                    sync_source="jikan",
                    last_synced=timezone.now(),
                )
                count += 1

        # Parse and save endings
        endings = themes_data.get("endings", [])
        for idx, ending_text in enumerate(endings, 1):
            if ending_text:
                clean_text = re.sub(r"^\d+:\s*", "", ending_text)
                parsed = self._parse_theme_song(clean_text)

                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.ENDING,
                    track_number=idx,
                    title=parsed["title"],
                    artist=parsed["artist"],
                    episodes=parsed["episodes"],
                    anilist_raw=ending_text,
                    sync_source="jikan",
                    last_synced=timezone.now(),
                )
                count += 1

        return count

    @sync_to_async
    def _mark_no_themes(self, anime: Anime):
        """Mark anime as having no themes available."""
        ThemeSong.objects.get_or_create(
            anime=anime,
            song_type=ThemeSong.SongType.OPENING,
            track_number=1,
            defaults={
                "title": "No themes available",
                "sync_source": "jikan",
                "last_synced": datetime.now(),
            },
        )

    def _parse_theme_song(self, text: str) -> Dict:
        """Parse theme song format: 'Song Title' by Artist (eps X-Y)"""
        result = {"title": text, "artist": "", "episodes": ""}

        if not text:
            return result

        # Extract episode range
        episode_match = re.search(
            r"\s*\(eps?\s*([\d\-\s,]+)\)\s*$", text, re.IGNORECASE
        )
        if episode_match:
            result["episodes"] = episode_match.group(1).strip()
            text = text[: episode_match.start()].strip()

        # Extract artist
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
    base=ThemeSongSyncTask,
    max_retries=3,
    default_retry_delay=300,
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    time_limit=3600,
    soft_time_limit=3300,
)
def sync_theme_songs(
    self,
    anime_id: Optional[int] = None,
    limit: int = 100,
    force_resync: bool = False,
    base_delay: float = 0.35,
):
    """
    Sync theme songs from Jikan API.

    Args:
        anime_id: Specific anime ID (optional, for single sync)
        limit: Maximum anime to process in batch
        force_resync: Re-sync anime with existing themes
        base_delay: Base delay between API requests

    Returns:
        Dict with sync results
    """
    return self.run(anime_id, limit, force_resync, base_delay)
