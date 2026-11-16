"""AniList list import (full) and the linked-account sync (incremental)."""

from __future__ import annotations

from django.db.models import F
from django.utils import timezone

from ....shared.logger import logger
from ...models import UserImportJob, UserListLink
from .anilist_fetch import AniListFetcher, AniListFetchError
from .base import BaseImporter, ImportSourceError
from .entries import ImportedEntry, anilist_entry


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
            raise ImportSourceError(exc.message) from exc
        return [anilist_entry(row) for row in rows]

    def on_success(self, entries: list[ImportedEntry]) -> None:
        if self.link is None:
            return
        stamps = [int(e.remote_updated_at.timestamp()) for e in entries if e.remote_updated_at]
        cursor = max([*stamps, self.link.cursor_updated_at or 0]) or None
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
        UserListLink.objects.filter(pk=self.link.pk).update(
            last_error=str(error)[:255], consecutive_failures=F("consecutive_failures") + 1
        )
