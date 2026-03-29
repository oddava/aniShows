import random
import time
from typing import Dict, List, Tuple

import requests
from django.core.cache import cache
from django.utils import timezone

from apps.shared.logger import logger
from apps.users.models import UserImportJob

from .base import AniListStatusMapper, BaseImporter


class AniListImporter(BaseImporter):
    """Import from AniList GraphQL API"""

    API_URL = "https://graphql.anilist.co"
    MAX_FETCH_RETRIES = 6
    BASE_BACKOFF_SECONDS = 2
    MAX_BACKOFF_SECONDS = 60
    GLOBAL_MIN_INTERVAL_SECONDS = 0.9
    THROTTLE_LOCK_KEY = "import:anilist:list:throttle_lock"
    NEXT_ALLOWED_KEY = "import:anilist:list:next_allowed_at"
    COOLDOWN_UNTIL_KEY = "import:anilist:list:cooldown_until"

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

    def _acquire_global_request_slot(self) -> None:
        """Serialize AniList list-fetch requests across workers."""
        while True:
            now = time.time()
            cooldown_until = float(cache.get(self.COOLDOWN_UNTIL_KEY) or 0.0)
            if now < cooldown_until:
                wait = min(cooldown_until - now, 5.0) + random.uniform(0.05, 0.2)
                time.sleep(max(wait, 0.05))
                continue

            if not cache.add(self.THROTTLE_LOCK_KEY, "1", timeout=5):
                time.sleep(0.05)
                continue

            wait_for_next = 0.0
            try:
                now = time.time()
                next_allowed = float(cache.get(self.NEXT_ALLOWED_KEY) or 0.0)
                if now < next_allowed:
                    wait_for_next = (next_allowed - now) + random.uniform(0.02, 0.12)
                else:
                    cache.set(
                        self.NEXT_ALLOWED_KEY,
                        now + self.GLOBAL_MIN_INTERVAL_SECONDS,
                        timeout=120,
                    )
                    return

            finally:
                cache.delete(self.THROTTLE_LOCK_KEY)

            time.sleep(max(wait_for_next, 0.05))

    def _set_global_cooldown(self, seconds: float) -> None:
        now = time.time()
        cooldown_until = now + max(seconds, 1.0)
        timeout = max(int(seconds) + 5, 10)
        cache.set(self.COOLDOWN_UNTIL_KEY, cooldown_until, timeout=timeout)

    def _retry_delay(self, attempt: int, response: requests.Response | None = None) -> float:
        if response is not None:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    return max(float(retry_after), 1.0)
                except ValueError:
                    pass

        backoff = min(self.BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)), self.MAX_BACKOFF_SECONDS)
        return backoff + random.uniform(0.2, 0.8)

    def fetch_user_list(self) -> List[Dict]:
        """Fetch user's anime list from AniList API"""
        headers = {"Content-Type": "application/json", "Accept": "application/json"}

        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        variables = {"userName": self.username}

        for attempt in range(1, self.MAX_FETCH_RETRIES + 1):
            self._acquire_global_request_slot()

            try:
                response = requests.post(
                    self.API_URL,
                    json={"query": self.LIST_QUERY, "variables": variables},
                    headers=headers,
                    timeout=30,
                )
            except requests.exceptions.RequestException as e:
                if attempt >= self.MAX_FETCH_RETRIES:
                    logger.error(f"Error fetching AniList list after retries: {e}")
                    raise ValueError(
                        "AniList API is currently unavailable. Please try again later."
                    ) from e

                wait = self._retry_delay(attempt)
                logger.warning(
                    f"AniList list fetch request failed (attempt {attempt}/{self.MAX_FETCH_RETRIES}): {e}. "
                    f"Retrying in {wait:.1f}s."
                )
                time.sleep(wait)
                continue

            if response.status_code == 404:
                raise ValueError(f"User '{self.username}' not found")

            if response.status_code == 429:
                wait = self._retry_delay(attempt, response=response)
                self._set_global_cooldown(wait)
                if attempt >= self.MAX_FETCH_RETRIES:
                    raise ValueError(
                        "AniList is rate limiting imports right now. Please try again in a few minutes."
                    )
                logger.warning(
                    f"AniList list fetch rate-limited (attempt {attempt}/{self.MAX_FETCH_RETRIES}). "
                    f"Waiting {wait:.1f}s."
                )
                time.sleep(wait)
                continue

            if response.status_code >= 500:
                wait = self._retry_delay(attempt, response=response)
                if attempt >= self.MAX_FETCH_RETRIES:
                    raise ValueError(
                        "AniList API returned repeated server errors. Please try again later."
                    )
                logger.warning(
                    f"AniList server error {response.status_code} "
                    f"(attempt {attempt}/{self.MAX_FETCH_RETRIES}). Waiting {wait:.1f}s."
                )
                time.sleep(wait)
                continue

            if response.status_code >= 400:
                try:
                    response_data = response.json()
                    if response_data.get("errors"):
                        detail = response_data["errors"][0].get("message", "")
                    else:
                        detail = response.text[:200]
                except Exception:
                    detail = response.text[:200]
                raise ValueError(
                    f"AniList API rejected the request ({response.status_code}): {detail}"
                )

            response.raise_for_status()
            data = response.json()

            if data.get("errors"):
                error_message = data["errors"][0].get("message", "Unknown AniList error")
                lowered = error_message.lower()
                if "rate limit" in lowered or "too many requests" in lowered:
                    wait = self._retry_delay(attempt)
                    self._set_global_cooldown(wait)
                    if attempt >= self.MAX_FETCH_RETRIES:
                        raise ValueError(
                            "AniList is rate limiting imports right now. Please try again in a few minutes."
                        )
                    logger.warning(
                        f"AniList GraphQL rate-limit error on list fetch "
                        f"(attempt {attempt}/{self.MAX_FETCH_RETRIES}). Waiting {wait:.1f}s."
                    )
                    time.sleep(wait)
                    continue

                if "not found" in lowered:
                    raise ValueError(f"User '{self.username}' not found")

                raise ValueError(f"AniList API error: {error_message}")

            collection = (data.get("data") or {}).get("MediaListCollection")
            if not collection:
                raise ValueError(
                    "Could not read AniList list. Ensure the username is correct and list is public."
                )

            lists = collection.get("lists") or []
            entries: List[Dict] = []

            for list_data in lists:
                for entry in list_data.get("entries") or []:
                    media = entry.get("media") or {}
                    titles = media.get("title") or {}
                    title = titles.get("romaji") or titles.get("english") or titles.get("native")
                    entries.append(
                        {
                            "anilist_id": entry.get("mediaId"),
                            "mal_id": media.get("idMal"),
                            "title": title,
                            "status": entry.get("status"),
                            "score": entry.get("score"),
                            "episodes_watched": entry.get("progress"),
                        }
                    )

            return entries

        raise ValueError("AniList import failed after multiple retries.")

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
        anime = self.get_or_fetch_anime_sync(
            mal_id=mal_id,
            anilist_id=anilist_id,
            title=title,
            allow_title_search=False,
        )

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
            self.trigger_post_import_refresh()

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
