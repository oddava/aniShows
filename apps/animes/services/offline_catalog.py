"""Import the anime-offline-database (manami-project) into the catalog.

This module runs an import: it opens the source (local file or release
asset, zstd or plain JSONL), streams it line by line and hands batches on.
Parsing records lives in ``offline_catalog_parsing``, matching them to
existing rows in ``offline_catalog_matching`` and saving them in
``offline_catalog_persistence``.
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from importlib import import_module
from pathlib import Path
from typing import Any

import httpx
from django.utils import timezone

from ...shared.logger import logger
from ..models import Anime, OfflineCatalogImport
from . import offline_catalog_parsing as parsing
from .metadata_health import PLACEHOLDER_SYNOPSIS
from .offline_catalog_parsing import OfflineCatalogEntry
from .offline_catalog_persistence import OfflineCatalogPersistence
from .offline_sync import OfflineSyncService

__all__ = [
    "DEFAULT_ASSET_NAME",
    "PLACEHOLDER_SYNOPSIS",
    "OfflineCatalogEntry",
    "OfflineCatalogImportService",
]

DEFAULT_ASSET_NAME = "anime-offline-database.jsonl.zst"
DEFAULT_BATCH_SIZE = 250
DEFAULT_ENRICHMENT_CHUNK_SIZE = 100
DEFAULT_THEME_BASE_DELAY_SECONDS = 1.0
LATEST_DOWNLOAD_URL = (
    "https://github.com/manami-project/anime-offline-database/releases/latest/download/"
    f"{DEFAULT_ASSET_NAME}"
)


@dataclass(slots=True)
class _ChangedIds:
    """Anime IDs an import created and updated, in the order it touched them."""

    created: list[int] = field(default_factory=list)
    updated: list[int] = field(default_factory=list)


class _IteratorStream(io.RawIOBase):
    def __init__(self, iterator):
        self._iterator = iterator
        self._leftover = b""
        self._closed = False

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:
        if self._closed:
            return 0

        target = memoryview(buffer)
        bytes_read = 0

        while bytes_read < len(target):
            if self._leftover:
                chunk = self._leftover
                self._leftover = b""
            else:
                try:
                    chunk = next(self._iterator)
                except StopIteration:
                    self._closed = True
                    break

            size = min(len(chunk), len(target) - bytes_read)
            target[bytes_read : bytes_read + size] = chunk[:size]
            bytes_read += size

            if size < len(chunk):
                self._leftover = chunk[size:]
                break

        return bytes_read


class OfflineCatalogImportService(OfflineCatalogPersistence):
    # Kept as a method for callers that parse source URLs on their own.
    _extract_provider_ids = staticmethod(parsing.extract_provider_ids)

    def __init__(
        self,
        *,
        batch_size: int = DEFAULT_BATCH_SIZE,
        enrichment_chunk_size: int = DEFAULT_ENRICHMENT_CHUNK_SIZE,
    ):
        self.batch_size = max(1, int(batch_size))
        self.enrichment_chunk_size = max(1, int(enrichment_chunk_size))
        self._init_fallback_indexes()

    def run_import(
        self,
        *,
        release_tag: str = "latest",
        asset_name: str = DEFAULT_ASSET_NAME,
        source_url: str | None = None,
        source_path: str | None = None,
        limit: int | None = None,
        resume: bool = False,
        enqueue_enrichment: bool = False,
    ) -> dict[str, Any]:
        """Stream the offline database into Anime rows; resumable from the last line."""
        import_run = self._start_import_run(
            release_tag=release_tag,
            asset_name=asset_name,
            source_url=source_url or self._build_source_url(release_tag, asset_name),
            resume=resume,
        )
        run_started_at = import_run.started_at
        summary = self._initial_summary(import_run, release_tag=release_tag, asset_name=asset_name)
        changed = _ChangedIds()

        try:
            with self._open_source_stream(
                source_url=import_run.source_url, source_path=source_path
            ) as text_stream:
                self._import_lines(
                    text_stream,
                    import_run,
                    summary,
                    changed,
                    seen_at=run_started_at,
                    resume=resume,
                    limit=limit,
                )

            import_run.records_marked_stale = Anime.objects.filter(
                offline_db_last_seen_at__isnull=False,
                offline_db_last_seen_at__lt=run_started_at,
            ).count()

            followup_ids, new_ids = self._followup_ids(changed, run_started_at, resume=resume)
            if enqueue_enrichment:
                new_id_set = set(new_ids)
                summary.update(
                    self._initialize_sync_states(
                        new_ids,
                        [anime_id for anime_id in followup_ids if anime_id not in new_id_set],
                    )
                )
                summary.update(self._enqueue_enrichment(followup_ids, []))

            self._complete_import_run(import_run, summary)
        except Exception as exc:
            import_run.status = OfflineCatalogImport.Status.FAILED
            import_run.error_message = str(exc)
            import_run.completed_at = timezone.now()
            import_run.save(update_fields=["status", "error_message", "completed_at", "updated_at"])
            logger.error("Offline catalog import failed", exc_info=True)
            raise

        summary.update(
            {
                "records_seen": import_run.records_seen,
                "records_created": import_run.records_created,
                "records_updated": import_run.records_updated,
                "records_failed": import_run.records_failed,
                "records_marked_stale": import_run.records_marked_stale,
                "changed_anime_ids": list(dict.fromkeys(followup_ids)),
            }
        )
        return summary

    def _start_import_run(
        self, *, release_tag: str, asset_name: str, source_url: str, resume: bool
    ) -> OfflineCatalogImport:
        started_at = timezone.now()
        import_run = self._prepare_import_run(
            release_tag=release_tag,
            asset_name=asset_name,
            source_url=source_url,
            resume=resume,
        )
        import_run.status = OfflineCatalogImport.Status.RUNNING
        import_run.started_at = import_run.started_at or started_at
        import_run.error_message = ""
        import_run.save(
            update_fields=["status", "started_at", "error_message", "source_url", "release_tag"]
        )
        return import_run

    @staticmethod
    def _initial_summary(
        import_run: OfflineCatalogImport, *, release_tag: str, asset_name: str
    ) -> dict[str, Any]:
        return {
            "import_run_id": import_run.id,
            "release_tag": release_tag,
            "asset_name": asset_name,
            "source_url": import_run.source_url,
            "records_seen": import_run.records_seen,
            "records_created": import_run.records_created,
            "records_updated": import_run.records_updated,
            "records_failed": import_run.records_failed,
            "records_marked_stale": 0,
            "last_update": None,
            "metadata_queued": 0,
            "franchises_queued": 0,
            "themes_queued": 0,
            "metadata_task_ids": [],
            "franchises_task_ids": [],
            "themes_task_ids": [],
            "sync_states_created": 0,
            "sync_states_updated": 0,
            "sync_states_total": 0,
            "changed_anime_ids": [],
        }

    def _import_lines(
        self,
        text_stream,
        import_run: OfflineCatalogImport,
        summary: dict[str, Any],
        changed: _ChangedIds,
        *,
        seen_at,
        resume: bool,
        limit: int | None,
    ) -> None:
        """Read the JSONL stream: the header line, then entries in batches.

        On a resume, lines up to the last processed one are skipped (only the
        header is still read from them). A bad line is counted as failed and
        skipped, never fatal, so a resume does not stop on it again.
        """
        has_header = False
        buffer: list[OfflineCatalogEntry] = []
        skipped_lines = import_run.last_processed_line if resume else 0
        last_line_number = import_run.last_processed_line

        for line_number, raw_line in enumerate(text_stream, start=1):
            last_line_number = line_number

            raw_line = raw_line.strip()
            if not raw_line:
                continue

            if line_number <= skipped_lines:
                if line_number == 1 and not has_header:
                    header = self._header_from_skipped_line(raw_line)
                    if header is not None:
                        has_header = True
                        summary["last_update"] = header.get("lastUpdate")
                continue

            payload = self._parse_line(raw_line, line_number, import_run)
            if payload is None:
                continue

            if not has_header and payload.get("$schema"):
                has_header = True
                summary["last_update"] = payload.get("lastUpdate")
                continue

            entry = self._entry_from_payload(payload, line_number)
            if entry is None:
                import_run.records_failed += 1
                import_run.last_processed_line = line_number
                continue

            buffer.append(entry)
            import_run.records_seen += 1

            if len(buffer) >= self.batch_size:
                self._flush_buffer(buffer, import_run, summary, changed, seen_at=seen_at)
                import_run.last_processed_line = line_number
                import_run.save(
                    update_fields=[
                        "records_seen",
                        "records_created",
                        "records_updated",
                        "records_failed",
                        "last_processed_line",
                        "updated_at",
                    ]
                )
                buffer.clear()

            if limit and import_run.records_seen >= limit:
                import_run.last_processed_line = line_number
                break

        if buffer:
            self._flush_buffer(buffer, import_run, summary, changed, seen_at=seen_at)
        import_run.last_processed_line = max(import_run.last_processed_line, last_line_number)

    @staticmethod
    def _header_from_skipped_line(raw_line: str) -> dict | None:
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError:
            return None
        if isinstance(payload, dict) and payload.get("$schema"):
            return payload
        return None

    @staticmethod
    def _parse_line(
        raw_line: str, line_number: int, import_run: OfflineCatalogImport
    ) -> dict | None:
        """The line's JSON object, or None (counted as failed) when it is not one."""
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError:
            logger.warning(
                "Skipping malformed JSON line in offline catalog import",
                extra={"line_number": line_number},
            )
            payload = None
        else:
            if isinstance(payload, dict):
                return payload
            logger.warning(
                "Skipping non-object JSON payload in offline catalog import",
                extra={"line_number": line_number},
            )
        import_run.records_failed += 1
        import_run.last_processed_line = line_number
        return None

    @staticmethod
    def _entry_from_payload(payload: dict, line_number: int) -> OfflineCatalogEntry | None:
        try:
            return parsing.prepare_entry(payload)
        except Exception:
            # One bad record must not fail the run: a resume would
            # stop on the same line again.
            logger.warning(
                "Skipping malformed offline catalog record at line %s",
                line_number,
                exc_info=True,
            )
            return None

    def _flush_buffer(
        self,
        buffer: list[OfflineCatalogEntry],
        import_run: OfflineCatalogImport,
        summary: dict[str, Any],
        changed: _ChangedIds,
        *,
        seen_at,
    ) -> None:
        flush_result = self._flush_batch(
            buffer,
            last_update=parsing.parse_date(summary["last_update"]),
            seen_at=seen_at,
        )
        changed.created.extend(flush_result["created_ids"])
        changed.updated.extend(flush_result["updated_ids"])
        import_run.records_created += flush_result["created"]
        import_run.records_updated += flush_result["updated"]
        import_run.records_failed += flush_result["failed"]

    @staticmethod
    def _followup_ids(
        changed: _ChangedIds, run_started_at, *, resume: bool
    ) -> tuple[list[int], list[int]]:
        """(rows this run touched, rows it created).

        A resumed run only knows its own batches, so it asks the database for
        every row seen at this run's start time instead.
        """
        if not resume:
            return changed.created + changed.updated, changed.created
        seen_this_run = Anime.objects.filter(offline_db_last_seen_at=run_started_at)
        followup_ids = list(seen_this_run.values_list("id", flat=True))
        new_ids = list(
            seen_this_run.filter(created_at__gte=run_started_at).values_list("id", flat=True)
        )
        return followup_ids, new_ids

    @staticmethod
    def _complete_import_run(import_run: OfflineCatalogImport, summary: dict[str, Any]) -> None:
        import_run.status = OfflineCatalogImport.Status.COMPLETED
        import_run.completed_at = timezone.now()
        import_run.summary = {
            "last_update": summary["last_update"],
            "metadata_queued": summary["metadata_queued"],
            "franchises_queued": summary["franchises_queued"],
            "themes_queued": summary["themes_queued"],
            "metadata_task_ids": summary["metadata_task_ids"],
            "franchises_task_ids": summary["franchises_task_ids"],
            "themes_task_ids": summary["themes_task_ids"],
            "sync_states_created": summary["sync_states_created"],
            "sync_states_updated": summary["sync_states_updated"],
            "sync_states_total": summary["sync_states_total"],
        }
        import_run.save(
            update_fields=[
                "status",
                "completed_at",
                "records_seen",
                "records_created",
                "records_updated",
                "records_marked_stale",
                "records_failed",
                "last_processed_line",
                "summary",
                "updated_at",
            ]
        )

    def _prepare_import_run(
        self,
        *,
        release_tag: str,
        asset_name: str,
        source_url: str,
        resume: bool,
    ) -> OfflineCatalogImport:
        if resume:
            existing = (
                OfflineCatalogImport.objects.filter(
                    source_name="anime-offline-database",
                    asset_name=asset_name,
                    status__in=[
                        OfflineCatalogImport.Status.PENDING,
                        OfflineCatalogImport.Status.RUNNING,
                        OfflineCatalogImport.Status.FAILED,
                    ],
                )
                .order_by("-created_at")
                .first()
            )
            if existing:
                if not existing.release_tag:
                    existing.release_tag = release_tag
                existing.source_url = source_url
                return existing

        return OfflineCatalogImport.objects.create(
            source_name="anime-offline-database",
            release_tag=release_tag,
            asset_name=asset_name,
            source_url=source_url,
            status=OfflineCatalogImport.Status.PENDING,
        )

    def _build_source_url(self, release_tag: str, asset_name: str) -> str:
        if release_tag == "latest":
            if asset_name == DEFAULT_ASSET_NAME:
                return LATEST_DOWNLOAD_URL
            return (
                "https://github.com/manami-project/anime-offline-database/releases/latest/download/"
                f"{asset_name}"
            )
        return (
            "https://github.com/manami-project/anime-offline-database/releases/download/"
            f"{release_tag}/{asset_name}"
        )

    def _open_source_stream(self, *, source_url: str | None, source_path: str | None):
        if source_path:
            return self._open_local_stream(source_path)
        if not source_url:
            raise ValueError("Either source_url or source_path is required")
        return self._open_remote_stream(source_url)

    def _open_local_stream(self, source_path: str):
        path = Path(source_path)
        if not path.exists():
            raise FileNotFoundError(path)

        if path.suffix == ".zst":
            try:
                zstandard = self._get_zstandard()
            except ModuleNotFoundError as exc:
                raise ModuleNotFoundError(
                    "zstandard is required to import local .zst files. "
                    "Install dependencies or use a .jsonl source asset."
                ) from exc
            compressed = path.open("rb")
            reader = zstandard.ZstdDecompressor().stream_reader(compressed)
            return io.TextIOWrapper(reader, encoding="utf-8")

        return path.open("r", encoding="utf-8")

    def _open_remote_stream(self, source_url: str):
        zstandard = None
        if source_url.endswith(".zst"):
            try:
                zstandard = self._get_zstandard()
            except ModuleNotFoundError:
                fallback_url = self._fallback_uncompressed_source_url(source_url)
                if fallback_url:
                    logger.warning(
                        "zstandard unavailable; falling back to uncompressed import asset",
                        extra={"source_url": source_url, "fallback_url": fallback_url},
                    )
                    source_url = fallback_url
                else:
                    raise

        client = httpx.Client(timeout=60.0, follow_redirects=True)
        stream_context = client.stream("GET", source_url)
        try:
            response = stream_context.__enter__()
            response.raise_for_status()

            stream = _IteratorStream(response.iter_bytes())
            if source_url.endswith(".zst"):
                reader = zstandard.ZstdDecompressor().stream_reader(stream)
                text_stream = io.TextIOWrapper(reader, encoding="utf-8")
            else:
                text_stream = io.TextIOWrapper(stream, encoding="utf-8")
        except BaseException:
            # A 404 for a bad release tag, say: nothing below will close these.
            stream_context.__exit__(None, None, None)
            client.close()
            raise

        class _ManagedTextStream:
            def __enter__(self):
                return text_stream

            def __exit__(self, exc_type, exc, tb):
                try:
                    text_stream.close()
                finally:
                    stream_context.__exit__(exc_type, exc, tb)
                    client.close()
                return False

        return _ManagedTextStream()

    def _enqueue_enrichment(self, created_ids: list[int], updated_ids: list[int]) -> dict[str, Any]:
        changed_ids = list(dict.fromkeys([*created_ids, *updated_ids]))
        if not changed_ids:
            return {
                "metadata_queued": 0,
                "franchises_queued": 0,
                "themes_queued": 0,
                "metadata_task_ids": [],
                "franchises_task_ids": [],
                "themes_task_ids": [],
            }

        # Reconciliation is state-driven now. The import task only prepares state.
        return {
            "metadata_queued": 0,
            "franchises_queued": 0,
            "themes_queued": 0,
            "metadata_task_ids": [],
            "franchises_task_ids": [],
            "themes_task_ids": [],
        }

    def _initialize_sync_states(
        self, created_ids: list[int], updated_ids: list[int]
    ) -> dict[str, int]:
        changed_ids = list(dict.fromkeys([*created_ids, *updated_ids]))
        if not changed_ids:
            return {
                "sync_states_created": 0,
                "sync_states_updated": 0,
                "sync_states_total": 0,
            }

        # Only new rows start the pipeline from scratch. Every matched row
        # counts as updated, so resetting those would re-queue the whole
        # catalog on each import.
        service = OfflineSyncService()
        created_summary = service.ensure_states_for_anime_ids(created_ids, reset_pipeline=True)
        updated_summary = service.ensure_states_for_anime_ids(updated_ids)
        return {
            "sync_states_created": created_summary["created"] + updated_summary["created"],
            "sync_states_updated": created_summary["updated"] + updated_summary["updated"],
            "sync_states_total": len(changed_ids),
        }

    def _dispatch_chunks(self, anime_ids: list[int], dispatch) -> dict[str, Any]:
        jobs = 0
        task_ids: list[str] = []
        for chunk in self._chunked(anime_ids, self.enrichment_chunk_size):
            if not chunk:
                continue
            try:
                dispatch_result = dispatch(chunk)
                jobs += 1
                task_id = getattr(dispatch_result, "id", None)
                if task_id:
                    task_ids.append(str(task_id))
            except Exception:
                logger.error(
                    "Failed to dispatch enrichment chunk",
                    exc_info=True,
                    extra={"chunk_size": len(chunk)},
                )
        return {"jobs": jobs, "task_ids": task_ids}

    def _get_zstandard(self):
        return import_module("zstandard")

    def _fallback_uncompressed_source_url(self, source_url: str) -> str | None:
        if source_url.endswith(".jsonl.zst"):
            return source_url.removesuffix(".zst")
        return None

    def _chunked(self, values: list[int], size: int):
        size = max(1, int(size))
        for index in range(0, len(values), size):
            yield values[index : index + size]
