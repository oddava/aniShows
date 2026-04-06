import os
import time
from typing import Dict, List, Optional, Tuple

import requests
from django.utils import timezone

from apps.shared.logger import logger
from apps.users.models import UserImportJob

from .base import BaseImporter, MALStatusMapper


class MyAnimeListAPIImporter(BaseImporter):
    """Import from MyAnimeList API"""

    BASE_URL = "https://api.myanimelist.net/v2"
    MAX_PAGE_RETRIES = 5
    BASE_BACKOFF_SECONDS = 2
    MAX_BACKOFF_SECONDS = 30

    def __init__(self, job: UserImportJob, username: str, client_id: str | None = None):
        super().__init__(job)
        self.username = username
        # Get client_id from parameter, env var, or raise error - no hardcoded fallback
        self.client_id = client_id or os.getenv("MAL_CLIENT_ID")
        if not self.client_id:
            raise ValueError(
                "MAL_CLIENT_ID environment variable is required for MyAnimeList API imports. "
                "Please set it in your .env file or environment."
            )

    def _retry_delay(self, attempt: int, response: requests.Response | None = None) -> float:
        if response is not None:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    return max(float(retry_after), 1.0)
                except ValueError:
                    pass
        return min(self.BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)), self.MAX_BACKOFF_SECONDS)

    def fetch_user_list(self) -> List[Dict]:
        """Fetch user's anime list from MAL API"""
        entries = []
        offset = 0
        limit = 100
        attempt = 0

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
                    attempt += 1
                    if attempt > self.MAX_PAGE_RETRIES:
                        logger.error(
                            "MAL list fetch exceeded rate-limit retries",
                            extra={"username": self.username, "offset": offset},
                        )
                        raise ValueError(
                            "MyAnimeList is rate limiting imports right now. Please try again later."
                        )
                    wait = self._retry_delay(attempt, response=response)
                    logger.warning(
                        "MAL list fetch rate-limited; retrying",
                        extra={
                            "username": self.username,
                            "offset": offset,
                            "attempt": attempt,
                            "wait_seconds": wait,
                        },
                    )
                    time.sleep(wait)
                    continue

                if response.status_code >= 500:
                    attempt += 1
                    if attempt > self.MAX_PAGE_RETRIES:
                        logger.error(
                            "MAL list fetch exceeded server-error retries",
                            extra={
                                "username": self.username,
                                "offset": offset,
                                "status_code": response.status_code,
                            },
                        )
                        raise ValueError(
                            "MyAnimeList API is currently unavailable. Please try again later."
                        )
                    wait = self._retry_delay(attempt, response=response)
                    logger.warning(
                        "MAL list fetch server error; retrying",
                        extra={
                            "username": self.username,
                            "offset": offset,
                            "status_code": response.status_code,
                            "attempt": attempt,
                            "wait_seconds": wait,
                        },
                    )
                    time.sleep(wait)
                    continue

                response.raise_for_status()
                data = response.json()
                attempt = 0

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
                time.sleep(0.5)

            except requests.exceptions.RequestException as e:
                attempt += 1
                if attempt > self.MAX_PAGE_RETRIES:
                    logger.error(
                        "Error fetching MAL list after retries",
                        extra={"username": self.username, "offset": offset},
                        exc_info=True,
                    )
                    raise ValueError(
                        "MyAnimeList API is currently unavailable. Please try again later."
                    ) from e
                wait = self._retry_delay(attempt)
                logger.warning(
                    "MAL list fetch request failed; retrying",
                    extra={
                        "username": self.username,
                        "offset": offset,
                        "attempt": attempt,
                        "wait_seconds": wait,
                    },
                )
                time.sleep(wait)

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
        anime = self.get_or_fetch_anime_sync(
            mal_id=mal_id,
            title=title,
            allow_title_search=False,
        )

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
            self.trigger_post_import_refresh()

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
