"""Writing a batch of offline catalog entries: create, update, recover.

Updates only fill what a row is missing (offline data is the weakest source)
and write back only the fields the import changed.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any

from django.db import DataError, IntegrityError, transaction
from django.utils import timezone
from django.utils.text import slugify

from ...shared.logger import logger
from ...shared.public_cache import invalidate_public_cache_keys
from ..models import Anime, AnimeStudio, Studio
from . import offline_catalog_parsing as parsing
from .metadata_health import PLACEHOLDER_SYNOPSIS
from .offline_catalog_matching import OfflineCatalogMatcher
from .offline_catalog_parsing import (
    ANIME_META_DESCRIPTION_MAX_LENGTH,
    ANIME_SEASON_MAX_LENGTH,
    ANIME_SLUG_MAX_LENGTH,
    ANIME_TITLE_JP_MAX_LENGTH,
    ANIME_TITLE_MAX_LENGTH,
    ANIME_URL_MAX_LENGTH,
    OfflineCatalogEntry,
)
from .public_anime_service import AnimePublicPayloadService

if TYPE_CHECKING:
    from datetime import date

OFFLINE_UPDATE_FIELDS = [
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
    "provider_ids",
    "synonyms",
    "producers",
    "tags",
    "source_urls",
    "offline_db_payload",
    "offline_db_last_seen_at",
    "offline_db_last_update",
    "updated_at",
]
OFFLINE_ALWAYS_WRITTEN_FIELDS = frozenset(
    {"offline_db_payload", "offline_db_last_seen_at", "offline_db_last_update", "updated_at"}
)


class OfflineCatalogPersistence(OfflineCatalogMatcher):
    """Saves batches of entries (mixin for the import service; needs ``batch_size``)."""

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
        title_map: dict[str, list[Anime]] = defaultdict(list)
        for anime in Anime.objects.filter(title__in=titles):
            title_map[anime.title].append(anime)
        slug_map = {anime.slug: anime for anime in Anime.objects.filter(slug__in=slugs)}
        studio_map = self._resolve_studios(studio_names)

        reserved_slugs = set(Anime.objects.filter(slug__in=slugs).values_list("slug", flat=True))

        to_create: list[tuple[Anime, OfflineCatalogEntry, Studio | None]] = []
        to_update: list[Anime] = []
        created_ids: list[int] = []
        updated_ids: list[int] = []
        created_count = 0
        updated_count = 0
        failed_count = 0
        touched_slugs: list[str] = []
        pending_create_index: dict[int, int] = {}
        queued_update_ids: set[int] = set()
        studio_pairs: list[tuple[Anime, Studio]] = []

        with transaction.atomic():
            for entry in entries:
                try:
                    anime = self._match_existing(entry, anilist_map, mal_map, title_map, slug_map)
                    studio = studio_map.get(entry.primary_studio) if entry.primary_studio else None
                    if anime is not None and studio is not None:
                        studio_pairs.append((anime, studio))
                    if anime is None:
                        title = entry.title
                        slug = self._ensure_unique_slug(
                            slugify(title), reserved_slugs, year=entry.season_year
                        )
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
                            provider_ids=entry.provider_ids,
                            synonyms=parsing.merged_list([], entry.synonyms),
                            producers=parsing.merged_list([], entry.producers),
                            tags=parsing.merged_list([], entry.tags),
                            source_urls=parsing.merged_list([], entry.source_urls),
                            offline_db_payload=entry.raw,
                            offline_db_last_seen_at=seen_at,
                            offline_db_last_update=last_update,
                            slug=slug,
                        )
                        to_create.append((anime, entry, studio))
                        if studio is not None:
                            studio_pairs.append((anime, studio))
                        pending_create_index[id(anime)] = len(to_create) - 1
                        reserved_slugs.add(slug)
                        if anime.anilist_id:
                            anilist_map[anime.anilist_id] = anime
                        if anime.mal_id:
                            mal_map[anime.mal_id] = anime
                        title_map[anime.title].append(anime)
                        if anime.slug:
                            slug_map[anime.slug] = anime
                    else:
                        self._apply_offline_updates(anime, entry, last_update, seen_at)
                        if anime.pk is None:
                            row_idx = pending_create_index.get(id(anime))
                            if row_idx is not None:
                                to_create[row_idx] = (anime, entry, studio)
                        elif anime.pk not in queued_update_ids:
                            queued_update_ids.add(anime.pk)
                            to_update.append(anime)
                            updated_count += 1
                            touched_slugs.append(anime.slug)

                        if anime.anilist_id:
                            anilist_map[anime.anilist_id] = anime
                        if anime.mal_id:
                            mal_map[anime.mal_id] = anime
                        title_map[anime.title].append(anime)
                        if anime.slug:
                            slug_map[anime.slug] = anime
                except Exception:
                    failed_count += 1
                    logger.error("Failed to prepare offline catalog entry", exc_info=True)

            if to_create:
                persist_result = self._persist_creates(
                    to_create,
                    last_update=last_update,
                    seen_at=seen_at,
                    reserved_slugs=reserved_slugs,
                )
                created_count += persist_result["created"]
                updated_count += persist_result["updated"]
                failed_count += persist_result["failed"]
                created_ids.extend(persist_result["created_ids"])
                updated_ids.extend(persist_result["updated_ids"])
                touched_slugs.extend(persist_result["touched_slugs"])

            if to_update:
                by_fields: dict[frozenset[str], list[Anime]] = defaultdict(list)
                for anime in to_update:
                    by_fields[frozenset(self._pop_offline_dirty_fields(anime))].append(anime)
                for fields, rows in by_fields.items():
                    Anime.objects.bulk_update(rows, sorted(fields), batch_size=self.batch_size)
                for anime in to_update:
                    self._index_fallback_anime(anime)
                updated_ids.extend(anime.id for anime in to_update if anime.id)

            self._attach_primary_studios(studio_pairs)

        if touched_slugs:
            AnimePublicPayloadService.bump_collection_cache_namespace()
            invalidate_public_cache_keys(
                *[
                    key
                    for slug in touched_slugs
                    for key in AnimePublicPayloadService.detail_cache_keys(slug)
                ]
            )

        return {
            "created": created_count,
            "updated": updated_count,
            "failed": failed_count,
            "created_ids": created_ids,
            "updated_ids": updated_ids,
        }

    def _persist_creates(
        self,
        rows: list[tuple[Anime, OfflineCatalogEntry, Studio | None]],
        *,
        last_update: date | None,
        seen_at,
        reserved_slugs: set[str],
    ) -> dict[str, Any]:
        anime_rows = [anime for anime, _, _ in rows]
        try:
            with transaction.atomic():
                Anime.objects.bulk_create(anime_rows, batch_size=self.batch_size)
            for anime in anime_rows:
                self._index_fallback_anime(anime)
            return {
                "created": len(anime_rows),
                "updated": 0,
                "failed": 0,
                "created_ids": [anime.id for anime in anime_rows if anime.id],
                "updated_ids": [],
                "touched_slugs": [anime.slug for anime in anime_rows],
            }
        except (IntegrityError, DataError):
            logger.warning(
                "Bulk create hit uniqueness conflict, falling back to row-by-row recovery"
            )

        summary = {
            "created": 0,
            "updated": 0,
            "failed": 0,
            "created_ids": [],
            "updated_ids": [],
            "touched_slugs": [],
        }
        for anime, entry, studio in rows:
            outcome = self._persist_single_create_with_recovery(
                anime=anime,
                entry=entry,
                studio=studio,
                last_update=last_update,
                seen_at=seen_at,
                reserved_slugs=reserved_slugs,
            )
            for key in ("created", "updated", "failed"):
                summary[key] += outcome[key]
            summary["created_ids"].extend(outcome["created_ids"])
            summary["updated_ids"].extend(outcome["updated_ids"])
            summary["touched_slugs"].extend(outcome["touched_slugs"])

        return summary

    def _persist_single_create_with_recovery(
        self,
        *,
        anime: Anime,
        entry: OfflineCatalogEntry,
        studio: Studio | None,
        last_update: date | None,
        seen_at,
        reserved_slugs: set[str],
    ) -> dict[str, Any]:
        attempts_remaining = 3
        while attempts_remaining > 0:
            attempts_remaining -= 1
            try:
                self._sanitize_anime_for_insert(anime)
                with transaction.atomic():
                    anime.save(force_insert=True)
                self._index_fallback_anime(anime)
                return {
                    "created": 1,
                    "updated": 0,
                    "failed": 0,
                    "created_ids": [anime.id] if anime.id else [],
                    "updated_ids": [],
                    "touched_slugs": [anime.slug],
                }
            except DataError as exc:
                logger.warning(
                    "Offline import row exceeds model limits; retrying with sanitized fields",
                    extra={"title": entry.title, "error": str(exc)},
                )
                if attempts_remaining <= 0:
                    break
                continue
            except IntegrityError:
                existing = self._find_conflicting_existing(entry, anime)
                if existing is not None:
                    self._apply_offline_updates(existing, entry, last_update, seen_at)
                    existing.save(update_fields=sorted(self._pop_offline_dirty_fields(existing)))
                    self._attach_primary_studios([(existing, studio)] if studio else [])
                    self._index_fallback_anime(existing)
                    return {
                        "created": 0,
                        "updated": 1,
                        "failed": 0,
                        "created_ids": [],
                        "updated_ids": [existing.id] if existing.id else [],
                        "touched_slugs": [existing.slug],
                    }

                # Only the slug is unique; the title is stored as-is.
                reserved_slugs.add(anime.slug)
                anime.slug = self._ensure_unique_slug(
                    slugify(anime.title), reserved_slugs, year=entry.season_year
                )
                reserved_slugs.add(anime.slug)

        logger.error(
            "Failed to persist anime row after conflict recovery",
            extra={"title": entry.title},
        )
        return {
            "created": 0,
            "updated": 0,
            "failed": 1,
            "created_ids": [],
            "updated_ids": [],
            "touched_slugs": [],
        }

    def _apply_offline_updates(
        self,
        anime: Anime,
        entry: OfflineCatalogEntry,
        last_update: date | None,
        seen_at,
    ) -> None:
        before = {field: getattr(anime, field) for field in OFFLINE_UPDATE_FIELDS}
        self._fill_offline_fields(anime, entry, last_update, seen_at)
        # Only what this import changed gets written: the instance may have been
        # loaded long before, and writing every field back would revert other
        # syncs' updates made since (an airing sync marking a show Finished).
        changed = {
            field for field in OFFLINE_UPDATE_FIELDS if getattr(anime, field) != before[field]
        }
        changed |= OFFLINE_ALWAYS_WRITTEN_FIELDS
        anime._offline_dirty_fields = getattr(anime, "_offline_dirty_fields", set()) | changed

    @staticmethod
    def _pop_offline_dirty_fields(anime: Anime) -> set[str]:
        fields = getattr(anime, "_offline_dirty_fields", None) or set(OFFLINE_UPDATE_FIELDS)
        anime._offline_dirty_fields = set()
        return fields

    def _fill_offline_fields(
        self,
        anime: Anime,
        entry: OfflineCatalogEntry,
        last_update: date | None,
        seen_at,
    ) -> None:
        provider_ids = dict(anime.provider_ids or {})
        provider_ids.update(entry.provider_ids)
        anime.provider_ids = provider_ids
        anime.synonyms = parsing.merged_list(anime.synonyms, entry.synonyms)
        anime.producers = parsing.merged_list(anime.producers, entry.producers)
        anime.tags = parsing.merged_list(anime.tags, entry.tags)
        anime.source_urls = parsing.merged_list(anime.source_urls, entry.source_urls)
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
        anime.updated_at = timezone.now()

    def _attach_primary_studios(self, pairs: list[tuple[Anime, Studio]]) -> None:
        """Give anime that have no studios yet the offline DB's primary studio."""
        pairs = [(anime, studio) for anime, studio in pairs if anime.pk and studio is not None]
        if not pairs:
            return
        with_studios = set(
            AnimeStudio.objects.filter(anime_id__in={anime.pk for anime, _ in pairs})
            .values_list("anime_id", flat=True)
            .distinct()
        )
        links: dict[int, AnimeStudio] = {}
        for anime, studio in pairs:
            if anime.pk not in with_studios and anime.pk not in links:
                links[anime.pk] = AnimeStudio(anime_id=anime.pk, studio=studio, position=0)
        if links:
            AnimeStudio.objects.bulk_create(links.values(), ignore_conflicts=True)

    def _resolve_studios(self, studio_names: set[str | None]) -> dict[str, Studio]:
        clean_names = {name for name in studio_names if name}
        if not clean_names:
            return {}

        existing = {studio.name: studio for studio in Studio.objects.filter(name__in=clean_names)}
        missing = [Studio(name=name) for name in clean_names if name not in existing]
        if missing:
            Studio.objects.bulk_create(missing, ignore_conflicts=True)
            existing = {
                studio.name: studio for studio in Studio.objects.filter(name__in=clean_names)
            }
        return existing

    def _ensure_unique_slug(
        self, base_slug: str, reserved_slugs: set[str], *, year: int | None = None
    ) -> str:
        slug = parsing.truncate_text(base_slug or "anime", ANIME_SLUG_MAX_LENGTH).strip("-")
        if not slug:
            slug = "anime"
        if not self._is_slug_taken(slug, reserved_slugs):
            return slug
        if year:
            suffix = f"-{year}"
            candidate = f"{slug[: max(1, ANIME_SLUG_MAX_LENGTH - len(suffix))].rstrip('-')}{suffix}"
            if not self._is_slug_taken(candidate, reserved_slugs):
                return candidate

        counter = 2
        while True:
            suffix = f"-{counter}"
            max_base_length = max(1, ANIME_SLUG_MAX_LENGTH - len(suffix))
            candidate_base = slug[:max_base_length].rstrip("-")
            if not candidate_base:
                candidate_base = "anime"[:max_base_length]
            candidate = f"{candidate_base}{suffix}"
            if not self._is_slug_taken(candidate, reserved_slugs):
                return candidate
            counter += 1

    def _is_slug_taken(self, candidate: str, reserved_slugs: set[str]) -> bool:
        if candidate in reserved_slugs:
            return True
        exists = Anime.objects.filter(slug=candidate).exists()
        if exists:
            reserved_slugs.add(candidate)
        return exists

    def _sanitize_anime_for_insert(self, anime: Anime) -> None:
        anime.title = parsing.truncate_text(anime.title, ANIME_TITLE_MAX_LENGTH)
        anime.title_jp = parsing.truncate_text(anime.title_jp, ANIME_TITLE_JP_MAX_LENGTH)
        anime.slug = parsing.truncate_text(anime.slug, ANIME_SLUG_MAX_LENGTH).strip("-")
        if not anime.slug:
            anime.slug = self._ensure_unique_slug(slugify(anime.title), set())
        anime.meta_description = parsing.truncate_text(
            anime.meta_description, ANIME_META_DESCRIPTION_MAX_LENGTH
        )
        anime.season = parsing.truncate_text(anime.season, ANIME_SEASON_MAX_LENGTH)
        anime.cover_image_external_url = parsing.truncate_text(
            anime.cover_image_external_url, ANIME_URL_MAX_LENGTH
        )
        anime.banner_image_external_url = parsing.truncate_text(
            anime.banner_image_external_url, ANIME_URL_MAX_LENGTH
        )
