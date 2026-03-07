from apps.shared.logger import logger
"""
Import services for MyAnimeList and AniList
"""

import os
import defusedxml.ElementTree as ET
import requests
import asyncio
from typing import List, Dict, Optional, Tuple
from apps.animes.models import Anime
from apps.users.models import UserAnimeList, UserImportJob
from django.utils import timezone

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
        mal_id: Optional[int] = None,
        anilist_id: Optional[int] = None,
        title: Optional[str] = None,
    ) -> Optional[Anime]:
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

class MyAnimeListAPIImporter(BaseImporter):
    """Import from MyAnimeList API"""

    BASE_URL = "https://api.myanimelist.net/v2"

    def __init__(self, job: UserImportJob, username: str, client_id: Optional[str] = None):
        super().__init__(job)
        self.username = username
        # Get client_id from parameter, env var, or raise error - no hardcoded fallback
        self.client_id = client_id or os.getenv("MAL_CLIENT_ID")
        if not self.client_id:
            raise ValueError(
                "MAL_CLIENT_ID environment variable is required for MyAnimeList API imports. "
                "Please set it in your .env file or environment."
            )

    def fetch_user_list(self) -> List[Dict]:
        """Fetch user's anime list from MAL API"""
        entries = []
        offset = 0
        limit = 100

        headers = {"X-MAL-CLIENT-ID": self.client_id}

        fields = "list_status{status,score,num_episodes_watched}"

        while True:
            url = f"{self.BASE_URL}/users/{self.username}/animelist"
            params = {"offset": offset, "limit": limit, "fields": fields}

            try:
                response = requests.get(url, headers=headers, params=params, timeout=30)

                if response.status_code == 404:
                    raise ValueError(f"User '{self.username}' not found")

                if response.status_code == 429:
                    # Rate limited - wait and retry
                    import time

                    time.sleep(5)
                    continue

                response.raise_for_status()
                data = response.json()

                for item in data.get("data", []):
                    entries.append(
                        {
                            "mal_id": item["node"]["id"],
                            "title": item["node"]["title"],
                            "status": item["list_status"]["status"],
                            "score": item["list_status"]["score"],
                            "episodes_watched": item["list_status"]["num_episodes_watched"],
                        }
                    )

                # Check if there are more pages
                if "next" not in data.get("paging", {}):
                    break

                offset += limit

                # Rate limiting - be nice to the API
                import time

                time.sleep(0.5)

            except requests.exceptions.RequestException as e:
                logger.error(f"Error fetching MAL list: {e}")
                raise

        return entries

    def import_entry(self, entry_data: Dict) -> Tuple[bool, str]:
        """Import a single entry from MAL API data"""
        mal_id = entry_data.get("mal_id")
        title = entry_data.get("title")

        # Map status
        mal_status = entry_data.get("status")
        status = MALStatusMapper.API_MAPPING.get(mal_status)
        if not status:
            return False, f"Unknown status: {mal_status}"

        score = entry_data.get("score", 0)
        episodes_watched = entry_data.get("episodes_watched", 0)

        # Try to get or fetch anime (SYNCHRONOUS)
        anime = self.get_or_fetch_anime_sync(mal_id=mal_id, title=title)

        if not anime:
            return False, f"Anime not found or could not be fetched (MAL ID: {mal_id})"

        return self.save_entry(anime, status, score, episodes_watched)

    def run(self):
        """Run the import process"""
        self.job.status = UserImportJob.ImportStatus.processing
        self.job.save(update_fields=["status"])

        try:
            # Fetch list
            entries = self.fetch_user_list()
            self.job.total_entries = len(entries)
            self.job.save(update_fields=["total_entries"])

            logger.info(f"Starting import of {len(entries)} entries for user {self.user.username}")

            # Import each entry
            for entry in entries:
                try:
                    success, message = self.import_entry(entry)

                    if success:
                        self.imported_count += 1
                        logger.debug(f"Imported: {entry.get('title')} - {message}")
                    elif "Updated" in message:
                        self.imported_count += 1  # Count updates as imports
                        logger.debug(f"Updated: {entry.get('title')}")
                    elif "Skipped" in message:
                        self.skipped_count += 1
                    else:
                        self.failed_count += 1
                        self.errors.append(f"{entry.get('title', 'Unknown')}: {message}")

                except Exception as e:
                    self.failed_count += 1
                    self.errors.append(f"{entry.get('title', 'Unknown')}: {str(e)}")
                    logger.error(f"Error importing entry {entry.get('title')}: {e}")

                self.update_job_progress()

            # Final flush of progress
            self.update_job_progress(force=True)

            # Mark as completed
            self.job.status = UserImportJob.ImportStatus.completed
            self.job.completed_at = timezone.now()
            self.job.save(update_fields=["status", "completed_at"])

            logger.info(
                f"Import completed for {self.user.username}: "
                f"{self.imported_count} imported, {self.fetched_count} fetched, "
                f"{self.skipped_count} skipped, {self.failed_count} failed"
            )

        except Exception as e:
            logger.error(f"Import failed: {e}")
            self.job.status = UserImportJob.ImportStatus.failed
            self.job.errors.append(str(e))
            self.job.save(update_fields=["status", "errors"])
            raise
        finally:
            self._cleanup()

class MyAnimeListXMLImporter(BaseImporter):
    """Import from MyAnimeList XML export file"""

    def __init__(self, job: UserImportJob, xml_content: str):
        super().__init__(job)
        self.xml_content = xml_content

    def parse_xml(self) -> List[Dict]:
        """Parse MAL XML export and return list of entries"""
        entries = []

        try:
            root = ET.fromstring(self.xml_content)

            for anime_elem in root.findall("anime"):
                entry = {
                    "mal_id": self._get_int(anime_elem, "series_animedb_id"),
                    "title": self._get_text(anime_elem, "series_title"),
                    "status": self._get_text(anime_elem, "my_status"),
                    "score": self._get_int(anime_elem, "my_score"),
                    "episodes_watched": self._get_int(anime_elem, "my_watched_episodes"),
                }
                entries.append(entry)

        except ET.ParseError as e:
            logger.error(f"Error parsing XML: {e}")
            raise ValueError("Invalid XML file format")

        return entries

    def _get_text(self, elem, tag: str) -> Optional[str]:
        """Safely get text from XML element"""
        child = elem.find(tag)
        return child.text if child is not None else None

    def _get_int(self, elem, tag: str) -> int:
        """Safely get integer from XML element"""
        text = self._get_text(elem, tag)
        try:
            return int(text) if text else 0
        except ValueError:
            return 0

    def import_entry(self, entry_data: Dict) -> Tuple[bool, str]:
        """Import a single entry from MAL XML data"""
        mal_id = entry_data.get("mal_id")
        title = entry_data.get("title")

        # Map status
        mal_status = entry_data.get("status")
        status = MALStatusMapper.XML_MAPPING.get(mal_status)
        if not status:
            return False, f"Unknown status: {mal_status}"

        score = entry_data.get("score", 0)
        episodes_watched = entry_data.get("episodes_watched", 0)

        # Try to get or fetch anime (SYNCHRONOUS)
        anime = self.get_or_fetch_anime_sync(mal_id=mal_id, title=title)

        if not anime:
            return False, f"Anime not found or could not be fetched (MAL ID: {mal_id})"

        return self.save_entry(anime, status, score, episodes_watched)

    def run(self):
        """Run the import process"""
        self.job.status = UserImportJob.ImportStatus.processing
        self.job.save(update_fields=["status"])

        try:
            # Parse XML
            entries = self.parse_xml()
            self.job.total_entries = len(entries)
            self.job.save(update_fields=["total_entries"])

            logger.info(
                f"Starting XML import of {len(entries)} entries for user {self.user.username}"
            )

            # Import each entry
            for entry in entries:
                try:
                    success, message = self.import_entry(entry)

                    if success:
                        self.imported_count += 1
                    elif "Updated" in message:
                        self.imported_count += 1
                    elif "Skipped" in message:
                        self.skipped_count += 1
                    else:
                        self.failed_count += 1
                        self.errors.append(f"{entry.get('title', 'Unknown')}: {message}")

                except Exception as e:
                    self.failed_count += 1
                    self.errors.append(f"{entry.get('title', 'Unknown')}: {str(e)}")
                    logger.error(f"Error importing entry: {e}")

                self.update_job_progress()

            # Final flush of progress
            self.update_job_progress(force=True)

            # Mark as completed
            self.job.status = UserImportJob.ImportStatus.completed
            self.job.completed_at = timezone.now()
            self.job.save(update_fields=["status", "completed_at"])

            logger.info(
                f"XML Import completed for {self.user.username}: "
                f"{self.imported_count} imported, {self.fetched_count} fetched, "
                f"{self.skipped_count} skipped, {self.failed_count} failed"
            )

        except Exception as e:
            logger.error(f"Import failed: {e}")
            self.job.status = UserImportJob.ImportStatus.failed
            self.job.errors.append(str(e))
            self.job.save(update_fields=["status", "errors"])
            raise
        finally:
            self._cleanup()

class AniListImporter(BaseImporter):
    """Import from AniList GraphQL API"""

    API_URL = "https://graphql.anilist.co"

    # GraphQL query to get user's anime list
    LIST_QUERY = """
    query ($userName: String) {
        MediaListCollection(userName: $userName, type: ANIME) {
            lists {
                name
                entries {
                    id
                    mediaId
                    status
                    score
                    progress
                    media {
                        id
                        idMal
                        title {
                            romaji
                            english
                            native
                        }
                        episodes
                    }
                }
            }
        }
    }
    """

    def __init__(self, job: UserImportJob, username: str, access_token: Optional[str] = None):
        super().__init__(job)
        self.username = username
        self.access_token = access_token

    def fetch_user_list(self) -> List[Dict]:
        """Fetch user's anime list from AniList API"""
        entries = []

        headers = {"Content-Type": "application/json", "Accept": "application/json"}

        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        variables = {"userName": self.username}

        try:
            response = requests.post(
                self.API_URL,
                json={"query": self.LIST_QUERY, "variables": variables},
                headers=headers,
                timeout=30,
            )

            if response.status_code == 404:
                raise ValueError(f"User '{self.username}' not found")

            if response.status_code == 429:
                # Rate limited
                raise ValueError("Rate limited by AniList API. Please try again later.")

            response.raise_for_status()
            data = response.json()

            if "errors" in data:
                raise ValueError(f"AniList API error: {data['errors'][0]['message']}")

            lists = data["data"]["MediaListCollection"]["lists"]

            for list_data in lists:
                for entry in list_data["entries"]:
                    media = entry["media"]
                    entries.append(
                        {
                            "anilist_id": entry["mediaId"],
                            "mal_id": media.get("idMal"),
                            "title": media["title"]["romaji"]
                            or media["title"]["english"]
                            or media["title"]["native"],
                            "status": entry["status"],
                            "score": entry["score"],
                            "episodes_watched": entry["progress"],
                        }
                    )

            # Rate limiting - be nice to the API
            import time

            time.sleep(0.7)  # AniList recommends ~0.7s between requests

        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching AniList: {e}")
            raise

        return entries

    def import_entry(self, entry_data: Dict) -> Tuple[bool, str]:
        """Import a single entry from AniList data"""
        anilist_id = entry_data.get("anilist_id")
        mal_id = entry_data.get("mal_id")
        title = entry_data.get("title")

        # Map status
        anilist_status = entry_data.get("status")
        status = AniListStatusMapper.MAPPING.get(anilist_status)
        if not status:
            return False, f"Unknown status: {anilist_status}"

        # Convert score (AniList uses 0-100, we use 0-10)
        score = entry_data.get("score", 0)
        if score > 10:
            score = score // 10

        episodes_watched = entry_data.get("episodes_watched", 0)

        # Try to get or fetch anime (SYNCHRONOUS)
        anime = self.get_or_fetch_anime_sync(mal_id=mal_id, anilist_id=anilist_id, title=title)

        if not anime:
            return (
                False,
                f"Anime not found or could not be fetched (AniList ID: {anilist_id})",
            )

        return self.save_entry(anime, status, score, episodes_watched)

    def run(self):
        """Run the import process"""
        self.job.status = UserImportJob.ImportStatus.processing
        self.job.save(update_fields=["status"])

        try:
            # Fetch list
            entries = self.fetch_user_list()
            self.job.total_entries = len(entries)
            self.job.save(update_fields=["total_entries"])

            logger.info(
                f"Starting AniList import of {len(entries)} entries for user {self.user.username}"
            )

            # Import each entry
            for entry in entries:
                try:
                    success, message = self.import_entry(entry)

                    if success:
                        self.imported_count += 1
                    elif "Updated" in message:
                        self.imported_count += 1
                    elif "Skipped" in message:
                        self.skipped_count += 1
                    else:
                        self.failed_count += 1
                        self.errors.append(f"{entry.get('title', 'Unknown')}: {message}")

                except Exception as e:
                    self.failed_count += 1
                    self.errors.append(f"{entry.get('title', 'Unknown')}: {str(e)}")
                    logger.error(f"Error importing entry: {e}")

                self.update_job_progress()

            # Final flush of progress
            self.update_job_progress(force=True)

            # Mark as completed
            self.job.status = UserImportJob.ImportStatus.completed
            self.job.completed_at = timezone.now()
            self.job.save(update_fields=["status", "completed_at"])

            logger.info(
                f"AniList Import completed for {self.user.username}: "
                f"{self.imported_count} imported, {self.fetched_count} fetched, "
                f"{self.skipped_count} skipped, {self.failed_count} failed"
            )

        except Exception as e:
            logger.error(f"Import failed: {e}")
            self.job.status = UserImportJob.ImportStatus.failed
            self.job.errors.append(str(e))
            self.job.save(update_fields=["status", "errors"])
            raise
        finally:
            self._cleanup()

class ImportService:
    """Factory for creating importers"""

    @staticmethod
    def create_importer(job: UserImportJob, **kwargs) -> BaseImporter:
        """Create appropriate importer based on job source"""
        if job.source == UserImportJob.ImportSource.myanimelist_api:
            return MyAnimeListAPIImporter(
                job=job,
                username=kwargs.get("username"),
                client_id=kwargs.get("client_id"),
            )
        elif job.source == UserImportJob.ImportSource.myanimelist_xml:
            return MyAnimeListXMLImporter(job=job, xml_content=kwargs.get("xml_content"))
        elif job.source == UserImportJob.ImportSource.anilist:
            return AniListImporter(
                job=job,
                username=kwargs.get("username"),
                access_token=kwargs.get("access_token"),
            )
        else:
            raise ValueError(f"Unknown import source: {job.source}")