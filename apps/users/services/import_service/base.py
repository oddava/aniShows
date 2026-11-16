"""The shared import pipeline: load → resolve in bulk → merge → batched writes (spec 3 P0-3/P0-4/P1-3).

Each source only implements ``load_entries()``. The rest is common:

- **Resolution.** Local catalog rows are looked up in bulk by AniList id, then MAL id;
  a title is used only for an entry that has no stable id at all. Unknown ids are
  fetched from AniList 25 per request through the shared background budget, at most
  ``MAX_UNKNOWN_FETCHES`` per job; the rest are reported as ``not_in_catalog_yet``.
- **Merge (non-destructive).** New entries are created. An existing entry takes the
  remote values only when the remote changed after the local edit
  (``remote_updated_at > updated_at``); without a remote timestamp (MAL XML) only empty
  local fields are filled. A remote 0 never clears a local score. The same transition
  normalizer as the API runs (``list_rules``, lenient mode, no invented dates).
- **Writes.** ``bulk_create`` / ``bulk_update`` in batches, so no per-row signals; the
  derived caches, stats and recommendations are refreshed once at the end.
- **Lifecycle.** Progress and a heartbeat are flushed as it goes; a flush that finds the
  job no longer ``processing`` (cancelled) stops the run, and the job never becomes
  ``completed`` over ``cancelled``. ``SoftTimeLimitExceeded`` is never swallowed: the
  job fails with a reason that says how far it got, and "Run it again" continues.
"""

from __future__ import annotations

import time
from datetime import timedelta
from typing import Any

from celery.exceptions import SoftTimeLimitExceeded
from django.core.cache import cache
from django.db import InterfaceError, OperationalError, transaction
from django.utils import timezone

from ....animes.models import Anime
from ....shared.errors import CACHE_ERRORS, ENQUEUE_ERRORS
from ....shared.logger import logger
from ...models import UserAnimeList, UserImportJob
from ..list_rules import normalize_entry, user_today
from .anilist_fetch import AniListFetcher, AniListFetchError, save_media
from .entries import (
    REASON_INVALID,
    REASON_NOT_FOUND,
    REASON_NOT_IN_CATALOG_YET,
    REASON_UNKNOWN_STATUS,
    ImportedEntry,
)

RETRY_REASONS = frozenset({REASON_NOT_IN_CATALOG_YET, REASON_INVALID})
RETRYABLE_DB_ERRORS = (OperationalError, InterfaceError)

ACTIVE_STATUSES = (UserImportJob.ImportStatus.pending, UserImportJob.ImportStatus.processing)
# Fields an import writes on an existing entry.
ENTRY_FIELDS = (
    "status",
    "score",
    "episodes_watched",
    "notes",
    "started_at",
    "finished_at",
    "total_rewatches",
    "is_rewatching",
)


class ImportSourceError(Exception):
    """The source cannot be read (unknown user, private list, bad file): fail with this message.

    ``transient`` marks a failure of the source itself (busy, down), not of the user's
    list, so a linked account is not penalised for it.
    """

    def __init__(self, message: str, *, transient: bool = False):
        super().__init__(message)
        self.transient = transient


class ImportCancelledError(Exception):
    """The job left ``processing`` while running (the user cancelled it)."""


class BaseImporter:
    """One import job. Subclasses implement ``load_entries``."""

    # Flush progress at most every N entries, and only when a second has passed, so a
    # fast merge of known titles costs a handful of queries; fetch pages always flush.
    PROGRESS_FLUSH_INTERVAL = 10
    PROGRESS_FLUSH_MIN_SECONDS = 1.0
    WRITE_BATCH_SIZE = 500
    MAX_UNKNOWN_FETCHES = 500
    MAX_UNMATCHED_STORED = 200
    MAX_ERRORS_STORED = 10
    MISSING_ANIME_CACHE_TTL_SECONDS = 6 * 60 * 60
    source_name = "import"

    def __init__(self, job: UserImportJob, *, fetcher: AniListFetcher | None = None):
        self.job = job
        self.user = job.user
        self.errors: list[str] = []
        self.unmatched: list[dict[str, Any]] = []
        self.imported_count = 0
        self.skipped_count = 0
        self.failed_count = 0
        self.fetched_count = 0
        self.processed_count = 0
        self.total_count = 0
        self._fetcher = fetcher
        self._owns_fetcher = fetcher is None
        self._persistence = None
        self._to_create: list[UserAnimeList] = []
        self._to_update: list[UserAnimeList] = []
        self._touched_anime_ids: set[int] = set()
        # Entries left out for a reason that may pass (catalog cap, AniList busy, a bad
        # payload, an entry error): an incremental sync must not move its cursor past them.
        self.retry_entries: list[ImportedEntry] = []
        self._last_flush = 0.0
        self._today = user_today(self.user)

    # ------------------------------------------------------------------ hooks

    def load_entries(self) -> list[ImportedEntry]:
        raise NotImplementedError

    def on_success(self, entries: list[ImportedEntry]) -> None:
        """Called after a completed run (AniList updates the linked account)."""

    def on_source_error(self, error: ImportSourceError) -> None:
        """Called when the source could not be read."""

    # ------------------------------------------------------------------ helpers

    @property
    def fetcher(self) -> AniListFetcher:
        if self._fetcher is None:
            self._fetcher = AniListFetcher()
        return self._fetcher

    def _get_persistence(self):
        if self._persistence is None:
            from ....animes.services.anilist import AniListService

            self._persistence = AniListService(enable_caching=True, enable_rate_limiting=True)
        return self._persistence

    def _cleanup(self) -> None:
        for resource, owned in ((self._fetcher, self._owns_fetcher), (self._persistence, True)):
            if resource is None or not owned:
                continue
            try:
                resource.close()
            except Exception:
                logger.debug("Failed to close an import resource", exc_info=True)
        self._fetcher = None if self._owns_fetcher else self._fetcher
        self._persistence = None

    def _record_unmatched(self, entry: ImportedEntry, reason: str) -> None:
        self.failed_count += 1
        if reason in RETRY_REASONS:
            self.retry_entries.append(entry)
        if len(self.unmatched) < self.MAX_UNMATCHED_STORED:
            self.unmatched.append(entry.unmatched(reason))

    def _job_queryset(self):
        return UserImportJob.objects.filter(pk=self.job.pk)

    def _counters(self) -> dict[str, Any]:
        return {
            "total_entries": self.total_count,
            "processed_entries": self.processed_count,
            "imported_entries": self.imported_count,
            "skipped_entries": self.skipped_count,
            "failed_entries": self.failed_count,
            "fetched_entries": self.fetched_count,
            "errors": self.errors[-self.MAX_ERRORS_STORED :],
            "unmatched": self.unmatched,
        }

    def flush(self, *, force: bool = False) -> None:
        """Write progress + heartbeat; stop the run if the job is no longer processing."""
        now = time.monotonic()
        if not force and now - self._last_flush < self.PROGRESS_FLUSH_MIN_SECONDS:
            return
        self._last_flush = now
        updated = self._job_queryset().filter(status=UserImportJob.ImportStatus.processing)
        if not updated.update(heartbeat_at=timezone.now(), **self._counters()):
            raise ImportCancelledError

    def _tick(self) -> None:
        self.processed_count += 1
        if self.processed_count % self.PROGRESS_FLUSH_INTERVAL == 0:
            self.flush()

    # ------------------------------------------------------------------ resolution

    @staticmethod
    def _dedupe(entries: list[ImportedEntry]) -> list[ImportedEntry]:
        seen: set[tuple] = set()
        unique = []
        for entry in entries:
            key = entry.key()
            if key in seen:
                continue
            seen.add(key)
            unique.append(entry)
        return unique

    def _missing_key(self, entry: ImportedEntry) -> str:
        if entry.anilist_id:
            return f"import:missing:anilist:{entry.anilist_id}"
        return f"import:missing:mal:{entry.mal_id}"

    def _known_missing(self, entries: list[ImportedEntry]) -> set[str]:
        keys = [self._missing_key(entry) for entry in entries]
        try:
            return set(cache.get_many(keys)) if keys else set()
        except CACHE_ERRORS:
            return set()

    def _remember_missing(self, entries: list[ImportedEntry]) -> None:
        if not entries:
            return
        try:
            cache.set_many(
                {self._missing_key(entry): True for entry in entries},
                timeout=self.MISSING_ANIME_CACHE_TTL_SECONDS,
            )
        except CACHE_ERRORS:
            logger.debug("Could not cache missing import ids", exc_info=True)

    def resolve(self, entries: list[ImportedEntry]) -> tuple[dict[tuple, Anime], dict[tuple, str]]:
        """Map each entry key to its ``Anime``, or to the reason it has none."""
        by_anilist = {
            anime.anilist_id: anime
            for anime in Anime.objects.filter(
                anilist_id__in={e.anilist_id for e in entries if e.anilist_id}
            )
        }
        mal_lookup = {e.mal_id for e in entries if e.mal_id and e.anilist_id not in by_anilist}
        by_mal = {anime.mal_id: anime for anime in Anime.objects.filter(mal_id__in=mal_lookup)}

        resolved: dict[tuple, Anime] = {}
        unknown: list[ImportedEntry] = []
        for entry in entries:
            anime = by_anilist.get(entry.anilist_id) or by_mal.get(entry.mal_id)
            if anime is None and not entry.anilist_id and not entry.mal_id and entry.title:
                # No stable id at all: the only case a title may bind an entry.
                anime = Anime.objects.filter(title__iexact=entry.title).order_by("id").first()
                if anime is None:
                    continue
            if anime is not None:
                resolved[entry.key()] = anime
            elif entry.anilist_id or entry.mal_id:
                unknown.append(entry)

        reasons: dict[tuple, str] = {}
        if unknown:
            self._fetch_unknown(unknown, resolved, reasons)
        return resolved, reasons

    def _fetch_unknown(
        self,
        unknown: list[ImportedEntry],
        resolved: dict[tuple, Anime],
        reasons: dict[tuple, str],
    ) -> None:
        known_missing = self._known_missing(unknown)
        candidates = []
        for entry in unknown:
            if self._missing_key(entry) in known_missing:
                reasons[entry.key()] = REASON_NOT_FOUND
            else:
                candidates.append(entry)
        for entry in candidates[self.MAX_UNKNOWN_FETCHES :]:
            reasons[entry.key()] = REASON_NOT_IN_CATALOG_YET
        candidates = candidates[: self.MAX_UNKNOWN_FETCHES]
        if not candidates:
            return

        by_anilist = {e.anilist_id: e for e in candidates if e.anilist_id}
        by_mal = {e.mal_id: e for e in candidates if not e.anilist_id}
        pages = self.fetcher.fetch_media_by_ids(anilist_ids=list(by_anilist), mal_ids=list(by_mal))
        try:
            for page in pages:
                for item in page:
                    entry = by_anilist.get(item.get("id")) or by_mal.get(item.get("idMal"))
                    if entry is None or entry.key() in resolved:
                        continue
                    try:
                        with transaction.atomic():
                            resolved[entry.key()] = save_media(self._get_persistence(), item)
                        self.fetched_count += 1
                    except SoftTimeLimitExceeded:
                        raise
                    except Exception:
                        logger.warning(
                            "Could not store an imported title",
                            extra={"anilist_id": item.get("id"), "job_id": self.job.pk},
                            exc_info=True,
                        )
                        reasons[entry.key()] = REASON_INVALID
                self.flush(force=True)
        except AniListFetchError as exc:
            # AniList is busy: keep what resolved, the rest waits for "Run it again".
            logger.warning("Catalog fetch stopped during import: %s", exc.code)
            self.errors.append(exc.message)
            for entry in candidates:
                if entry.key() not in resolved:
                    reasons.setdefault(entry.key(), REASON_NOT_IN_CATALOG_YET)
            return

        missing = [e for e in candidates if e.key() not in resolved and e.key() not in reasons]
        for entry in missing:
            reasons[entry.key()] = REASON_NOT_FOUND
        self._remember_missing(missing)

    # ------------------------------------------------------------------ merge

    @staticmethod
    def _remote_fields(entry: ImportedEntry) -> dict[str, Any]:
        return {
            "status": entry.status,
            "score": entry.score,
            "episodes_watched": entry.progress,
            "notes": entry.notes,
            "started_at": entry.started,
            "finished_at": entry.finished,
            "total_rewatches": entry.repeat,
            "is_rewatching": entry.is_rewatching,
        }

    @staticmethod
    def _fill_empty(entry: ImportedEntry, local: UserAnimeList) -> dict[str, Any]:
        """No remote timestamp: take a remote value only where the local one is empty."""
        attrs: dict[str, Any] = {}
        if not local.score and entry.score:
            attrs["score"] = entry.score
        if not local.episodes_watched and entry.progress:
            attrs["episodes_watched"] = entry.progress
        if local.started_at is None and entry.started:
            attrs["started_at"] = entry.started
        if local.finished_at is None and entry.finished:
            attrs["finished_at"] = entry.finished
        if not local.notes and entry.notes:
            attrs["notes"] = entry.notes
        if not local.total_rewatches and entry.repeat:
            attrs["total_rewatches"] = entry.repeat
        return attrs

    def _newer_remote(self, entry: ImportedEntry) -> dict[str, Any]:
        attrs = self._remote_fields(entry)
        if not entry.score:
            attrs.pop("score")  # a remote 0 means "not rated", never "clear my score"
        if not entry.notes:
            attrs.pop("notes")
        for field in ("started_at", "finished_at"):
            if attrs[field] is None:
                attrs.pop(field)
        return attrs

    def merge(self, entry: ImportedEntry, anime: Anime, local: UserAnimeList | None) -> None:
        if local is None:
            attrs = normalize_entry(
                None, self._remote_fields(entry), anime, self._today, strict=False
            )
            self._to_create.append(UserAnimeList(user=self.user, anime=anime, **attrs))
            self._touched_anime_ids.add(anime.id)
            self.imported_count += 1
            return

        if entry.remote_updated_at is not None:
            if local.updated_at and entry.remote_updated_at <= local.updated_at:
                self.skipped_count += 1  # edited here after the remote change: keep it
                return
            attrs = self._newer_remote(entry)
        else:
            attrs = self._fill_empty(entry, local)
        if not attrs:
            self.skipped_count += 1
            return

        attrs = normalize_entry(local, attrs, anime, self._today, strict=False)
        changed = False
        for field in ENTRY_FIELDS:
            if field in attrs and getattr(local, field) != attrs[field]:
                setattr(local, field, attrs[field])
                changed = True
        if not changed:
            self.skipped_count += 1
            return
        local.updated_at = timezone.now()
        self._to_update.append(local)
        self._touched_anime_ids.add(anime.id)
        self.imported_count += 1

    def write_pending(self, *, force: bool = False) -> None:
        pending = len(self._to_create) + len(self._to_update)
        if not pending or (not force and pending < self.WRITE_BATCH_SIZE):
            return
        with transaction.atomic():
            if self._to_create:
                # A concurrent manual add wins; the import does not fail on it.
                UserAnimeList.objects.bulk_create(
                    self._to_create, batch_size=self.WRITE_BATCH_SIZE, ignore_conflicts=True
                )
            if self._to_update:
                UserAnimeList.objects.bulk_update(
                    self._to_update,
                    [*ENTRY_FIELDS, "updated_at"],
                    batch_size=self.WRITE_BATCH_SIZE,
                )
        self._to_create, self._to_update = [], []

    # ------------------------------------------------------------------ lifecycle

    def _prepare(self, entries: list[ImportedEntry]) -> list[ImportedEntry]:
        from django.conf import settings

        entries = self._dedupe(entries)
        cap = int(settings.MAX_IMPORT_XML_ENTRIES)
        if len(entries) > cap:
            self.errors.append(f"Only the first {cap} entries were imported.")
            self.retry_entries.extend(entries[cap:])
            entries = entries[:cap]
        self.total_count = len(entries)
        self.flush(force=True)
        return entries

    def _process(self, entries: list[ImportedEntry]) -> None:
        valid = []
        for entry in entries:
            if entry.status is None:
                self._record_unmatched(entry, REASON_UNKNOWN_STATUS)
                self._tick()
            else:
                valid.append(entry)

        resolved, reasons = self.resolve(valid)
        existing = {
            row.anime_id: row
            for row in UserAnimeList.objects.filter(
                user=self.user, anime_id__in={anime.id for anime in resolved.values()}
            )
        }
        for entry in valid:
            anime = resolved.get(entry.key())
            if anime is None:
                self._record_unmatched(entry, reasons.get(entry.key(), REASON_NOT_FOUND))
            else:
                try:
                    self.merge(entry, anime, existing.get(anime.id))
                except SoftTimeLimitExceeded:
                    raise
                except Exception as exc:
                    logger.warning("Import entry failed", exc_info=True)
                    self.failed_count += 1
                    self.retry_entries.append(entry)
                    self.errors.append(f"{entry.title or 'Unknown'}: {exc}")
            self.write_pending()
            self._tick()

    def _set_terminal(self, status: str, **fields) -> int:
        """Move the job out of an active status (never over ``cancelled``/``failed``).

        A completed job drops its stored file entries; a failed one keeps them so a
        requeue (admin retry, or the task's own retry) can run again without the file.
        """
        if status == UserImportJob.ImportStatus.completed:
            fields["payload"] = None
        return (
            self._job_queryset()
            .filter(status__in=ACTIVE_STATUSES)
            .update(
                status=status,
                completed_at=timezone.now(),
                heartbeat_at=timezone.now(),
                **self._counters(),
                **fields,
            )
        )

    def _store_counters(self) -> None:
        """Final counters on a cancelled job (its status is already set)."""
        self._job_queryset().update(heartbeat_at=timezone.now(), payload=None, **self._counters())

    def refresh_derived_data(self) -> None:
        """One refresh after the batched writes: caches, stats, site counts, recommendations."""
        if not self._touched_anime_ids:
            return
        from ....animes.services.user_list_side_effects import (
            invalidate_heatmap_cache,
            invalidate_site_status_counts,
            schedule_recommendations_debounced,
        )
        from ..cache import invalidate_user_caches
        from ..list_service import invalidate_lists_summary

        try:
            invalidate_user_caches(self.user.id, self.user.username)
            invalidate_heatmap_cache(self.user.id)
            invalidate_lists_summary(self.user.id)
            invalidate_site_status_counts(self._touched_anime_ids)
        except CACHE_ERRORS:
            logger.warning("Post-import cache refresh failed", exc_info=True)
        try:
            from ....animes.tasks.recommendations import generate_recommendations

            schedule_recommendations_debounced(
                self.user.id, task=generate_recommendations, countdown=30
            )
        except (*ENQUEUE_ERRORS, *CACHE_ERRORS):
            logger.warning("Could not queue post-import recommendations", exc_info=True)

    def _fail(self, reason: str) -> None:
        self.errors.append(reason)
        self._set_terminal(UserImportJob.ImportStatus.failed, failure_reason=reason)

    def run(self) -> dict[str, Any]:
        self._job_queryset().filter(status__in=ACTIVE_STATUSES).update(
            status=UserImportJob.ImportStatus.processing, heartbeat_at=timezone.now()
        )
        outcome = "completed"
        try:
            entries = self._prepare(self.load_entries())
            self._process(entries)
            self.write_pending(force=True)
            if self._set_terminal(UserImportJob.ImportStatus.completed):
                self.on_success(entries)
            else:
                outcome = "cancelled"
                self._store_counters()
        except ImportCancelledError:
            outcome = "cancelled"
            self.write_pending(force=True)
            self._store_counters()
        except ImportSourceError as exc:
            outcome = "failed"
            self.on_source_error(exc)
            self._fail(str(exc))
        except SoftTimeLimitExceeded:
            outcome = "failed"
            self.write_pending(force=True)
            self._fail(
                f"Took too long; {self.processed_count} of {self.total_count} processed. "
                "Run it again to continue."
            )
            raise
        except RETRYABLE_DB_ERRORS:
            # The database dropped out: leave the job processing so the task's retry
            # resumes it (the merge skips what was already written); the task fails
            # the job if the retries run out.
            outcome = "retrying"
            raise
        except Exception:
            outcome = "failed"
            logger.exception("Import failed", extra={"job_id": self.job.pk})
            self._fail("The import stopped because of an unexpected error. Please try again.")
            raise
        finally:
            try:
                self.refresh_derived_data()
            finally:
                self._cleanup()
        logger.info(
            "Import finished",
            extra={
                "job_id": self.job.pk,
                "source": self.source_name,
                "outcome": outcome,
                "imported": self.imported_count,
                "skipped": self.skipped_count,
                "failed": self.failed_count,
                "fetched": self.fetched_count,
            },
        )
        return {
            "outcome": outcome,
            "imported": self.imported_count,
            "skipped": self.skipped_count,
            "failed": self.failed_count,
            "fetched": self.fetched_count,
        }


def stale_processing_cutoff(hours: int = 2):
    return timezone.now() - timedelta(hours=hours)
