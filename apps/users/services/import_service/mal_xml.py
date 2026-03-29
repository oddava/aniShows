from typing import Dict, List, Tuple

from defusedxml import ElementTree
from django.utils import timezone

from apps.shared.logger import logger
from apps.users.models import UserImportJob

from .base import BaseImporter, MALStatusMapper


class MyAnimeListXMLImporter(BaseImporter):
    """Import from MyAnimeList XML export file"""

    def __init__(self, job: UserImportJob, xml_content: str):
        super().__init__(job)
        self.xml_content = xml_content

    def parse_xml(self) -> List[Dict]:
        """Parse MAL XML export and return list of entries"""
        entries = []

        try:
            root = ElementTree.fromstring(self.xml_content)

            for anime_elem in root.findall("anime"):
                entry = {
                    "mal_id": self._get_int(anime_elem, "series_animedb_id"),
                    "title": self._get_text(anime_elem, "series_title"),
                    "status": self._get_text(anime_elem, "my_status"),
                    "score": self._get_int(anime_elem, "my_score"),
                    "episodes_watched": self._get_int(anime_elem, "my_watched_episodes"),
                }
                entries.append(entry)

        except ElementTree.ParseError as e:
            logger.error(f"Error parsing XML: {e}")
            raise ValueError("Invalid XML file format")

        return entries

    def _get_text(self, elem, tag: str) -> str | None:
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
