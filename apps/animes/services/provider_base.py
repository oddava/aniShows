"""Behaviour shared by the catalog providers (AniList, Jikan).

Both providers hand over AniList-shaped media payloads; this module turns them
into ``Anime`` field values and writes them. The rule that matters most: a
provider that does not know a value (no synopsis, no episode total yet, no
cover) must not erase the value already stored.
"""

import re
from datetime import UTC, datetime

from asgiref.sync import sync_to_async
from django.db import IntegrityError
from django.utils import timezone

from ...shared.logger import logger
from ..models import Anime

UNIQUE_ANIME_FIELDS = ("anilist_id", "mal_id", "slug")

# Applied only when creating a row; on update a missing value keeps the stored one.
CREATE_DEFAULTS = {
    "synopsis": "No description available.",
    "anime_type": Anime.AnimeType.tv,
    "status": Anime.AnimeStatus.finished,
    "duration_minutes": 24,
}

# Counts where 0 means "unknown" (an airing show's episode total, for one).
UNKNOWN_IF_ZERO = frozenset({"episode_count", "member_count", "duration_minutes"})

# Fields a provider may legitimately clear: the show stopped airing.
CLEARABLE_FIELDS = frozenset({"next_airing_episode", "next_airing_date"})


def _is_unknown(field: str, value) -> bool:
    if value is None or value == "" or value == [] or value == {}:
        return True
    return field in UNKNOWN_IF_ZERO and value == 0


def with_creation_defaults(anime_data: dict) -> dict:
    """Fill in placeholders for values a provider did not supply, for a new row."""
    filled = dict(anime_data)
    for field, default in CREATE_DEFAULTS.items():
        if _is_unknown(field, filled.get(field)):
            filled[field] = default
    return filled


def merge_for_update(anime: Anime, anime_data: dict) -> dict:
    """Drop values the provider did not know, so they keep what is stored.

    ``provider_ids`` is merged, not replaced: each provider only knows its own.
    """
    merged = {}
    for field, value in anime_data.items():
        if field in CLEARABLE_FIELDS:
            merged[field] = value
        elif _is_unknown(field, value):
            continue
        elif field == "provider_ids":
            known = {key: id_ for key, id_ in value.items() if id_ not in (None, "")}
            merged[field] = {**(anime.provider_ids or {}), **known}
        else:
            merged[field] = value
    return merged


class CatalogProviderBase:
    """Error tracking, payload normalization and persistence for a provider."""

    _WEEKDAY_MAP = {
        "monday": 0,
        "mondays": 0,
        "tuesday": 1,
        "tuesdays": 1,
        "wednesday": 2,
        "wednesdays": 2,
        "thursday": 3,
        "thursdays": 3,
        "friday": 4,
        "fridays": 4,
        "saturday": 5,
        "saturdays": 5,
        "sunday": 6,
        "sundays": 6,
    }
    _WEEKDAY_LABELS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

    _FORMAT_TO_ANIME_TYPE = {
        "TV": Anime.AnimeType.tv,
        "TV_SHORT": Anime.AnimeType.tv,
        "MOVIE": Anime.AnimeType.movie,
        "OVA": Anime.AnimeType.ova,
        "ONA": Anime.AnimeType.special,
        "SPECIAL": Anime.AnimeType.special,
        "MUSIC": Anime.AnimeType.special,
    }
    _STATUS_TO_ANIME_STATUS = {
        "RELEASING": Anime.AnimeStatus.airing,
        "FINISHED": Anime.AnimeStatus.finished,
        "NOT_YET_RELEASED": Anime.AnimeStatus.upcoming,
        "CANCELLED": Anime.AnimeStatus.finished,
    }
    _SOURCE_TO_SOURCE_MATERIAL = {
        "ORIGINAL": "Original",
        "MANGA": "Manga",
        "LIGHT_NOVEL": "Light Novel",
        "VISUAL_NOVEL": "Visual Novel",
        "VIDEO_GAME": "Game",
        "WEB_NOVEL": "Novel",
        "NOVEL": "Novel",
        "DOUJINSHI": "Other",
        "ANIME": "Original",
        "MUSIC": "Music",
        "MIXED_MEDIA": "Mixed Media",
        "PICTURE_BOOK": "Picture Book",
        "CARD_GAME": "Card Game",
        "WEB_MANGA": "Web Manga",
        "COMIC": "Manga",
        "LIVE_ACTION": "Other",
        "MULTIMEDIA_PROJECT": "Mixed Media",
        "OTHER": "Other",
    }

    last_error_code = ""
    last_error_message = ""

    def _set_last_error(self, code: str, message: str):
        self.last_error_code = code
        self.last_error_message = (message or "")[:500]

    def _reset_last_error(self):
        self.last_error_code = ""
        self.last_error_message = ""

    async def close(self):
        try:
            await self.client.aclose()
        except Exception:
            logger.debug("Ignoring error while closing %s client", type(self).__name__)

    def _sanitize_search_query(self, query_string: str) -> str:
        cleaned = (query_string or "").strip()
        if not cleaned:
            return ""
        cleaned = "".join(ch for ch in cleaned if ch.isprintable())
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned[:120]

    def _parse_date(self, date_obj):
        if not date_obj or not date_obj.get("year"):
            return None
        year = date_obj.get("year")
        month = date_obj.get("month") or 1
        day = date_obj.get("day") or 1
        try:
            return datetime(year, month, day).date()
        except ValueError:
            return None

    def _map_source_material(self, source):
        return self._SOURCE_TO_SOURCE_MATERIAL.get(source, "") if source else ""

    @classmethod
    def _normalize_broadcast_day(cls, day_name: str | None) -> str:
        weekday = cls._WEEKDAY_MAP.get(str(day_name or "").strip().lower())
        if weekday is None:
            return ""
        return cls._WEEKDAY_LABELS[weekday]

    @staticmethod
    def _parse_broadcast_time(time_text: str | None):
        candidate = str(time_text or "").strip()
        if not candidate:
            return None

        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                return datetime.strptime(candidate, fmt).time()
            except ValueError:
                continue
        return None

    @staticmethod
    def _iter_rankings(item: dict) -> list[dict]:
        rankings = item.get("rankings") or []
        if not isinstance(rankings, list):
            return []
        return [ranking for ranking in rankings if isinstance(ranking, dict)]

    @staticmethod
    def _status_distribution(item: dict) -> dict:
        stats = item.get("stats") or {}
        if not isinstance(stats, dict):
            return {}

        distribution = stats.get("statusDistribution") or []
        if not isinstance(distribution, list):
            return {}

        return {
            status: amount
            for entry in distribution
            if isinstance(entry, dict)
            and (status := entry.get("status"))
            and (amount := entry.get("amount")) is not None
        }

    @staticmethod
    def _normalized_tags(item: dict) -> list[str]:
        raw_tags = item.get("tags") or []
        if not isinstance(raw_tags, list):
            return []

        normalized_tags: list[str] = []
        seen: set[str] = set()

        for entry in raw_tags:
            if isinstance(entry, dict):
                if entry.get("isMediaSpoiler") or entry.get("isGeneralSpoiler"):
                    continue
                name = entry.get("name")
            elif isinstance(entry, str):
                name = entry
            else:
                continue

            if not isinstance(name, str):
                continue

            clean_name = " ".join(name.split()).strip().lower()
            if not clean_name or clean_name in seen:
                continue

            seen.add(clean_name)
            normalized_tags.append(clean_name)

        return normalized_tags

    def _ranked(self, item: dict, ranking_type: str):
        return next(
            (
                ranking.get("rank")
                for ranking in self._iter_rankings(item)
                if ranking.get("allTime") and ranking.get("type") == ranking_type
            ),
            None,
        )

    def _prepare_anime_data(self, item, title, title_native, slug):
        """Map a payload to Anime fields, reporting unknowns as None/empty.

        Placeholders for unknowns are applied by ``with_creation_defaults``
        when a row is created, never on update.
        """
        cover_image = item.get("coverImage") or {}
        if not isinstance(cover_image, dict):
            cover_image = {}
        broadcast = item.get("broadcast") or {}
        next_airing = item.get("nextAiringEpisode") or {}

        avg_score = item.get("averageScore")
        description = re.sub(r"<[^>]+>", "", item.get("description") or "").strip()

        return {
            "title": title,
            "title_jp": title_native or "",
            "slug": slug,
            "synopsis": description,
            "anime_type": self._FORMAT_TO_ANIME_TYPE.get(item.get("format")),
            "status": self._STATUS_TO_ANIME_STATUS.get(item.get("status")),
            "episode_count": item.get("episodes") or 0,
            "duration_minutes": item.get("duration") or 0,
            "member_count": item.get("popularity") or 0,
            "release_date": self._parse_date(item.get("startDate")),
            "end_date": self._parse_date(item.get("endDate")),
            "rating": round(avg_score / 10, 1) if avg_score else None,
            "meta_description": (description[:157] + "...")
            if len(description) > 160
            else description,
            "site_rank": self._ranked(item, "RATED"),
            "popularity_rank": self._ranked(item, "POPULAR"),
            "status_distribution": self._status_distribution(item),
            "external_links": item.get("externalLinks") or [],
            "tags": self._normalized_tags(item),
            "next_airing_episode": next_airing.get("episode"),
            "next_airing_date": datetime.fromtimestamp(next_airing["airingAt"], tz=UTC)
            if next_airing.get("airingAt")
            else None,
            "broadcast_day": self._normalize_broadcast_day(broadcast.get("day")),
            "broadcast_time": self._parse_broadcast_time(broadcast.get("time")),
            "broadcast_timezone": str(broadcast.get("timezone") or "").strip()[:64],
            "source_material": self._map_source_material(item.get("source")),
            "season": item.get("season") or "",
            "season_year": item.get("seasonYear"),
            "cover_image_external_url": self.normalize_external_image_url(
                cover_image.get("extraLarge") or cover_image.get("large")
            ),
            "banner_image_external_url": self.normalize_external_image_url(item.get("bannerImage")),
            "anilist_id": item.get("id"),
            "mal_id": item.get("idMal"),
            "synonyms": item.get("synonyms") or [],
            "producers": item.get("producers") or [],
            "provider_ids": item.get("providerIds") or {},
            "source_urls": item.get("sourceUrls") or [],
        }

    def _apply_recent_airing_transition(self, anime: Anime, anime_data: dict) -> None:
        """Persist the last confirmed aired episode before the schedule advances."""
        previous_episode = anime.next_airing_episode
        previous_airing_date = anime.next_airing_date

        if previous_episode is None or previous_airing_date is None:
            return

        if previous_airing_date > timezone.now():
            return

        incoming_episode = anime_data.get("next_airing_episode")
        incoming_airing_date = anime_data.get("next_airing_date")

        episode_advanced = incoming_episode is not None and incoming_episode > previous_episode
        airing_window_closed = incoming_episode is None or incoming_airing_date is None

        if not (episode_advanced or airing_window_closed):
            return

        last_aired_episode = anime.last_aired_episode
        last_aired_at = anime.last_aired_at
        if last_aired_episode == previous_episode and last_aired_at == previous_airing_date:
            return

        anime_data["last_aired_episode"] = previous_episode
        anime_data["last_aired_at"] = previous_airing_date

    @sync_to_async
    def _update_anime(self, anime, anime_data_dict):
        anime_data = dict(anime_data_dict)
        self._apply_recent_airing_transition(anime, anime_data)
        anime_data = merge_for_update(anime, anime_data)
        original_values = {field: getattr(anime, field, None) for field in anime_data}

        # Preemptively avoid unique-constraint collisions.
        for unique_field in UNIQUE_ANIME_FIELDS:
            value = anime_data.get(unique_field)
            if value in (None, ""):
                continue

            conflict_exists = (
                Anime.objects.filter(**{unique_field: value}).exclude(id=anime.id).exists()
            )
            if conflict_exists:
                logger.info(
                    f"Skipping conflicting {unique_field} '{value}' while updating Anime ID {anime.id}"
                )
                anime_data[unique_field] = original_values.get(unique_field)

        for key, value in anime_data.items():
            setattr(anime, key, value)

        try:
            anime.save()
        except IntegrityError as exc:
            # Last resort: keep identity fields stable and persist the rest.
            for unique_field in UNIQUE_ANIME_FIELDS:
                if unique_field in original_values:
                    setattr(anime, unique_field, original_values[unique_field])
            anime.save()
            logger.warning(
                f"Recovered from integrity conflict while updating Anime ID {anime.id}: {exc}"
            )
