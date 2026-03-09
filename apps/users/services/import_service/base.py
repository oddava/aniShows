import asyncio
from typing import Dict, Optional, Tuple

from apps.animes.models import Anime
from apps.shared.logger import logger
from apps.users.models import UserAnimeList, UserImportJob


class MALStatusMapper:
    """Map MAL status values to our status values"""

    API_MAPPING = {
        "watching": UserAnimeList.UserAnimeStatus.watching,
        "completed": UserAnimeList.UserAnimeStatus.completed,
        "on_hold": UserAnimeList.UserAnimeStatus.on_hold,
        "dropped": UserAnimeList.UserAnimeStatus.dropped,
        "plan_to_watch": UserAnimeList.UserAnimeStatus.plan_to_watch,
    }

    XML_MAPPING = {
        "Watching": UserAnimeList.UserAnimeStatus.watching,
        "Completed": UserAnimeList.UserAnimeStatus.completed,
        "On-Hold": UserAnimeList.UserAnimeStatus.on_hold,
        "Dropped": UserAnimeList.UserAnimeStatus.dropped,
        "Plan to Watch": UserAnimeList.UserAnimeStatus.plan_to_watch,
    }

class AniListStatusMapper:
    """Map AniList status values to our status values"""

    MAPPING = {
        "CURRENT": UserAnimeList.UserAnimeStatus.watching,
        "COMPLETED": UserAnimeList.UserAnimeStatus.completed,
        "PAUSED": UserAnimeList.UserAnimeStatus.on_hold,
        "DROPPED": UserAnimeList.UserAnimeStatus.dropped,
        "PLANNING": UserAnimeList.UserAnimeStatus.plan_to_watch,
    }

class BaseImporter:
    """Base class for importers"""

    # How often to flush progress to DB (every N entries)
    PROGRESS_FLUSH_INTERVAL = 10

    def __init__(self, job: UserImportJob):
        self.job = job
        self.user = job.user
        self.errors = []
        self.imported_count = 0
        self.skipped_count = 0
        self.failed_count = 0
        self.fetched_count = 0  # New: track fetched anime
        self._progress_counter = 0
        self._anilist_service = None  # Lazy-loaded, shared across calls
        self._event_loop = None  # Reusable event loop

    def _get_anilist_service(self):
        """Get or create a shared AniListService instance."""
        if self._anilist_service is None:
            from apps.animes.services.anilist import AniListService

            self._anilist_service = AniListService()
        return self._anilist_service

    def _get_event_loop(self):
        """Get or create a reusable event loop for async operations."""
        if self._event_loop is None or self._event_loop.is_closed():
            self._event_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._event_loop)
        return self._event_loop

    def _run_async(self, coro):
        """Run an async coroutine using the shared event loop."""
        loop = self._get_event_loop()
        return loop.run_until_complete(coro)

    def _cleanup(self):
        """Cleanup resources like the event loop."""
        if self._event_loop and not self._event_loop.is_closed():
            self._event_loop.close()
            self._event_loop = None

    def get_or_fetch_anime_sync(
        self,
        mal_id: int | None = None,
        anilist_id: int | None = None,
        title: str | None = None,
    ) -> Anime | None:
        """
        Try to find anime by external ID, if not found fetch it synchronously.
        Returns the anime object or None if cannot be found/fetched.
        """
        # Try to find by MAL ID
        if mal_id:
            try:
                return Anime.objects.get(mal_id=mal_id)
            except Anime.DoesNotExist:
                pass

        # Try to find by AniList ID
        if anilist_id:
            try:
                return Anime.objects.get(anilist_id=anilist_id)
            except Anime.DoesNotExist:
                pass

        # Try to find by title (case insensitive)
        if title:
            try:
                return Anime.objects.get(title__iexact=title)
            except Anime.DoesNotExist:
                pass

        # Anime not found - fetch it using shared service and event loop
        service = self._get_anilist_service()

        try:
            # Try to fetch by AniList ID first (most reliable)
            if anilist_id:
                logger.info(f"Fetching anime by AniList ID: {anilist_id}")
                anime_data = self._run_async(service.get_anime_by_id(anilist_id))
                if anime_data:
                    anime = self._run_async(service._save_anime_to_db_async(anime_data))
                    logger.info(f"Fetched and saved: {anime.title}")
                    self.fetched_count += 1
                    return anime

            # Try to fetch by MAL ID
            if mal_id:
                logger.info(f"Fetching anime by MAL ID: {mal_id}")
                anime_data = self._run_async(service.search_by_mal_id(mal_id))
                if anime_data:
                    anime = self._run_async(service._save_anime_to_db_async(anime_data))
                    logger.info(f"Fetched and saved: {anime.title}")
                    self.fetched_count += 1
                    return anime

            # Try to search by title as last resort
            if title:
                logger.info(f"Searching anime by title: {title}")
                results = self._run_async(service.search_anime(query=title, limit=1))
                if results:
                    anime_data = results[0]
                    anime = self._run_async(service._save_anime_to_db_async(anime_data))
                    logger.info(f"Fetched and saved: {anime.title}")
                    self.fetched_count += 1
                    return anime

            logger.warning(
                f"Could not find anime: MAL={mal_id}, AniList={anilist_id}, Title={title}"
            )
            return None

        except Exception as e:
            logger.error(f"Error fetching anime: {e}")
            return None

    def import_entry(self, entry_data: Dict) -> Tuple[bool, str]:
        """
        Import a single anime entry.
        Returns (success, message)
        """
        raise NotImplementedError

    def save_entry(
        self, anime: Anime, status: str, score: int, episodes_watched: int
    ) -> Tuple[bool, str]:
        """
        Save an entry to the user's anime list.
        Returns (success, message)
        """
        try:
            # Check if entry already exists
            existing = UserAnimeList.objects.filter(user=self.user, anime=anime).first()

            if existing:
                # Update existing entry
                existing.status = status
                existing.score = score
                existing.episodes_watched = episodes_watched
                existing.save()
                return True, "Updated existing entry"

            # Create new entry
            UserAnimeList.objects.create(
                user=self.user,
                anime=anime,
                status=status,
                score=score,
                episodes_watched=episodes_watched,
            )

            return True, "Imported successfully"

        except Exception as e:
            logger.error(f"Error saving entry: {e}")
            return False, f"Error: {str(e)}"

    def update_job_progress(self, force: bool = False):
        """Update the job's progress in the database.

        Batches writes to reduce DB load - only flushes every PROGRESS_FLUSH_INTERVAL entries
        or when force=True (e.g., at end of import).
        """
        self._progress_counter += 1
        if not force and self._progress_counter % self.PROGRESS_FLUSH_INTERVAL != 0:
            return

        self.job.processed_entries = self._progress_counter
        self.job.imported_entries = self.imported_count
        self.job.skipped_entries = self.skipped_count
        self.job.failed_entries = self.failed_count
        self.job.fetched_entries = self.fetched_count
        self.job.errors = self.errors[-10:]  # Keep last 10 errors
        self.job.save(
            update_fields=[
                "processed_entries",
                "imported_entries",
                "skipped_entries",
                "failed_entries",
                "fetched_entries",
                "errors",
            ]
        )
