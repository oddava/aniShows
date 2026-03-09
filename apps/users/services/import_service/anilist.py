import time
from typing import Dict, List, Optional, Tuple

import requests
from django.utils import timezone

from apps.shared.logger import logger
from apps.users.models import UserImportJob

from .base import AniListStatusMapper, BaseImporter


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

    def __init__(self, job: UserImportJob, username: str, access_token: str | None = None):
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

                    if success or "Updated" in message:
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
