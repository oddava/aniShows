"""Matching offline catalog entries to the anime rows that already exist.

Provider IDs win; a title (or slug, or alternate title) only matches when the
entry carries no AniList or MAL ID and the release years agree. Rows outside
the current batch are found through in-memory indexes built once per import.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any

from ..models import Anime
from . import offline_catalog_parsing as parsing

if TYPE_CHECKING:
    from .offline_catalog_parsing import OfflineCatalogEntry


class OfflineCatalogMatcher:
    """Finds the existing ``Anime`` for an entry (mixin for the import service)."""

    def _init_fallback_indexes(self) -> None:
        self._fallback_indexes_loaded = False
        self._fallback_anime_cache: dict[int, Anime] = {}
        self._fallback_title_index: dict[str, list[int]] = defaultdict(list)
        self._fallback_provider_index: dict[tuple[str, str], list[int]] = defaultdict(list)

    def _match_existing(
        self,
        entry: OfflineCatalogEntry,
        anilist_map: dict[int, Anime],
        mal_map: dict[int, Anime],
        title_map: dict[str, list[Anime]],
        slug_map: dict[str, Anime],
    ) -> Anime | None:
        if entry.anilist_id and entry.anilist_id in anilist_map:
            return anilist_map[entry.anilist_id]
        if entry.mal_id and entry.mal_id in mal_map:
            return mal_map[entry.mal_id]

        for title_candidate in title_map.get(entry.title, []):
            if self._is_reasonable_fallback_match(title_candidate, entry):
                return title_candidate

        slug_candidate = slug_map.get(entry.base_slug)
        if slug_candidate and self._is_reasonable_fallback_match(slug_candidate, entry):
            return slug_candidate

        fallback_candidate = self._find_fallback_existing(entry)
        if fallback_candidate is not None:
            return fallback_candidate

        return None

    def _find_fallback_existing(self, entry: OfflineCatalogEntry) -> Anime | None:
        self._ensure_fallback_indexes_loaded()

        provider_candidates: list[int] = []
        seen_provider_ids: set[int] = set()
        for provider, value in entry.provider_ids.items():
            lookup_key = parsing.provider_lookup_key(provider, value)
            if lookup_key is None:
                continue
            for anime_id in self._fallback_provider_index.get(lookup_key, []):
                if anime_id in seen_provider_ids:
                    continue
                seen_provider_ids.add(anime_id)
                provider_candidates.append(anime_id)

        for anime_id in provider_candidates:
            anime = self._get_fallback_anime(anime_id)
            if anime is not None and self._has_shared_provider_id(anime, entry):
                return anime

        if entry.anilist_id or entry.mal_id:
            return None

        title_candidates: list[int] = []
        seen_title_ids: set[int] = set()
        for key in self._entry_title_lookup_keys(entry):
            for anime_id in self._fallback_title_index.get(key, []):
                if anime_id in seen_title_ids:
                    continue
                seen_title_ids.add(anime_id)
                title_candidates.append(anime_id)

        for anime_id in title_candidates:
            anime = self._get_fallback_anime(anime_id)
            if anime is not None and self._is_reasonable_alternate_title_match(anime, entry):
                return anime

        return None

    def _find_conflicting_existing(self, entry: OfflineCatalogEntry, anime: Anime) -> Anime | None:
        if entry.anilist_id:
            existing = Anime.objects.filter(anilist_id=entry.anilist_id).first()
            if existing:
                return existing

        if entry.mal_id:
            existing = Anime.objects.filter(mal_id=entry.mal_id).first()
            if existing:
                return existing

        for by_title in Anime.objects.filter(title=anime.title):
            if self._is_conflict_match(by_title, entry):
                return by_title

        by_slug = Anime.objects.filter(slug=anime.slug).first()
        if by_slug and self._is_conflict_match(by_slug, entry):
            return by_slug

        fallback_existing = self._find_fallback_existing(entry)
        if fallback_existing is not None:
            return fallback_existing

        return None

    def _is_conflict_match(self, anime: Anime, entry: OfflineCatalogEntry) -> bool:
        if entry.anilist_id and anime.anilist_id == entry.anilist_id:
            return True
        if entry.mal_id and anime.mal_id == entry.mal_id:
            return True
        if entry.anilist_id or entry.mal_id:
            return False
        return self._is_reasonable_fallback_match(anime, entry)

    def _ensure_fallback_indexes_loaded(self) -> None:
        if self._fallback_indexes_loaded:
            return

        rows = Anime.objects.values(
            "id",
            "title",
            "title_jp",
            "synonyms",
            "provider_ids",
        )
        for row in rows:
            self._index_fallback_row(row)

        self._fallback_indexes_loaded = True

    def _index_fallback_anime(self, anime: Anime) -> None:
        if not anime.id:
            return
        self._fallback_anime_cache[anime.id] = anime
        self._index_fallback_row(
            {
                "id": anime.id,
                "title": anime.title,
                "title_jp": anime.title_jp,
                "synonyms": anime.synonyms,
                "provider_ids": anime.provider_ids,
            }
        )

    def _index_fallback_row(self, row: dict[str, Any]) -> None:
        anime_id = parsing.coerce_int(row.get("id"))
        if not anime_id:
            return

        title_keys: set[str] = set()
        for title in (
            row.get("title"),
            row.get("title_jp"),
            *(row.get("synonyms") or []),
        ):
            title_keys.update(parsing.title_lookup_keys(title))

        for key in title_keys:
            bucket = self._fallback_title_index[key]
            if anime_id not in bucket:
                bucket.append(anime_id)

        for provider, value in (row.get("provider_ids") or {}).items():
            lookup_key = parsing.provider_lookup_key(provider, value)
            if lookup_key is None:
                continue
            bucket = self._fallback_provider_index[lookup_key]
            if anime_id not in bucket:
                bucket.append(anime_id)

    def _get_fallback_anime(self, anime_id: int) -> Anime | None:
        cached = self._fallback_anime_cache.get(anime_id)
        if cached is not None:
            return cached

        anime = Anime.objects.filter(id=anime_id).first()
        if anime is not None:
            self._fallback_anime_cache[anime_id] = anime
        return anime

    def _entry_title_lookup_keys(self, entry: OfflineCatalogEntry) -> set[str]:
        lookup_keys = set(parsing.title_lookup_keys(entry.title))
        for synonym in entry.synonyms:
            lookup_keys.update(parsing.title_lookup_keys(synonym))
        return lookup_keys

    def _anime_title_lookup_keys(self, anime: Anime) -> set[str]:
        lookup_keys = set(parsing.title_lookup_keys(anime.title))
        lookup_keys.update(parsing.title_lookup_keys(anime.title_jp))
        for synonym in anime.synonyms or []:
            lookup_keys.update(parsing.title_lookup_keys(synonym))
        return lookup_keys

    def _has_shared_provider_id(self, anime: Anime, entry: OfflineCatalogEntry) -> bool:
        for provider, value in entry.provider_ids.items():
            lookup_key = parsing.provider_lookup_key(provider, value)
            if lookup_key is None:
                continue
            anime_value = (anime.provider_ids or {}).get(provider)
            anime_lookup_key = parsing.provider_lookup_key(provider, anime_value)
            if anime_lookup_key == lookup_key:
                return True
        return False

    def _is_reasonable_alternate_title_match(
        self, anime: Anime, entry: OfflineCatalogEntry
    ) -> bool:
        if entry.anilist_id or entry.mal_id:
            return False
        if not self._has_compatible_year(anime, entry):
            return False
        return bool(
            self._anime_title_lookup_keys(anime).intersection(self._entry_title_lookup_keys(entry))
        )

    def _has_compatible_year(self, anime: Anime, entry: OfflineCatalogEntry) -> bool:
        anime_year = anime.season_year or (anime.release_date.year if anime.release_date else None)
        if anime_year and entry.season_year:
            return anime_year == entry.season_year
        return not (anime_year or entry.season_year)

    def _is_reasonable_fallback_match(self, anime: Anime, entry: OfflineCatalogEntry) -> bool:
        # If we have canonical provider IDs, only trust ID-based matching.
        if entry.anilist_id or entry.mal_id:
            return False

        if not self._has_compatible_year(anime, entry):
            return False
        return anime.title.casefold() == entry.title.casefold()
