from __future__ import annotations

import io
import json
from dataclasses import dataclass
from datetime import date, datetime
from importlib import import_module
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.animes.models import Anime, OfflineCatalogImport, Studio
from apps.shared.logger import logger

DEFAULT_ASSET_NAME = "anime-offline-database.jsonl.zst"
DEFAULT_BATCH_SIZE = 250
DEFAULT_ENRICHMENT_CHUNK_SIZE = 100
PLACEHOLDER_SYNOPSIS = "Imported from Anime Offline Database. Metadata enrichment pending."
LATEST_DOWNLOAD_URL = (
    "https://github.com/manami-project/anime-offline-database/releases/latest/download/"
    f"{DEFAULT_ASSET_NAME}"
)
SEASON_MONTHS = {
    "WINTER": 1,
    "SPRING": 4,
    "SUMMER": 7,
    "FALL": 10,
    "UNDEFINED": 1,
}
PROVIDER_HOSTS = {
    "anidb.net": "anidb",
    "anilist.co": "anilist",
    "anime-planet.com": "anime_planet",
    "animecountdown.com": "animecountdown",
    "animenewsnetwork.com": "animenewsnetwork",
    "anisearch.com": "anisearch",
    "kitsu.app": "kitsu",
    "livechart.me": "livechart",
    "myanimelist.net": "myanimelist",
    "notify.moe": "notify_moe",
    "simkl.com": "simkl",
}


@dataclass(slots=True)
class OfflineCatalogEntry:
    raw: dict[str, Any]
    title: str
    base_slug: str
    anime_type: str
    status: str
    episode_count: int
    duration_minutes: int | None
    rating: float | None
    season: str
    season_year: int | None
    release_date: date | None
    cover_url: str
    banner_url: str
    primary_studio: str | None
    anilist_id: int | None
    mal_id: int | None
    provider_ids: dict[str, Any]
    synonyms: list[str]
    producers: list[str]
    tags: list[str]
    source_urls: list[str]


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


class OfflineCatalogImportService:
    def __init__(
        self,
        *,
        batch_size: int = DEFAULT_BATCH_SIZE,
        enrichment_chunk_size: int = DEFAULT_ENRICHMENT_CHUNK_SIZE,
    ):
        self.batch_size = batch_size
        self.enrichment_chunk_size = enrichment_chunk_size

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
        started_at = timezone.now()
        import_run = self._prepare_import_run(
            release_tag=release_tag,
            asset_name=asset_name,
            source_url=source_url or self._build_source_url(release_tag, asset_name),
            resume=resume,
        )
        import_run.status = OfflineCatalogImport.Status.RUNNING
        import_run.started_at = import_run.started_at or started_at
        import_run.error_message = ""
        import_run.save(
            update_fields=["status", "started_at", "error_message", "source_url", "release_tag"]
        )

        summary: dict[str, Any] = {
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
        }

        metadata_line: dict[str, Any] | None = None
        line_buffer: list[OfflineCatalogEntry] = []
        created_ids: list[int] = []
        updated_ids: list[int] = []
        skipped_lines = import_run.last_processed_line if resume else 0
        last_line_number = import_run.last_processed_line

        try:
            with self._open_source_stream(source_url=import_run.source_url, source_path=source_path) as text_stream:
                for line_number, raw_line in enumerate(text_stream, start=1):
                    last_line_number = line_number
                    if line_number <= skipped_lines:
                        continue

                    raw_line = raw_line.strip()
                    if not raw_line:
                        continue

                    payload = json.loads(raw_line)
                    if metadata_line is None and payload.get("$schema"):
                        metadata_line = payload
                        summary["last_update"] = payload.get("lastUpdate")
                        continue

                    entry = self._prepare_entry(payload)
                    if entry is None:
                        import_run.records_failed += 1
                        import_run.last_processed_line = line_number
                        continue

                    line_buffer.append(entry)
                    import_run.records_seen += 1

                    if len(line_buffer) >= self.batch_size:
                        flush_result = self._flush_batch(
                            line_buffer,
                            last_update=self._parse_date(summary["last_update"]),
                            seen_at=started_at,
                        )
                        created_ids.extend(flush_result["created_ids"])
                        updated_ids.extend(flush_result["updated_ids"])
                        import_run.records_created += flush_result["created"]
                        import_run.records_updated += flush_result["updated"]
                        import_run.records_failed += flush_result["failed"]
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
                        line_buffer.clear()

                    if limit and import_run.records_seen >= limit:
                        import_run.last_processed_line = line_number
                        break

                if line_buffer:
                    flush_result = self._flush_batch(
                        line_buffer,
                        last_update=self._parse_date(summary["last_update"]),
                        seen_at=started_at,
                    )
                    created_ids.extend(flush_result["created_ids"])
                    updated_ids.extend(flush_result["updated_ids"])
                    import_run.records_created += flush_result["created"]
                    import_run.records_updated += flush_result["updated"]
                    import_run.records_failed += flush_result["failed"]
                import_run.last_processed_line = max(import_run.last_processed_line, last_line_number)

            stale_count = Anime.objects.filter(
                offline_db_last_seen_at__isnull=False,
                offline_db_last_seen_at__lt=started_at,
            ).count()
            import_run.records_marked_stale = stale_count

            if enqueue_enrichment:
                queued = self._enqueue_enrichment(created_ids, updated_ids)
                summary.update(queued)

            import_run.status = OfflineCatalogImport.Status.COMPLETED
            import_run.completed_at = timezone.now()
            import_run.summary = {
                "last_update": summary["last_update"],
                "metadata_queued": summary["metadata_queued"],
                "franchises_queued": summary["franchises_queued"],
                "themes_queued": summary["themes_queued"],
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
            }
        )
        return summary

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
            compressed = path.open("rb")
            reader = self._get_zstandard().ZstdDecompressor().stream_reader(compressed)
            return io.TextIOWrapper(reader, encoding="utf-8")

        return path.open("r", encoding="utf-8")

    def _open_remote_stream(self, source_url: str):
        client = httpx.Client(timeout=60.0, follow_redirects=True)
        response = client.stream("GET", source_url)
        response.__enter__()
        response.raise_for_status()

        stream = _IteratorStream(response.iter_bytes())
        if source_url.endswith(".zst"):
            reader = self._get_zstandard().ZstdDecompressor().stream_reader(stream)
            text_stream = io.TextIOWrapper(reader, encoding="utf-8")
        else:
            text_stream = io.TextIOWrapper(stream, encoding="utf-8")

        class _ManagedTextStream:
            def __enter__(self_nonlocal):
                return text_stream

            def __exit__(self_nonlocal, exc_type, exc, tb):
                try:
                    text_stream.close()
                finally:
                    response.__exit__(exc_type, exc, tb)
                    client.close()
                return False

        return _ManagedTextStream()

    def _prepare_entry(self, payload: dict[str, Any]) -> OfflineCatalogEntry | None:
        title = (payload.get("title") or "").strip()
        if not title:
            return None

        provider_ids = self._extract_provider_ids(payload.get("sources") or [])
        anime_type = self._map_type(payload.get("type"))
        status = self._map_status(payload.get("status"))
        season_info = payload.get("animeSeason") or {}
        season = season_info.get("season") or ""
        season_year = season_info.get("year")
        picture = payload.get("picture") or ""
        thumbnail = payload.get("thumbnail") or ""

        return OfflineCatalogEntry(
            raw=payload,
            title=title,
            base_slug=slugify(title),
            anime_type=anime_type,
            status=status,
            episode_count=payload.get("episodes") or 0,
            duration_minutes=self._duration_to_minutes(payload.get("duration")),
            rating=self._score_to_rating(payload.get("score")),
            season=season,
            season_year=season_year,
            release_date=self._season_to_date(season, season_year),
            cover_url=picture,
            banner_url=thumbnail or picture,
            primary_studio=self._pick_primary_studio(payload.get("studios") or []),
            anilist_id=self._coerce_int(provider_ids.get("anilist")),
            mal_id=self._coerce_int(provider_ids.get("myanimelist")),
            provider_ids=provider_ids,
            synonyms=self._unique_strings(payload.get("synonyms") or []),
            producers=self._unique_strings(payload.get("producers") or []),
            tags=self._unique_strings(payload.get("tags") or []),
            source_urls=self._unique_strings(payload.get("sources") or []),
        )

    def _flush_batch(
        self,
        entries: list[OfflineCatalogEntry],
        *,
        last_update: date | None,
        seen_at,
    ) -> dict[str, Any]:
        anilist_ids = {entry.anilist_id for entry in entries if entry.anilist_id}
        mal_ids = {entry.mal_id for entry in entries if entry.mal_id}
        titles = {entry.title for entry in entries}
        slugs = {entry.base_slug for entry in entries if entry.base_slug}
        studio_names = {entry.primary_studio for entry in entries if entry.primary_studio}

        anilist_map = (
            Anime.objects.in_bulk(anilist_ids, field_name="anilist_id") if anilist_ids else {}
        )
        mal_map = Anime.objects.in_bulk(mal_ids, field_name="mal_id") if mal_ids else {}
        title_map = {anime.title: anime for anime in Anime.objects.filter(title__in=titles)}
        slug_map = {anime.slug: anime for anime in Anime.objects.filter(slug__in=slugs)}
        studio_map = self._resolve_studios(studio_names)

        reserved_titles = set(Anime.objects.filter(title__in=titles).values_list("title", flat=True))
        reserved_slugs = set(Anime.objects.filter(slug__in=slugs).values_list("slug", flat=True))

        to_create: list[Anime] = []
        to_update: list[Anime] = []
        created_ids: list[int] = []
        updated_ids: list[int] = []
        created_count = 0
        updated_count = 0
        failed_count = 0
        touched_slugs: list[str] = []

        with transaction.atomic():
            for entry in entries:
                try:
                    anime = self._match_existing(entry, anilist_map, mal_map, title_map, slug_map)
                    studio = studio_map.get(entry.primary_studio) if entry.primary_studio else None
                    if anime is None:
                        title = self._ensure_unique_title(entry, reserved_titles)
                        slug = self._ensure_unique_slug(slugify(title), reserved_slugs)
                        anime = Anime(
                            title=title,
                            title_jp="",
                            synopsis=PLACEHOLDER_SYNOPSIS,
                            anime_type=entry.anime_type,
                            status=entry.status,
                            episode_count=entry.episode_count,
                            duration_minutes=entry.duration_minutes or 24,
                            release_date=entry.release_date,
                            rating=entry.rating,
                            cover_image_external_url=entry.cover_url,
                            banner_image_external_url=entry.banner_url,
                            meta_description=title[:160],
                            season="" if entry.season == "UNDEFINED" else entry.season,
                            season_year=entry.season_year,
                            mal_id=entry.mal_id,
                            anilist_id=entry.anilist_id,
                            studio=studio,
                            provider_ids=entry.provider_ids,
                            synonyms=self._merged_list([], entry.synonyms),
                            producers=self._merged_list([], entry.producers),
                            tags=self._merged_list([], entry.tags),
                            source_urls=self._merged_list([], entry.source_urls),
                            offline_db_payload=entry.raw,
                            offline_db_last_seen_at=seen_at,
                            offline_db_last_update=last_update,
                            slug=slug,
                        )
                        to_create.append(anime)
                        created_count += 1
                        reserved_titles.add(title)
                        reserved_slugs.add(slug)
                    else:
                        self._apply_offline_updates(anime, entry, studio, last_update, seen_at)
                        to_update.append(anime)
                        updated_count += 1
                        touched_slugs.append(anime.slug)
                except Exception:
                    failed_count += 1
                    logger.error("Failed to prepare offline catalog entry", exc_info=True)

            if to_create:
                Anime.objects.bulk_create(to_create, batch_size=self.batch_size)
                created_ids.extend(anime.id for anime in to_create if anime.id)
                touched_slugs.extend(anime.slug for anime in to_create)

            if to_update:
                Anime.objects.bulk_update(
                    to_update,
                    [
                        "anime_type",
                        "status",
                        "episode_count",
                        "duration_minutes",
                        "release_date",
                        "rating",
                        "cover_image_external_url",
                        "banner_image_external_url",
                        "season",
                        "season_year",
                        "mal_id",
                        "anilist_id",
                        "studio",
                        "provider_ids",
                        "synonyms",
                        "producers",
                        "tags",
                        "source_urls",
                        "offline_db_payload",
                        "offline_db_last_seen_at",
                        "offline_db_last_update",
                        "updated_at",
                    ],
                    batch_size=self.batch_size,
                )
                updated_ids.extend(anime.id for anime in to_update if anime.id)

        if touched_slugs:
            cache.delete_many([f"anime_detail_base:{slug}" for slug in touched_slugs])

        return {
            "created": created_count,
            "updated": updated_count,
            "failed": failed_count,
            "created_ids": created_ids,
            "updated_ids": updated_ids,
        }

    def _apply_offline_updates(
        self,
        anime: Anime,
        entry: OfflineCatalogEntry,
        studio: Studio | None,
        last_update: date | None,
        seen_at,
    ) -> None:
        provider_ids = dict(anime.provider_ids or {})
        provider_ids.update(entry.provider_ids)
        anime.provider_ids = provider_ids
        anime.synonyms = self._merged_list(anime.synonyms, entry.synonyms)
        anime.producers = self._merged_list(anime.producers, entry.producers)
        anime.tags = self._merged_list(anime.tags, entry.tags)
        anime.source_urls = self._merged_list(anime.source_urls, entry.source_urls)
        anime.offline_db_payload = entry.raw
        anime.offline_db_last_seen_at = seen_at
        anime.offline_db_last_update = last_update

        if not anime.anilist_id and entry.anilist_id:
            anime.anilist_id = entry.anilist_id
        if not anime.mal_id and entry.mal_id:
            anime.mal_id = entry.mal_id
        if anime.episode_count in (0, None) and entry.episode_count:
            anime.episode_count = entry.episode_count
        if (anime.duration_minutes in (0, 24, None)) and entry.duration_minutes:
            anime.duration_minutes = entry.duration_minutes
        if anime.rating is None and entry.rating is not None:
            anime.rating = entry.rating
        if not anime.release_date and entry.release_date:
            anime.release_date = entry.release_date
        if not anime.season and entry.season and entry.season != "UNDEFINED":
            anime.season = entry.season
        if not anime.season_year and entry.season_year:
            anime.season_year = entry.season_year
        if anime.status == Anime.AnimeStatus.unknown and entry.status:
            anime.status = entry.status
        if anime.anime_type == Anime.AnimeType.unknown and entry.anime_type:
            anime.anime_type = entry.anime_type
        if not anime.cover_image and not anime.cover_image_external_url and entry.cover_url:
            anime.cover_image_external_url = entry.cover_url
        if not anime.banner_image and not anime.banner_image_external_url and entry.banner_url:
            anime.banner_image_external_url = entry.banner_url
        if anime.synopsis == "" and PLACEHOLDER_SYNOPSIS:
            anime.synopsis = PLACEHOLDER_SYNOPSIS
        if anime.meta_description == "" and anime.title:
            anime.meta_description = anime.title[:160]
        if anime.studio_id is None and studio is not None:
            anime.studio = studio
        anime.updated_at = timezone.now()

    def _resolve_studios(self, studio_names: set[str | None]) -> dict[str, Studio]:
        clean_names = {name for name in studio_names if name}
        if not clean_names:
            return {}

        existing = {studio.name: studio for studio in Studio.objects.filter(name__in=clean_names)}
        missing = [Studio(name=name) for name in clean_names if name not in existing]
        if missing:
            Studio.objects.bulk_create(missing, ignore_conflicts=True)
            existing = {studio.name: studio for studio in Studio.objects.filter(name__in=clean_names)}
        return existing

    def _match_existing(
        self,
        entry: OfflineCatalogEntry,
        anilist_map: dict[int, Anime],
        mal_map: dict[int, Anime],
        title_map: dict[str, Anime],
        slug_map: dict[str, Anime],
    ) -> Anime | None:
        if entry.anilist_id and entry.anilist_id in anilist_map:
            return anilist_map[entry.anilist_id]
        if entry.mal_id and entry.mal_id in mal_map:
            return mal_map[entry.mal_id]

        title_candidate = title_map.get(entry.title)
        if title_candidate and self._is_reasonable_fallback_match(title_candidate, entry):
            return title_candidate

        slug_candidate = slug_map.get(entry.base_slug)
        if slug_candidate and self._is_reasonable_fallback_match(slug_candidate, entry):
            return slug_candidate

        return None

    def _is_reasonable_fallback_match(self, anime: Anime, entry: OfflineCatalogEntry) -> bool:
        anime_year = anime.season_year or (anime.release_date.year if anime.release_date else None)
        if anime_year and entry.season_year:
            return anime_year == entry.season_year
        return anime.title.casefold() == entry.title.casefold()

    def _ensure_unique_title(self, entry: OfflineCatalogEntry, reserved_titles: set[str]) -> str:
        if entry.title not in reserved_titles:
            return entry.title

        variants = []
        if entry.season_year:
            variants.append(f"{entry.title} ({entry.season_year})")
        if entry.anilist_id:
            variants.append(f"{entry.title} [anilist-{entry.anilist_id}]")
        if entry.mal_id:
            variants.append(f"{entry.title} [mal-{entry.mal_id}]")

        for variant in variants:
            if variant not in reserved_titles:
                return variant

        counter = 2
        while True:
            variant = f"{entry.title} ({counter})"
            if variant not in reserved_titles:
                return variant
            counter += 1

    def _ensure_unique_slug(self, base_slug: str, reserved_slugs: set[str]) -> str:
        slug = base_slug or "anime"
        if slug not in reserved_slugs:
            return slug

        counter = 2
        while True:
            candidate = f"{slug}-{counter}"
            if candidate not in reserved_slugs:
                return candidate
            counter += 1

    def _enqueue_enrichment(self, created_ids: list[int], updated_ids: list[int]) -> dict[str, int]:
        changed_ids = list(dict.fromkeys([*created_ids, *updated_ids]))
        if not changed_ids:
            return {"metadata_queued": 0, "franchises_queued": 0, "themes_queued": 0}

        from apps.animes.tasks import enrich_metadata, sync_franchises, sync_theme_songs

        anime_rows = list(
            Anime.objects.filter(id__in=changed_ids).values("id", "anilist_id", "mal_id")
        )
        metadata_ids = [row["id"] for row in anime_rows if row["anilist_id"]]
        franchise_ids = metadata_ids[:]
        theme_ids = [row["id"] for row in anime_rows if row["mal_id"]]

        metadata_jobs = self._dispatch_chunks(
            metadata_ids,
            lambda chunk: enrich_metadata.delay(mode="backfill", anime_ids=chunk, batch_size=len(chunk)),
        )
        franchise_jobs = self._dispatch_chunks(
            franchise_ids,
            lambda chunk: sync_franchises.delay(
                mode="backfill",
                anime_ids=chunk,
                batch_size=len(chunk),
                import_missing=True,
            ),
        )
        theme_jobs = self._dispatch_chunks(
            theme_ids,
            lambda chunk: sync_theme_songs.delay(anime_ids=chunk, limit=len(chunk)),
        )

        return {
            "metadata_queued": metadata_jobs,
            "franchises_queued": franchise_jobs,
            "themes_queued": theme_jobs,
        }

    def _dispatch_chunks(self, anime_ids: list[int], dispatch) -> int:
        jobs = 0
        for chunk in self._chunked(anime_ids, self.enrichment_chunk_size):
            if not chunk:
                continue
            dispatch(chunk)
            jobs += 1
        return jobs

    def _extract_provider_ids(self, source_urls: list[str]) -> dict[str, Any]:
        provider_ids: dict[str, Any] = {}
        for url in source_urls:
            parsed = urlparse(url)
            host = parsed.netloc.lower().removeprefix("www.")
            provider = PROVIDER_HOSTS.get(host)
            if not provider:
                continue

            extracted: str | int | None = None
            path_parts = [part for part in parsed.path.split("/") if part]
            if provider in {"anidb", "animecountdown", "anisearch", "kitsu", "livechart", "myanimelist", "simkl"}:
                extracted = path_parts[-1] if path_parts else None
            elif provider == "anilist":
                extracted = path_parts[-1] if len(path_parts) >= 2 and path_parts[0] == "anime" else None
            elif provider == "anime_planet":
                extracted = path_parts[-1] if len(path_parts) >= 2 and path_parts[0] == "anime" else None
            elif provider == "animenewsnetwork":
                extracted = parse_qs(parsed.query).get("id", [None])[0]
            elif provider == "notify_moe":
                extracted = path_parts[-1] if len(path_parts) >= 2 and path_parts[0] == "anime" else None

            if extracted is None:
                continue

            provider_ids[provider] = self._coerce_int(extracted, default=extracted)

        return provider_ids

    def _coerce_int(self, value: Any, default: Any = None) -> int | Any | None:
        if value in (None, ""):
            return default
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _map_type(self, source_type: str | None) -> str:
        type_map = {
            "TV": Anime.AnimeType.tv,
            "MOVIE": Anime.AnimeType.movie,
            "OVA": Anime.AnimeType.ova,
            "ONA": Anime.AnimeType.ona,
            "SPECIAL": Anime.AnimeType.special,
            "UNKNOWN": Anime.AnimeType.unknown,
        }
        return type_map.get((source_type or "UNKNOWN").upper(), Anime.AnimeType.unknown)

    def _map_status(self, source_status: str | None) -> str:
        status_map = {
            "FINISHED": Anime.AnimeStatus.finished,
            "ONGOING": Anime.AnimeStatus.airing,
            "UPCOMING": Anime.AnimeStatus.upcoming,
            "UNKNOWN": Anime.AnimeStatus.unknown,
        }
        return status_map.get((source_status or "UNKNOWN").upper(), Anime.AnimeStatus.unknown)

    def _duration_to_minutes(self, duration: dict[str, Any] | None) -> int | None:
        if not duration:
            return None

        value = duration.get("value")
        unit = (duration.get("unit") or "").upper()
        if not value:
            return None

        if unit == "SECONDS":
            return max(1, round(value / 60))
        if unit == "MINUTES":
            return int(value)
        if unit == "HOURS":
            return int(value * 60)
        return None

    def _score_to_rating(self, score: dict[str, Any] | None) -> float | None:
        if not score:
            return None
        value = score.get("arithmeticGeometricMean")
        if value is None:
            value = score.get("arithmeticMean")
        if value is None:
            value = score.get("median")
        if value is None:
            return None
        return round(float(value), 1)

    def _season_to_date(self, season: str | None, year: int | None) -> date | None:
        if not year:
            return None
        month = SEASON_MONTHS.get((season or "UNDEFINED").upper(), 1)
        return date(year, month, 1)

    def _pick_primary_studio(self, studios: list[str]) -> str | None:
        clean = self._unique_strings(studios)
        if not clean:
            return None
        studio_name = clean[0].strip()
        if studio_name.islower():
            return studio_name.title()
        return studio_name

    def _merged_list(self, current: list[str] | None, incoming: list[str]) -> list[str]:
        return self._unique_strings([*(current or []), *incoming])

    def _unique_strings(self, values: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            clean = str(value).strip()
            if not clean:
                continue
            key = clean.casefold()
            if key in seen:
                continue
            seen.add(key)
            result.append(clean)
        return result

    def _parse_date(self, value: str | None) -> date | None:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return None

    def _get_zstandard(self):
        return import_module("zstandard")

    def _chunked(self, values: list[int], size: int):
        for index in range(0, len(values), size):
            yield values[index : index + size]
