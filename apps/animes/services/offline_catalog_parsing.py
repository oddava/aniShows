"""Parsing anime-offline-database records into ``OfflineCatalogEntry`` values.

Pure functions: nothing here touches the database or the network.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from django.utils.text import slugify

from ..models import Anime, Studio
from .jikan import JikanService

ANIME_TITLE_MAX_LENGTH = Anime._meta.get_field("title").max_length
ANIME_TITLE_JP_MAX_LENGTH = Anime._meta.get_field("title_jp").max_length
ANIME_SLUG_MAX_LENGTH = Anime._meta.get_field("slug").max_length
ANIME_URL_MAX_LENGTH = Anime._meta.get_field("cover_image_external_url").max_length
ANIME_SEASON_MAX_LENGTH = Anime._meta.get_field("season").max_length
ANIME_META_DESCRIPTION_MAX_LENGTH = Anime._meta.get_field("meta_description").max_length
STUDIO_NAME_MAX_LENGTH = Studio._meta.get_field("name").max_length
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


def coerce_int(value: Any, default: Any = None) -> int | Any | None:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def truncate_text(value: Any, max_length: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_length:
        return text
    return text[:max_length].rstrip()


def unique_strings(values: list[str]) -> list[str]:
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


def merged_list(current: list[str] | None, incoming: list[str]) -> list[str]:
    return unique_strings([*(current or []), *incoming])


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def map_type(source_type: str | None) -> str:
    type_map = {
        "TV": Anime.AnimeType.tv,
        "MOVIE": Anime.AnimeType.movie,
        "OVA": Anime.AnimeType.ova,
        "ONA": Anime.AnimeType.ona,
        "SPECIAL": Anime.AnimeType.special,
        "UNKNOWN": Anime.AnimeType.unknown,
    }
    return type_map.get((source_type or "UNKNOWN").upper(), Anime.AnimeType.unknown)


def map_status(source_status: str | None) -> str:
    status_map = {
        "FINISHED": Anime.AnimeStatus.finished,
        "ONGOING": Anime.AnimeStatus.airing,
        "UPCOMING": Anime.AnimeStatus.upcoming,
        "UNKNOWN": Anime.AnimeStatus.unknown,
    }
    return status_map.get((source_status or "UNKNOWN").upper(), Anime.AnimeStatus.unknown)


def duration_to_minutes(duration: dict[str, Any] | None) -> int | None:
    if not duration:
        return None

    try:
        value = float(duration.get("value") or 0)
    except (TypeError, ValueError):
        return None
    unit = str(duration.get("unit") or "").upper()
    if value <= 0:
        return None

    if unit == "SECONDS":
        return max(1, round(value / 60))
    if unit == "MINUTES":
        return int(value)
    if unit == "HOURS":
        return int(value * 60)
    return None


def score_to_rating(score: dict[str, Any] | None) -> float | None:
    if not score:
        return None
    value = score.get("arithmeticGeometricMean")
    if value is None:
        value = score.get("arithmeticMean")
    if value is None:
        value = score.get("median")
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def season_to_date(season: str | None, year: int | None) -> date | None:
    if not year:
        return None
    month = SEASON_MONTHS.get((season or "UNDEFINED").upper(), 1)
    return date(year, month, 1)


def pick_primary_studio(studios: list[str]) -> str | None:
    clean = unique_strings(studios)
    if not clean:
        return None
    studio_name = clean[0].strip()
    if studio_name.islower():
        return studio_name.title()
    return studio_name


def extract_numeric_path_id(path_parts: list[str]) -> int | None:
    for part in path_parts:
        if part.isdigit():
            return int(part)
    return None


def extract_provider_ids(source_urls: list[str]) -> dict[str, Any]:
    provider_ids: dict[str, Any] = {}
    for url in source_urls:
        parsed = urlparse(url)
        host = parsed.netloc.lower().removeprefix("www.")
        provider = PROVIDER_HOSTS.get(host)
        if not provider:
            continue

        extracted: str | int | None = None
        path_parts = [part for part in parsed.path.split("/") if part]
        if provider in {
            "anidb",
            "anilist",
            "animecountdown",
            "anisearch",
            "kitsu",
            "livechart",
            "myanimelist",
            "simkl",
        }:
            extracted = extract_numeric_path_id(path_parts)
        elif provider == "anime_planet":
            extracted = (
                path_parts[-1] if len(path_parts) >= 2 and path_parts[0] == "anime" else None
            )
        elif provider == "animenewsnetwork":
            extracted = parse_qs(parsed.query).get("id", [None])[0]
        elif provider == "notify_moe":
            extracted = (
                path_parts[-1] if len(path_parts) >= 2 and path_parts[0] == "anime" else None
            )

        if extracted is None:
            continue

        provider_ids[provider] = coerce_int(extracted, default=extracted)

    return provider_ids


def title_lookup_keys(value: Any) -> set[str]:
    candidate = str(value or "").strip()
    if not candidate:
        return set()

    normalized_space = " ".join(candidate.split()).casefold()
    lookup_keys = {f"text:{normalized_space}"}
    slug_key = slugify(candidate)
    if slug_key:
        lookup_keys.add(f"slug:{slug_key}")
    return lookup_keys


def provider_lookup_key(provider: Any, value: Any) -> tuple[str, str] | None:
    provider_name = str(provider or "").strip().casefold()
    if not provider_name or value in (None, ""):
        return None
    return provider_name, str(value).strip().casefold()


def prepare_entry(payload: dict[str, Any]) -> OfflineCatalogEntry | None:
    title = truncate_text(payload.get("title"), ANIME_TITLE_MAX_LENGTH)
    if not title:
        return None

    provider_ids = extract_provider_ids(payload.get("sources") or [])
    anime_type = map_type(payload.get("type"))
    status = map_status(payload.get("status"))
    season_info = payload.get("animeSeason") or {}
    season = truncate_text(season_info.get("season") or "", ANIME_SEASON_MAX_LENGTH)
    season_year = coerce_int(season_info.get("year"))
    if season_year is not None and not 1900 <= season_year <= 2100:
        season_year = None
    picture = truncate_text(
        JikanService.normalize_external_image_url(payload.get("picture")),
        ANIME_URL_MAX_LENGTH,
    )
    thumbnail = truncate_text(
        JikanService.normalize_external_image_url(payload.get("thumbnail")),
        ANIME_URL_MAX_LENGTH,
    )
    studio = truncate_text(
        pick_primary_studio(payload.get("studios") or []),
        STUDIO_NAME_MAX_LENGTH,
    )

    return OfflineCatalogEntry(
        raw=payload,
        title=title,
        base_slug=slugify(title),
        anime_type=anime_type,
        status=status,
        episode_count=max(coerce_int(payload.get("episodes"), 0), 0),
        duration_minutes=duration_to_minutes(payload.get("duration")),
        rating=score_to_rating(payload.get("score")),
        season=season,
        season_year=season_year,
        release_date=season_to_date(season, season_year),
        cover_url=picture,
        banner_url=thumbnail or picture,
        primary_studio=studio,
        anilist_id=coerce_int(provider_ids.get("anilist")),
        mal_id=coerce_int(provider_ids.get("myanimelist")),
        provider_ids=provider_ids,
        synonyms=unique_strings(payload.get("synonyms") or []),
        producers=unique_strings(payload.get("producers") or []),
        tags=unique_strings(payload.get("tags") or []),
        source_urls=unique_strings(payload.get("sources") or []),
    )
