from ...shared.logger import logger

"""
Unified theme song synchronization task.

Uses Jikan API to fetch opening and ending themes for anime.
"""

import re
from datetime import timedelta
from urllib.parse import quote_plus

import httpx
from asgiref.sync import sync_to_async
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from ...shared.celery import observed_shared_task
from ..models import Anime, ThemeSong
from ..services.jikan import JikanRateLimiter, fetch_themes_from_jikan
from .base import BaseTask, run_async_in_task


class ThemeSongSyncTask(BaseTask):
    """Unified task for syncing theme songs from Jikan API.

    Supports:
    - Batch sync for anime without themes
    - Single anime sync by ID
    - Smart rate limiting with adaptive delays
    - Automatic retry with exponential backoff
    - Detailed tracking of sync status

    Usage:
        # Sync themes for up to 500 anime without themes
        sync_theme_songs.delay(limit=500)

        # Sync themes for specific anime
        sync_theme_songs.delay(anime_id=123)

        # Force re-sync for anime with existing themes
        sync_theme_songs.delay(limit=100, force_resync=True)

        # Retry failed anime only
        sync_theme_songs.delay(retry_failed=True)
    """

    def execute(
        self,
        anime_id: int | None = None,
        limit: int = 500,
        force_resync: bool = False,
        retry_failed: bool = False,
        base_delay: float = 0.8,
        anime_ids: list[int] | None = None,
    ):
        """Run theme song synchronization.

        Args:
            anime_id: Specific anime ID to sync (optional)
            limit: Maximum anime to process in batch mode
            force_resync: Re-sync anime that already have themes
            retry_failed: Only retry previously failed anime
            base_delay: Base delay between Jikan API requests

        Returns:
            Dict with sync results
        """
        self.metrics.start()

        if anime_id:
            return run_async_in_task(self._sync_single(anime_id, base_delay))
        else:
            return run_async_in_task(
                self._sync_batch(limit, force_resync, retry_failed, base_delay, anime_ids)
            )

    async def _sync_single(self, anime_id: int, base_delay: float) -> dict:
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

                # Validate MAL ID
                if not isinstance(anime.mal_id, int) or anime.mal_id <= 0:
                    logger.warning(f"Anime {anime.title} has invalid MAL ID: {anime.mal_id}")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "error",
                        "reason": "invalid_mal_id",
                    }

                await rate_limiter.acquire()

                themes = await fetch_themes_from_jikan(
                    http_client, anime.mal_id, rate_limiter, max_retries=3
                )

                if themes is None:
                    logger.warning(f"Failed to fetch themes for {anime.title} (API error)")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "error",
                        "reason": "api_error",
                    }

                # Check if themes data is valid
                openings = themes.get("openings", [])
                endings = themes.get("endings", [])

                if openings or endings:
                    count = await self._save_theme_songs(anime, themes)
                    logger.info(f"✓ Synced {count} themes for {anime.title}")

                    # Auto-backfill any missing YouTube URLs
                    backfilled = await self._backfill_missing_youtube_urls(anime)
                    if backfilled > 0:
                        logger.info(
                            f"✓ Backfilled {backfilled} missing YouTube URLs for {anime.title}"
                        )

                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "success",
                        "themes_loaded": count,
                        "openings": len(openings),
                        "endings": len(endings),
                        "backfilled": backfilled,
                    }
                else:
                    logger.info(f"⚠ No themes available for {anime.title} (empty response)")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "no_themes",
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
        retry_failed: bool,
        base_delay: float,
        anime_ids: list[int] | None,
    ) -> dict:
        """Sync themes for multiple anime."""
        rate_limiter = JikanRateLimiter(base_delay=base_delay)

        # Get anime to process
        if retry_failed:
            # Checked more than 7 days ago and still without themes.
            seven_days_ago = timezone.now() - timedelta(days=7)
            queryset = (
                Anime.objects.filter(
                    theme_songs__isnull=True,
                    mal_id__isnull=False,
                    status__in=[Anime.AnimeStatus.finished, Anime.AnimeStatus.airing],
                    themes_checked_at__lt=seven_days_ago,
                )
                .distinct()
                .order_by("themes_checked_at")
            )
        elif force_resync:
            queryset = Anime.objects.exclude(mal_id__isnull=True).filter(
                status__in=[Anime.AnimeStatus.finished, Anime.AnimeStatus.airing]
            )
        else:
            # Get anime without themes (either never checked or not marked as no themes)
            # Only process anime that have aired (FINISHED or Airing status)
            queryset = (
                Anime.objects.filter(
                    theme_songs__isnull=True,
                    mal_id__isnull=False,
                    status__in=[Anime.AnimeStatus.finished, Anime.AnimeStatus.airing],
                    themes_checked_at__isnull=True,
                )
                .distinct()
                .order_by(F("popularity_rank").asc(nulls_last=True), "id")
            )

        if anime_ids:
            queryset = queryset.filter(id__in=anime_ids)

        anime_list = await sync_to_async(list)(queryset[:limit])
        total = len(anime_list)

        if total == 0:
            logger.info("No anime found needing theme sync")
            return {
                "mode": "batch",
                "processed": 0,
                "with_themes": 0,
                "without_themes": 0,
                "failed": 0,
                "themes_loaded": 0,
            }

        logger.info(f"Found {total} anime to sync themes")

        # Track statistics
        stats = {
            "with_themes": 0,  # Successfully synced with themes
            "without_themes": 0,  # Checked but no themes available
            "failed": 0,  # API errors or other failures
            "skipped": 0,  # Invalid MAL ID or other skip reasons
            "themes_loaded": 0,
        }

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            for i, anime in enumerate(anime_list):
                try:
                    await rate_limiter.acquire()

                    # Validate MAL ID
                    if not anime.mal_id or not isinstance(anime.mal_id, int) or anime.mal_id <= 0:
                        logger.debug(f"Skipping {anime.title} - invalid MAL ID: {anime.mal_id}")
                        stats["skipped"] += 1
                        continue

                    await sync_to_async(Anime.objects.filter(pk=anime.pk).update)(
                        themes_checked_at=timezone.now()
                    )

                    # Fetch themes
                    themes = await fetch_themes_from_jikan(
                        http_client, anime.mal_id, rate_limiter, max_retries=3
                    )

                    if themes is None:
                        # API error - will retry later
                        stats["failed"] += 1
                        rate_limiter.record_error()
                        logger.warning(f"✗ API error for {anime.title} (MAL: {anime.mal_id})")
                        continue

                    # Check if themes data is valid
                    openings = themes.get("openings", [])
                    endings = themes.get("endings", [])

                    if openings or endings:
                        count = await self._save_theme_songs(anime, themes)
                        stats["themes_loaded"] += count
                        stats["with_themes"] += 1

                        logger.info(
                            f"✓ ({i + 1}/{total}) {anime.title}: {count} themes "
                            f"({len(openings)} OP, {len(endings)} ED)"
                        )
                    else:
                        # No themes available - mark as checked but don't create placeholder
                        stats["without_themes"] += 1
                        logger.info(f"⚠ ({i + 1}/{total}) {anime.title}: No themes available")

                    # Progress indicator every 10 anime
                    if (i + 1) % 10 == 0:
                        logger.info(
                            f"--- Progress: {i + 1}/{total} | "
                            f"With themes: {stats['with_themes']}, "
                            f"Without: {stats['without_themes']}, "
                            f"Failed: {stats['failed']}, "
                            f"Skipped: {stats['skipped']} ---"
                        )

                except Exception as e:
                    stats["failed"] += 1
                    rate_limiter.record_error()
                    logger.error(f"✗ Error processing {anime.title}: {e}")
                    continue

        self.metrics.record_records(stats["with_themes"] + stats["without_themes"])

        # Record a metric for theme sync
        try:
            from ..services.metrics import ANIME_SYNCED

            if stats["with_themes"] > 0:
                ANIME_SYNCED.labels(sync_type="themes", source="jikan").inc(
                    stats["with_themes"]
                )
        except Exception:
            pass

        # Log summary
        logger.info(
            f"Theme sync complete: {total} processed | "
            f"With themes: {stats['with_themes']} | "
            f"Without: {stats['without_themes']} | "
            f"Failed: {stats['failed']} | "
            f"Skipped: {stats['skipped']} | "
            f"Total themes: {stats['themes_loaded']}"
        )

        # Log rate limiter stats
        rate_stats = rate_limiter.get_stats()
        logger.info(
            f"Rate limiter stats: {rate_stats['total_requests']} requests, "
            f"{rate_stats['total_429s']} rate limits, "
            f"current delay: {rate_stats['current_delay']:.2f}s"
        )

        return {
            "mode": "batch",
            "processed": total,
            "with_themes": stats["with_themes"],
            "without_themes": stats["without_themes"],
            "failed": stats["failed"],
            "skipped": stats["skipped"],
            "themes_loaded": stats["themes_loaded"],
            "rate_limiter_stats": rate_stats,
        }

    @sync_to_async
    def _save_theme_songs(self, anime: Anime, themes_data: dict) -> int:
        """Replace the anime's theme songs with the fetched ones."""
        from ..signals import _invalidate_anime_public_caches  # signals imports tasks

        now = timezone.now()
        songs = []
        for song_type, entries in (
            (ThemeSong.SongType.OPENING, themes_data.get("openings") or []),
            (ThemeSong.SongType.ENDING, themes_data.get("endings") or []),
        ):
            for idx, raw_text in enumerate(entries, 1):
                if not isinstance(raw_text, str) or not raw_text.strip():
                    continue
                parsed = self._parse_theme_song(re.sub(r"^\d+:\s*", "", raw_text))
                title = (parsed["title"] or "")[:200]
                artist = (parsed["artist"] or "")[:200]
                songs.append(
                    ThemeSong(
                        anime=anime,
                        song_type=song_type,
                        track_number=idx,
                        title=title,
                        artist=artist,
                        episodes=(parsed["episodes"] or "")[:100],
                        anilist_raw=raw_text[:500],
                        sync_source="jikan",
                        last_synced=now,
                        youtube_url=self._generate_youtube_url(
                            title, artist, song_type.label.lower(), anime.title
                        ),
                    )
                )

        # Delete and insert together: a failed insert must not leave the anime
        # with no themes at all.
        with transaction.atomic():
            ThemeSong.objects.filter(anime=anime).delete()
            ThemeSong.objects.bulk_create(songs)
        transaction.on_commit(lambda: _invalidate_anime_public_caches(anime.slug))
        return len(songs)

    def _parse_theme_song(self, text: str) -> dict:
        """Parse theme song format: 'Song Title' by Artist (eps X-Y)"""
        result = {"title": text, "artist": "", "episodes": ""}

        if not text:
            return result

        # Extract episode range
        episode_match = re.search(r"\s*\(eps?\s*([\d\-\s,]+)\)\s*$", text, re.IGNORECASE)
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

    def _generate_youtube_url(
        self, title: str, artist: str, song_type: str, anime_title: str
    ) -> str:
        """Generate a YouTube search URL for the theme song.

        Creates a search query with the song title, artist, and anime name
        to help users find the official theme on YouTube.
        """
        # Build search query
        query_parts = []

        # Add song title
        if title:
            query_parts.append(title)

        # Add artist
        if artist:
            query_parts.append(artist)

        # Add anime title for context
        if anime_title:
            query_parts.append(anime_title)

        # Add song type
        if song_type == "opening":
            query_parts.append("opening")
        elif song_type == "ending":
            query_parts.append("ending")

        # Join and encode
        query = " ".join(query_parts)
        encoded_query = quote_plus(query)

        url = f"https://www.youtube.com/results?search_query={encoded_query}"

        # Truncate to fit database URLField(max_length=500)
        if len(url) > 500:
            url = url[:500]

        return url

    @sync_to_async
    def _backfill_missing_youtube_urls(self, anime: Anime) -> int:
        """Backfill missing YouTube URLs for existing themes."""
        count = 0

        # Find themes without YouTube URLs
        themes_without_urls = ThemeSong.objects.filter(anime=anime, youtube_url="").exclude(
            title="No themes available"
        )

        for theme in themes_without_urls:
            try:
                # Generate YouTube URL
                youtube_url = self._generate_youtube_url(
                    theme.title, theme.artist, theme.song_type, anime.title
                )

                if youtube_url:
                    theme.youtube_url = youtube_url
                    theme.save(update_fields=["youtube_url"])
                    count += 1
                    logger.debug(f"Generated YouTube URL for {theme.title}: {youtube_url}")
            except Exception as e:
                logger.error(f"Error generating YouTube URL for {theme.title}: {e}")

        return count

@observed_shared_task(
    base=ThemeSongSyncTask,
    retry_policy="long",
    time_limit=7200,  # 2 hours for large batches
    soft_time_limit=6900,
)
def sync_theme_songs(
    self,
    anime_id: int | None = None,
    limit: int = 500,
    force_resync: bool = False,
    retry_failed: bool = False,
    base_delay: float = 0.8,
    anime_ids: list[int] | None = None,
):
    """Sync theme songs from Jikan API.

    Args:
        anime_id: Specific anime ID (optional, for single sync)
        limit: Maximum anime to process in batch (default: 500)
        force_resync: Re-sync anime with existing themes
        retry_failed: Only retry previously failed anime
        base_delay: Base delay between API requests

    Returns:
        Dict with sync results
    """
    return self.execute(anime_id, limit, force_resync, retry_failed, base_delay, anime_ids)

@observed_shared_task(retry_policy="long")
def backfill_theme_youtube_urls(self, limit: int = 100):
    """Periodic task to backfill missing YouTube URLs for theme songs.

    Runs daily to catch any themes that were created without YouTube URLs.
    """
    from ..models import ThemeSong

    logger.info(f"Starting YouTube URL backfill for up to {limit} themes")

    # Find themes without YouTube URLs
    themes = (
        ThemeSong.objects.filter(youtube_url="")
        .exclude(title="No themes available")
        .select_related("anime")[:limit]
    )

    updated = 0
    errors = 0

    for theme in themes:
        try:
            if theme.anime:
                # Generate YouTube URL
                youtube_url = _generate_youtube_url_sync(
                    theme.title, theme.artist, theme.song_type, theme.anime.title
                )

                if youtube_url:
                    theme.youtube_url = youtube_url
                    theme.save(update_fields=["youtube_url"])
                    updated += 1
                    logger.debug(f"Generated YouTube URL for {theme.title}")
        except Exception as e:
            errors += 1
            logger.error(f"Error generating YouTube URL for theme {theme.id}: {e}")

    result = {
        "processed": len(themes),
        "updated": updated,
        "errors": errors,
    }

    logger.info(f"YouTube URL backfill complete: {result}")
    return result

def _generate_youtube_url_sync(title: str, artist: str, song_type: str, anime_title: str) -> str:
    """Synchronous version of _generate_youtube_url for use in tasks."""
    query_parts = []

    if title:
        query_parts.append(title)
    if artist:
        query_parts.append(artist)
    if anime_title:
        query_parts.append(anime_title)
    if song_type == "opening":
        query_parts.append("opening")
    elif song_type == "ending":
        query_parts.append("ending")

    query = " ".join(query_parts)
    encoded_query = quote_plus(query)

    return f"https://www.youtube.com/results?search_query={encoded_query}"
