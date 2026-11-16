"""AniList list import (full) and the linked-account sync (incremental)."""

from __future__ import annotations

from django.db.models import F
from django.utils import timezone

from ....shared.logger import logger
from ...models import UserImportJob, UserListLink
from .anilist_fetch import AniListFetcher, AniListFetchError
from .base import BaseImporter, ImportSourceError
from .entries import ImportedEntry, anilist_entry

# Fetch failures that are about the user's list, not AniList's availability.
PERMANENT_FETCH_ERRORS = frozenset({"not_found", "private"})


def _stamp(entry: ImportedEntry) -> int:
    return int(entry.remote_updated_at.timestamp())


class AniListImporter(BaseImporter):
    """Reads a public AniList list by username. No token: none ever reaches the worker."""

    source_name = "anilist"

    def __init__(self, job: UserImportJob, username: str, *, fetcher: AniListFetcher | None = None):
        super().__init__(job, fetcher=fetcher)
        self.username = username
        # A job for the user's linked AniList name also moves the link's sync state.
        self.link = (
            UserListLink.objects.filter(
                user=job.user,
                provider=UserListLink.Provider.anilist,
                external_username__iexact=username,
            ).first()
            if username
            else None
        )
        self._anilist_user_id: int | None = None

    @property
    def incremental(self) -> bool:
        return (
            self.job.mode == UserImportJob.ImportMode.incremental
            and self.link is not None
            and self.link.cursor_updated_at is not None
        )

    def load_entries(self) -> list[ImportedEntry]:
        try:
            if self.incremental:
                rows = self.fetcher.fetch_recent_entries(
                    self.username, since=self.link.cursor_updated_at
                )
            else:
                rows, self._anilist_user_id = self.fetcher.fetch_list_collection(self.username)
        except AniListFetchError as exc:
            raise ImportSourceError(
                exc.message, transient=exc.code not in PERMANENT_FETCH_ERRORS
            ) from exc
        return [anilist_entry(row) for row in rows]

    def next_cursor(self, entries: list[ImportedEntry]) -> int | None:
        """The newest ``updatedAt`` applied, but never past an entry left for later.

        An incremental sync reads only what changed after the cursor, so an entry that
        was skipped for a reason that may pass (catalog cap, AniList busy, a bad payload)
        keeps the cursor just below it and is read again next time.
        """
        previous = self.link.cursor_updated_at if self.link else None
        stamps = [_stamp(e) for e in entries if e.remote_updated_at]
        cursor = max([*stamps, previous or 0]) or None
        pending = [_stamp(e) for e in self.retry_entries if e.remote_updated_at]
        if pending and cursor is not None:
            cursor = min(cursor, min(pending) - 1)
            if previous is not None:
                cursor = max(cursor, previous)
        return cursor

    def on_success(self, entries: list[ImportedEntry]) -> None:
        if self.link is None:
            return
        cursor = self.next_cursor(entries)
        fields = {
            "cursor_updated_at": cursor,
            "last_synced_at": timezone.now(),
            "last_error": "",
            "consecutive_failures": 0,
        }
        if self._anilist_user_id:
            fields["external_user_id"] = self._anilist_user_id
        UserListLink.objects.filter(pk=self.link.pk).update(**fields)
        logger.info("AniList link synced", extra={"user_id": self.user.id, "cursor": cursor})

    def on_source_error(self, error: ImportSourceError) -> None:
        if self.link is None:
            return
        fields: dict = {"last_error": str(error)[:255]}
        if not error.transient:
            # Only the list itself failing (gone, private) counts towards pausing auto-sync.
            fields["consecutive_failures"] = F("consecutive_failures") + 1
        UserListLink.objects.filter(pk=self.link.pk).update(**fields)
