from __future__ import annotations

import asyncio
import json
import random
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlparse, urlunparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from asgiref.sync import async_to_sync, sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils.text import slugify

from ...shared.logger import logger
from ...shared.retry import backoff, retry_after_seconds
from ..models import Anime, AnimeCharacter, AnimeStaff, Character, Genre, Staff, Studio
from .provider_base import CatalogProviderBase, with_creation_defaults
from .rate_limiting import APICallCache, CircuitBreaker
from .relation_links import sync_relations_from_media

DEFAULT_JIKAN_BASE_URL = "https://api.jikan.moe/v4"
JIKAN_COOLDOWN_CACHE_KEY = "jikan:global_cooldown_until"
def get_jikan_base_url() -> str:
    candidate = DEFAULT_JIKAN_BASE_URL
    if getattr(settings, "configured", False):
        candidate = getattr(settings, "JIKAN_BASE_URL", DEFAULT_JIKAN_BASE_URL)
    return (candidate or DEFAULT_JIKAN_BASE_URL).strip().rstrip("/")


JIKAN_BASE_URL = get_jikan_base_url()


@dataclass(slots=True)
class JikanThemesFetchResult:
    success: bool
    themes: dict | None = None
    reason_code: str = ""
    message: str = ""
    transient: bool = False


class JikanRateLimiter:
    """Adaptive rate limiter for Jikan API."""

    def __init__(
        self,
        # Public api.jikan.moe allows ~60 requests/minute.
        base_delay: float = 1.0,
        min_delay: float = 1.0,
        max_delay: float = 5.0,
        success_streak_threshold: int = 10,
    ):
        self.base_delay = base_delay
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.success_streak_threshold = success_streak_threshold

        self.current_delay = base_delay
        self.consecutive_429s = 0
        self.last_request_time = 0.0
        self.success_streak = 0
        self.total_requests = 0
        self.total_429s = 0

    async def acquire(self) -> None:
        now = time.time()
        try:
            global_cooldown_until = float(cache.get(JIKAN_COOLDOWN_CACHE_KEY) or 0.0)
        except Exception:
            global_cooldown_until = 0.0

        if global_cooldown_until > now:
            await asyncio.sleep(global_cooldown_until - now)

        now = time.time()
        elapsed = now - self.last_request_time
        if elapsed < self.current_delay:
            await asyncio.sleep(self.current_delay - elapsed)

        self.last_request_time = time.time()
        self.total_requests += 1

    def record_success(self) -> None:
        self.consecutive_429s = 0
        self.success_streak += 1
        if self.success_streak >= self.success_streak_threshold and self.current_delay > self.min_delay:
            self.current_delay = max(self.min_delay, self.current_delay * 0.95)
            self.success_streak = 0
            logger.debug("Reduced Jikan delay to %.2fs", self.current_delay)

    def record_429(self, *, cooldown_hint: float | None = None) -> None:
        self.consecutive_429s += 1
        self.success_streak = 0
        self.total_429s += 1

        backoff = min(2**self.consecutive_429s, 60)
        jitter = random.uniform(0, backoff * 0.3)
        self.current_delay = min(self.max_delay, self.base_delay + backoff + jitter)
        cooldown_seconds = max(self.current_delay, float(cooldown_hint or 0.0))

        try:
            now = time.time()
            existing = float(cache.get(JIKAN_COOLDOWN_CACHE_KEY) or 0.0)
            target = now + cooldown_seconds
            if target > existing:
                cache.set(JIKAN_COOLDOWN_CACHE_KEY, target, timeout=int(cooldown_seconds) + 5)
        except Exception:
            pass

        logger.warning(
            "Jikan 429 hit (consecutive=%s total=%s). Backing off for %.2fs",
            self.consecutive_429s,
            self.total_429s,
            self.current_delay,
        )

    def record_error(self) -> None:
        self.success_streak = 0
        self.current_delay = min(self.max_delay, self.current_delay * 1.1)

    def get_stats(self) -> dict[str, Any]:
        return {
            "total_requests": self.total_requests,
            "total_429s": self.total_429s,
            "current_delay": self.current_delay,
            "consecutive_429s": self.consecutive_429s,
            "success_streak": self.success_streak,
        }


class JikanService(CatalogProviderBase):
    """Jikan-backed service for MAL-linked enrichment and detail lookups."""

    BASE_URL = DEFAULT_JIKAN_BASE_URL
    MAX_PER_PAGE = 25
    REQUEST_BUDGET_DEFAULT = "default"
    REQUEST_BUDGET_INTERACTIVE = "interactive"
    TRUSTED_IMAGE_DOMAINS = (
        "cdn.myanimelist.net",
        "api-cdn.myanimelist.net",
        "myanimelist.net",
        "www.myanimelist.net",
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    )
    MAL_IMAGE_PROXY_DOMAINS = ("myanimelist.net", "www.myanimelist.net")
    IMAGE_FILE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")
    MEDIA_FIELDS = """
        id
        idMal
        title { romaji english native }
        format status episodes averageScore popularity duration
        startDate { year month day }
        endDate { year month day }
        season seasonYear
        source
        genres
        tags { name rank isGeneralSpoiler isMediaSpoiler }
        studios(isMain: true) { nodes { name } }
        description
        coverImage { large extraLarge }
        bannerImage
        trailer { id site }
        rankings { rank type allTime context }
        stats { statusDistribution { status amount } }
        externalLinks { site url icon }
        nextAiringEpisode { episode airingAt }
        relations {
            edges {
                relationType
                node { id title { romaji english native } type format status coverImage { large } }
            }
        }
        characterPreview: characters(perPage: 10, sort: [ROLE, RELEVANCE]) {
            edges {
                role
                node { id name { full native } image { large } description }
                voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                    id name { full native } image { large } description
                }
            }
        }
        staffPreview: staff(perPage: 10, sort: [RELEVANCE, ID]) {
            edges {
                role
                node { id name { full native } image { large } description }
            }
        }
    """
    MEDIA_FIELDS_WITH_THEMES = (
        MEDIA_FIELDS
        + """
        openings
        endings
    """
    )

    # Anime payloads carry the real AniList ID (or None) in "id" and the MAL ID in "idMal".
    # Characters and staff still get synthetic IDs in their own ranges (Character/Staff
    # rows are keyed by anilist_id).
    CHARACTER_ID_OFFSET = 1_600_000_000
    STAFF_ID_OFFSET = 1_700_000_000
    MAX_INT_32 = 2_147_483_647

    _STATUS_MAP = {
        "currently airing": "RELEASING",
        "finished airing": "FINISHED",
        "not yet aired": "NOT_YET_RELEASED",
        "cancelled": "CANCELLED",
    }
    _FORMAT_MAP = {
        "tv": "TV",
        "movie": "MOVIE",
        "ova": "OVA",
        "ona": "ONA",
        "special": "SPECIAL",
        "music": "MUSIC",
    }
    _SOURCE_MAP = {
        "original": "ORIGINAL",
        "manga": "MANGA",
        "light novel": "LIGHT_NOVEL",
        "visual novel": "VISUAL_NOVEL",
        "game": "VIDEO_GAME",
        "video game": "VIDEO_GAME",
        "web novel": "WEB_NOVEL",
        "novel": "NOVEL",
        "doujinshi": "DOUJINSHI",
        "anime": "ANIME",
        "music": "MUSIC",
        "mixed media": "MIXED_MEDIA",
        "picture book": "PICTURE_BOOK",
        "card game": "CARD_GAME",
        "web manga": "WEB_MANGA",
        "comic": "COMIC",
        "live action": "LIVE_ACTION",
        "multimedia project": "MULTIMEDIA_PROJECT",
        "other": "OTHER",
    }
    _RELATION_TYPE_MAP = {
        "adaptation": "ADAPTATION",
        "alternative setting": "ALTERNATIVE",
        "alternative version": "ALTERNATIVE",
        "character": "CHARACTER",
        "full story": "PARENT",
        "other": "OTHER",
        "parent story": "PARENT",
        "prequel": "PREQUEL",
        "sequel": "SEQUEL",
        "side story": "SIDE_STORY",
        "spin-off": "SPIN_OFF",
        "summary": "SUMMARY",
    }

    def __init__(self, enable_caching: bool = True, enable_rate_limiting: bool = True):
        self.base_url = get_jikan_base_url()
        self.client = httpx.AsyncClient(headers={"Accept": "application/json"}, timeout=15.0)
        self.rate_limiter = JikanRateLimiter() if enable_rate_limiting else None
        self.call_cache = APICallCache(ttl=1800) if enable_caching else None
        self.circuit_breaker = CircuitBreaker(
            "jikan_api",
            failure_threshold=5,
            recovery_timeout=300,
        )
        self.last_error_code = ""
        self.last_error_message = ""


    def _get_cached_result(self, endpoint: str, params: str) -> dict | None:
        if self.call_cache:
            return self.call_cache.get(endpoint, params)
        return None

    def _cache_result(self, endpoint: str, params: str, result: dict):
        if self.call_cache:
            self.call_cache.set(endpoint, params, result)

    def _check_circuit_breaker(self) -> bool:
        return not self.circuit_breaker.is_open()

    def _record_success(self):
        self.circuit_breaker.record_success()

    def _record_failure(self):
        self.circuit_breaker.record_failure()


    async def download_image(self, url: str) -> bytes | None:
        """Download image bytes from a trusted HTTPS URL."""
        if not url:
            return None

        resolved_url = self.resolve_fetchable_image_url(url)
        if not resolved_url:
            return None

        try:
            await asyncio.sleep(0.2)
            response = await self.client.get(resolved_url, timeout=10)
            response.raise_for_status()

            content_type = (response.headers.get("content-type") or "").lower()
            if not content_type.startswith("image/"):
                logger.warning(f"Non-image content type blocked: {content_type}")
                return None

            return response.content
        except httpx.HTTPError as exc:
            logger.error(f"Error downloading image {resolved_url}: {exc}")
            return None

    @sync_to_async
    def _save_image(self, anime, field_name, filename, image_data):
        field = getattr(anime, field_name)
        field.save(filename, ContentFile(image_data), save=True)

        from ..tasks import generate_image_thumbnails

        generate_image_thumbnails.delay(anime.id)

    @sync_to_async
    def _save_external_url(self, anime, field_name, url):
        setattr(anime, field_name, self.normalize_external_image_url(url))
        anime.save(update_fields=[field_name])

    @classmethod
    def _is_trusted_image_domain(cls, domain: str) -> bool:
        return any(domain.endswith(trusted) or domain == trusted for trusted in cls.TRUSTED_IMAGE_DOMAINS)

    @classmethod
    def normalize_external_image_url(cls, url: str | None) -> str:
        candidate = (url or "").strip()
        if not candidate:
            return ""

        parsed = urlparse(candidate)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            logger.warning(f"Blocked malformed image URL: {candidate}")
            return ""

        domain = parsed.netloc.lower()
        path = parsed.path or ""
        if domain in cls.MAL_IMAGE_PROXY_DOMAINS:
            lower_path = path.lower()
            if "/images/" in lower_path or lower_path.endswith(cls.IMAGE_FILE_EXTENSIONS):
                parsed = parsed._replace(scheme="https", netloc="cdn.myanimelist.net")
                return urlunparse(parsed)

        if parsed.scheme != "https":
            parsed = parsed._replace(scheme="https")
            return urlunparse(parsed)

        return candidate

    @classmethod
    def resolve_fetchable_image_url(cls, url: str | None) -> str:
        normalized = cls.normalize_external_image_url(url)
        if not normalized:
            return ""

        parsed = urlparse(normalized)
        domain = parsed.netloc.lower()
        if cls._is_trusted_image_domain(domain):
            return normalized

        logger.info(f"Blocked untrusted image domain before fetch queue: {domain}")
        return ""


    def _search_variants(self, query_string: str) -> list[str]:
        primary = self._sanitize_search_query(query_string)
        if not primary:
            return []

        variants = [primary]
        simplified = re.sub(
            r"[^0-9A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\s]",
            " ",
            primary,
        )
        simplified = re.sub(r"\s+", " ", simplified).strip()
        if simplified and simplified not in variants:
            variants.append(simplified[:120])

        return variants

    @classmethod
    def _query_options_for_budget(
        cls,
        request_budget: Literal["default", "interactive"],
    ) -> dict[str, Any]:
        if request_budget == cls.REQUEST_BUDGET_INTERACTIVE:
            return {
                "retry_count": 1,
                "max_rate_limit_wait": 0.0,
                "request_timeout": 8.0,
            }

        return {}

    async def _get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        retry_count: int = 5,
        use_cache: bool = True,
        *,
        max_rate_limit_wait: float | None = None,
        request_timeout: float | None = None,
        endpoint: str | None = None,
    ) -> dict:
        from .metrics import API_CALL_COUNT, API_CALL_DURATION

        self._reset_last_error()

        params = {key: value for key, value in (params or {}).items() if value not in (None, "", [])}
        endpoint_name = endpoint or path.strip("/").replace("/", "_") or "root"
        cache_key = json.dumps({"path": path, "params": params}, sort_keys=True, default=str)

        if use_cache:
            cached = self._get_cached_result(endpoint_name, cache_key)
            if cached is not None:
                return cached

        if not self._check_circuit_breaker():
            self._set_last_error("transport_error", "circuit_breaker_open")
            return {}

        for attempt in range(retry_count):
            _start = time.time()
            _status = "success"
            try:
                if self.rate_limiter:
                    await self.rate_limiter.acquire()

                response = await self.client.get(
                    f"{self.base_url}{path}",
                    params=params,
                    timeout=request_timeout if request_timeout is not None else self.client.timeout,
                )

                if response.status_code == 429:
                    _status = "rate_limited"
                    wait_time = retry_after_seconds(response.headers.get("Retry-After"))
                    if wait_time is None:
                        wait_time = min(2**attempt, 60)
                    if self.rate_limiter:
                        self.rate_limiter.record_429(cooldown_hint=wait_time)
                    self._set_last_error("rate_limited", f"http_429:{endpoint_name}")
                    if max_rate_limit_wait is not None and wait_time > max_rate_limit_wait:
                        return {}
                    if attempt < retry_count - 1:
                        await asyncio.sleep(wait_time)
                        continue
                    return {}

                if 500 <= response.status_code < 600:
                    _status = "failure"
                    if self.rate_limiter:
                        self.rate_limiter.record_error()
                    if attempt < retry_count - 1:
                        await backoff(min(2**attempt, 15))
                        continue
                    self._set_last_error("transport_error", f"http_{response.status_code}")
                    self._record_failure()
                    return {}

                if 400 <= response.status_code < 500:
                    message = self._response_message(response)
                    if response.status_code == 404:
                        _status = "not_found"
                        self._set_last_error("not_found", message or f"http_404:{endpoint_name}")
                    elif response.status_code in {400, 422}:
                        _status = "client_error"
                        self._set_last_error("invalid_variable", message or f"http_{response.status_code}")
                    else:
                        _status = "client_error"
                        self._set_last_error("transport_error", message or f"http_{response.status_code}")
                    return {}

                response.raise_for_status()
                payload = response.json()
                self._record_success()
                self._reset_last_error()

                if use_cache and payload:
                    self._cache_result(endpoint_name, cache_key, payload)

                return payload
            except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
                _status = "failure"
                if self.rate_limiter:
                    self.rate_limiter.record_error()
                if attempt < retry_count - 1:
                    await backoff(min(2**attempt, 15))
                    continue
                self._set_last_error("transport_error", str(exc))
                self._record_failure()
                return {}
            except httpx.HTTPError as exc:
                _status = "failure"
                if self.rate_limiter:
                    self.rate_limiter.record_error()
                if attempt < retry_count - 1:
                    await backoff(min(2**attempt, 15))
                    continue
                self._set_last_error("transport_error", str(exc))
                self._record_failure()
                return {}
            except Exception as exc:
                _status = "failure"
                if attempt >= retry_count - 1:
                    self._set_last_error("transport_error", str(exc))
                    self._record_failure()
                    return {}
            finally:
                try:
                    API_CALL_DURATION.labels(
                        service="jikan",
                        endpoint=endpoint_name,
                        status=_status,
                    ).observe(time.time() - _start)
                    API_CALL_COUNT.labels(
                        service="jikan",
                        endpoint=endpoint_name,
                        status=_status,
                    ).inc()
                except Exception:
                    pass

        if not self.last_error_code:
            self._set_last_error("transport_error", "retries_exhausted")
        self._record_failure()
        return {}

    async def get_recent_updates(self, limit: int = 50) -> list[dict]:
        results = await self._fetch_current_season_anime(limit=limit)
        if len(results) < limit:
            fallback_results = await self._fetch_top_airing_anime(limit=limit - len(results))
            results.extend(fallback_results)

        deduped_results: list[dict] = []
        seen_mal_ids: set[int] = set()
        for item in self._sort_trending_candidates(results):
            mal_id = self._coerce_positive_int(item.get("idMal"))
            if not mal_id or mal_id in seen_mal_ids:
                continue
            seen_mal_ids.add(mal_id)
            deduped_results.append(item)
            if len(deduped_results) >= limit:
                break

        return deduped_results[:limit]

    async def _fetch_current_season_anime(self, *, limit: int) -> list[dict]:
        results: list[dict] = []
        seen_mal_ids: set[int] = set()
        page = 1
        per_page = min(max(1, limit), self.MAX_PER_PAGE)

        while len(results) < limit:
            payload = await self._get(
                "/seasons/now",
                params={"page": page, "limit": per_page},
                endpoint="seasons_now",
            )
            page_items = payload.get("data") or []
            if not isinstance(page_items, list) or not page_items:
                break

            self._extend_unique_anime_results(results, seen_mal_ids, page_items)

            pagination = payload.get("pagination") or {}
            if not pagination.get("has_next_page"):
                break

            page += 1
            per_page = min(self.MAX_PER_PAGE, max(1, limit - len(results)))

        return results

    async def _fetch_top_airing_anime(self, *, limit: int) -> list[dict]:
        results: list[dict] = []
        seen_mal_ids: set[int] = set()
        page = 1
        per_page = min(max(1, limit), self.MAX_PER_PAGE)

        while len(results) < limit:
            payload = await self._get(
                "/top/anime",
                params={"filter": "airing", "page": page, "limit": per_page},
                endpoint="top_airing_anime",
            )
            page_items = payload.get("data") or []
            if not isinstance(page_items, list) or not page_items:
                break

            self._extend_unique_anime_results(results, seen_mal_ids, page_items)

            pagination = payload.get("pagination") or {}
            if not pagination.get("has_next_page"):
                break

            page += 1
            per_page = min(self.MAX_PER_PAGE, max(1, limit - len(results)))

        return results

    def _extend_unique_anime_results(
        self,
        results: list[dict],
        seen_mal_ids: set[int],
        items: list[dict],
    ) -> None:
        # The self-hosted Jikan instance can emit duplicate MAL IDs within the same page.
        for item in items:
            if not isinstance(item, dict):
                continue

            normalized = self._normalize_anime_item(item)
            mal_id = self._coerce_positive_int(normalized.get("idMal"))
            if not mal_id or mal_id in seen_mal_ids:
                continue

            seen_mal_ids.add(mal_id)
            results.append(normalized)

    @staticmethod
    def _sort_trending_candidates(items: list[dict]) -> list[dict]:
        def ranking_value(item: dict, ranking_type: str) -> int:
            for ranking in item.get("rankings") or []:
                if (
                    isinstance(ranking, dict)
                    and ranking.get("type") == ranking_type
                    and ranking.get("rank") is not None
                ):
                    return int(ranking["rank"])
            return 1_000_000

        def sort_key(item: dict) -> tuple:
            status = item.get("status")
            average_score = item.get("averageScore")
            members = item.get("popularity")
            return (
                0 if status == "RELEASING" else 1,
                ranking_value(item, "POPULAR"),
                ranking_value(item, "RATED"),
                -(int(average_score) if average_score is not None else 0),
                -(int(members) if members is not None else 0),
                -(int(item.get("idMal") or 0)),
            )

        return sorted(items, key=sort_key)

    async def search_anime(self, query_string: str, *, per_page: int = 5) -> list[dict]:
        for variant in self._search_variants(query_string):
            payload = await self._get(
                "/anime",
                params={"q": variant, "page": 1, "limit": max(1, min(per_page, 10))},
                endpoint="anime_search",
            )
            page_items = payload.get("data") or []
            if isinstance(page_items, list) and page_items:
                normalized_items = [
                    self._normalize_anime_item(item)
                    for item in page_items
                    if isinstance(item, dict)
                ]
                detailed_items: list[dict] = []
                for item in normalized_items:
                    mal_id = item.get("idMal")
                    if mal_id:
                        full_item = await self.search_by_mal_id(mal_id)
                        if full_item:
                            detailed_items.append(full_item)
                            continue
                    detailed_items.append(item)
                return detailed_items
        self._set_last_error("not_found", f"title:{query_string}")
        return []

    async def get_anime_by_id(self, anilist_id: int) -> dict | None:
        """Fetch by real AniList ID. Jikan only knows MAL IDs, so this needs a local row."""
        if not isinstance(anilist_id, int) or anilist_id <= 0 or anilist_id > self.MAX_INT_32:
            self._set_last_error("invalid_variable", "invalid_anilist_id")
            return None

        mal_id = await self._mal_id_for_anilist_id(anilist_id)
        if not mal_id:
            self._set_last_error("not_found", f"anilist_id:{anilist_id}")
            return None

        item = await self._get_full_anime_payload(mal_id, anilist_id=anilist_id)
        if item:
            return item
        if not self.last_error_code:
            self._set_last_error("not_found", f"anilist_id:{anilist_id}")
        return None

    async def get_airing_anime_by_id(self, anilist_id: int) -> dict | None:
        if not isinstance(anilist_id, int) or anilist_id <= 0 or anilist_id > self.MAX_INT_32:
            self._set_last_error("invalid_variable", "invalid_anilist_id")
            return None

        mal_id = await self._mal_id_for_anilist_id(anilist_id)
        if not mal_id:
            self._set_last_error("not_found", f"anilist_id:{anilist_id}")
            return None

        item = await self._get_airing_anime_payload(mal_id, anilist_id=anilist_id)
        if item:
            return item
        if not self.last_error_code:
            self._set_last_error("not_found", f"anilist_id:{anilist_id}")
        return None

    async def search_by_mal_id(self, mal_id: int, *, anilist_id: int | None = None) -> dict | None:
        resolved_mal_id = self._coerce_positive_int(mal_id)
        if not resolved_mal_id or resolved_mal_id > self.MAX_INT_32:
            self._set_last_error("invalid_variable", "invalid_mal_id")
            return None

        item = await self._get_full_anime_payload(resolved_mal_id, anilist_id=anilist_id)
        if item:
            return item
        if not self.last_error_code:
            self._set_last_error("not_found", f"mal_id:{resolved_mal_id}")
        return None

    async def search_airing_by_mal_id(
        self, mal_id: int, *, anilist_id: int | None = None
    ) -> dict | None:
        resolved_mal_id = self._coerce_positive_int(mal_id)
        if not resolved_mal_id or resolved_mal_id > self.MAX_INT_32:
            self._set_last_error("invalid_variable", "invalid_mal_id")
            return None

        item = await self._get_airing_anime_payload(resolved_mal_id, anilist_id=anilist_id)
        if item:
            return item
        if not self.last_error_code:
            self._set_last_error("not_found", f"mal_id:{resolved_mal_id}")
        return None

    async def update_anime_manual(self, anime: Anime, item: dict | None = None) -> bool:
        """Update local anime fields from Jikan without the heavier media refresh path."""
        media = item or await self.resolve_media_for_anime(anime)
        if not media:
            logger.info("Skipped manual Jikan update for Anime ID %s: no matching media", anime.id)
            return False

        title_payload = media.get("title") or {}
        title_romaji = title_payload.get("romaji", "")
        title_english = title_payload.get("english", "")
        title_native = title_payload.get("native", "")
        title = title_english or title_romaji or anime.title

        anime_data_dict = self._prepare_anime_data(media, title, title_native, anime.slug)
        anime_data_dict.pop("slug", None)

        # Airing sync only needs fresh schedule/status fields, not a full metadata/image refresh.
        await self._update_anime(anime, anime_data_dict)
        return True

    async def refresh_anime_metadata(self, anime: Anime, item: dict | None = None) -> bool:
        """Hydrate full anime metadata, relationships, and media from Jikan."""
        media = item or await self.resolve_media_for_anime(anime)
        if not media:
            logger.info("Skipped metadata refresh for Anime ID %s: no matching media", anime.id)
            return False

        title_payload = media.get("title") or {}
        title_romaji = title_payload.get("romaji", "")
        title_english = title_payload.get("english", "")
        title_native = title_payload.get("native", "")
        title = title_english or title_romaji or anime.title

        await self._update_anime_async(anime, media, title, title_native, anime.slug)
        return True

    async def resolve_airing_media_for_anime(self, anime: Anime) -> dict | None:
        if anime.mal_id:
            item = await self.search_airing_by_mal_id(anime.mal_id, anilist_id=anime.anilist_id)
            if item:
                return item

        return await self.resolve_media_for_anime(anime)

    async def resolve_media_for_anime(self, anime: Anime) -> dict | None:
        if anime.mal_id:
            item = await self.search_by_mal_id(anime.mal_id, anilist_id=anime.anilist_id)
            if item:
                return item

        title = (anime.title or "").strip()
        if not title:
            if not self.last_error_code:
                self._set_last_error("not_found", "missing_title")
            return None

        results = await self.search_anime(title)
        if not results:
            if not self.last_error_code:
                self._set_last_error("not_found", f"title:{title}")
            return None

        expected_titles = {title.casefold()}
        if anime.title_jp:
            expected_titles.add(anime.title_jp.casefold())

        # Jikan results never carry AniList IDs, so match on MAL ID (when known) and title.
        for candidate in results:
            if anime.mal_id and candidate.get("idMal") != anime.mal_id:
                continue

            titles = candidate.get("title") or {}
            candidate_titles = {
                (titles.get("english") or "").casefold(),
                (titles.get("romaji") or "").casefold(),
                (titles.get("native") or "").casefold(),
            }
            if expected_titles.intersection(candidate_titles):
                if anime.anilist_id:
                    return {**candidate, "id": anime.anilist_id}
                return candidate

        if anime.mal_id:
            for candidate in results:
                if candidate.get("idMal") == anime.mal_id:
                    return await self.search_by_mal_id(anime.mal_id, anilist_id=anime.anilist_id)

        self._set_last_error("not_found", f"title:{title}")
        return None


    def _normalize_broadcast_payload(self, payload: dict[str, Any] | None) -> dict[str, str]:
        broadcast = payload if isinstance(payload, dict) else {}
        return {
            "day": self._normalize_broadcast_day(broadcast.get("day")),
            "time": str(broadcast.get("time") or "").strip(),
            "timezone": str(broadcast.get("timezone") or "").strip(),
        }

    @staticmethod
    def _parse_next_episode_airing_at(value: Any) -> int | None:
        if value in (None, ""):
            return None

        if isinstance(value, (int, float)):
            resolved = int(value)
            return resolved if resolved > 0 else None

        if isinstance(value, str):
            candidate = value.strip()
            if not candidate:
                return None
            try:
                return int(candidate)
            except ValueError:
                try:
                    parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
                except ValueError:
                    return None
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=UTC)
                return int(parsed.astimezone(UTC).timestamp())

        return None

    def _merge_next_airing_payload(
        self,
        item: dict[str, Any],
        estimated_next_airing: dict[str, int] | None,
    ) -> dict[str, int] | None:
        raw_candidates = [item.get("next_episode"), item.get("nextEpisode")]

        for candidate in raw_candidates:
            if not isinstance(candidate, dict):
                continue

            airing_at = self._parse_next_episode_airing_at(
                candidate.get("aired_at") or candidate.get("airedAt")
            )
            if not airing_at:
                continue

            merged = {"airingAt": airing_at}
            episode = self._coerce_positive_int(
                candidate.get("episode") or candidate.get("number")
            )
            if episode:
                merged["episode"] = episode
            elif estimated_next_airing and estimated_next_airing.get("episode"):
                merged["episode"] = estimated_next_airing["episode"]
            return merged

        return estimated_next_airing


    async def _get_full_anime_payload(
        self,
        mal_id: int,
        *,
        anilist_id: int | None = None,
    ) -> dict | None:
        anime_payload, characters_payload, staff_payload, themes_payload, stats_payload, next_airing = (
            await asyncio.gather(
                self._get(f"/anime/{mal_id}/full", endpoint="anime_full"),
                self._get(f"/anime/{mal_id}/characters", endpoint="anime_characters"),
                self._get(f"/anime/{mal_id}/staff", endpoint="anime_staff"),
                self._get(f"/anime/{mal_id}/themes", endpoint="anime_themes"),
                self._get(f"/anime/{mal_id}/statistics", endpoint="anime_statistics"),
                self._estimate_next_airing_episode(mal_id),
            )
        )

        anime_data = anime_payload.get("data")
        if not isinstance(anime_data, dict):
            return None

        return self._normalize_anime_item(
            anime_data,
            characters_payload=characters_payload,
            staff_payload=staff_payload,
            themes_payload=themes_payload,
            stats_payload=stats_payload,
            next_airing=next_airing,
            anilist_id=anilist_id,
        )

    async def _get_airing_anime_payload(
        self,
        mal_id: int,
        *,
        anilist_id: int | None = None,
    ) -> dict | None:
        anime_payload = await self._get(
            f"/anime/{mal_id}/full",
            endpoint="anime_full_airing",
        )
        anime_data = anime_payload.get("data")
        if not isinstance(anime_data, dict):
            return None

        next_airing = self._merge_next_airing_payload(anime_data, None)
        if next_airing is None and self._normalize_status(anime_data.get("status")) == "RELEASING":
            next_airing = await self._estimate_next_airing_episode(mal_id, anime_data=anime_data)

        return self._normalize_anime_item(
            anime_data,
            next_airing=next_airing,
            anilist_id=anilist_id,
        )

    @classmethod
    def _coerce_positive_int(cls, value: Any) -> int | None:
        try:
            resolved = int(value)
        except (TypeError, ValueError):
            return None
        return resolved if resolved > 0 else None

    @classmethod
    def _service_id_from_mal_id(cls, mal_id: int | None, *, offset: int) -> int | None:
        resolved_mal_id = cls._coerce_positive_int(mal_id)
        if not resolved_mal_id:
            return None
        sync_id = offset + resolved_mal_id
        if sync_id > cls.MAX_INT_32:
            return None
        return sync_id

    @classmethod
    def _character_sync_id(cls, mal_id: int | None) -> int | None:
        return cls._service_id_from_mal_id(mal_id, offset=cls.CHARACTER_ID_OFFSET)

    @classmethod
    def _staff_sync_id(cls, mal_id: int | None) -> int | None:
        return cls._service_id_from_mal_id(mal_id, offset=cls.STAFF_ID_OFFSET)

    async def _mal_id_for_anilist_id(self, anilist_id: int) -> int | None:
        return await sync_to_async(
            lambda: Anime.objects.filter(anilist_id=anilist_id).values_list("mal_id", flat=True).first()
        )()

    @staticmethod
    def _response_message(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return (response.text or "")[:500]

        if isinstance(payload, dict):
            for key in ("message", "error", "status", "type"):
                value = payload.get(key)
                if value:
                    return str(value)[:500]
        return json.dumps(payload, ensure_ascii=False)[:500]


    def _lookup_existing_anime(
        self,
        *,
        anilist_id: int | None = None,
        mal_id: int | None = None,
        slug: str | None = None,
        title: str | None = None,
        provider_ids: dict[str, Any] | None = None,
    ) -> Anime | None:
        """Find the local row for a payload by provider IDs.

        Titles are not unique, so slug/title are only consulted when the payload has no
        provider IDs at all.
        """
        resolved_anilist_id = self._coerce_positive_int(anilist_id)
        resolved_mal_id = self._coerce_positive_int(mal_id)

        if resolved_anilist_id:
            anime = Anime.objects.filter(anilist_id=resolved_anilist_id).first()
            if anime:
                return anime

        if resolved_mal_id:
            anime = Anime.objects.filter(mal_id=resolved_mal_id).first()
            if anime:
                return anime

            anime = Anime.objects.filter(provider_ids__myanimelist=resolved_mal_id).first()
            if anime:
                return anime

            anime = Anime.objects.filter(provider_ids__jikan=resolved_mal_id).first()
            if anime:
                return anime

        if resolved_anilist_id:
            anime = Anime.objects.filter(provider_ids__anilist=resolved_anilist_id).first()
            if anime:
                return anime

        has_provider_id = bool(resolved_anilist_id or resolved_mal_id)
        for provider, value in (provider_ids or {}).items():
            if value in (None, ""):
                continue
            has_provider_id = True
            anime = Anime.objects.filter(**{f"provider_ids__{provider}": value}).first()
            if anime:
                return anime

        if has_provider_id:
            return None

        if slug:
            anime = Anime.objects.filter(slug=slug).first()
            if anime:
                return anime

        if title:
            anime = Anime.objects.filter(title=title).first()
            if anime:
                return anime

        return None


    def _normalize_anime_item(
        self,
        item: dict[str, Any],
        *,
        characters_payload: dict | None = None,
        staff_payload: dict | None = None,
        themes_payload: dict | None = None,
        stats_payload: dict | None = None,
        next_airing: dict | None = None,
        anilist_id: int | None = None,
    ) -> dict[str, Any]:
        mal_id = self._coerce_positive_int(item.get("mal_id"))
        broadcast = self._normalize_broadcast_payload(item.get("broadcast"))
        next_airing_payload = self._merge_next_airing_payload(item, next_airing)
        aired = item.get("aired") or {}
        aired_prop = aired.get("prop") or {}
        start_date = self._normalize_jikan_date(aired_prop.get("from"))
        end_date = self._normalize_jikan_date(aired_prop.get("to"))
        theme_data = (themes_payload or {}).get("data") or item.get("theme") or {}

        score = item.get("score")
        average_score = round(score * 10) if score not in (None, "") else None

        external_links = self._normalize_external_links(
            item.get("external"),
            item.get("streaming"),
            item.get("url"),
        )

        normalized = {
            "id": anilist_id,
            "idMal": mal_id,
            "title": self._normalize_title_payload(item),
            "format": self._normalize_format(item.get("type")),
            "status": self._normalize_status(item.get("status")),
            "episodes": self._coerce_positive_int(item.get("episodes")) or 0,
            "averageScore": average_score,
            "popularity": self._coerce_positive_int(item.get("members")) or 0,
            "duration": self._normalize_duration_minutes(item.get("duration")),
            "startDate": start_date,
            "endDate": end_date,
            "season": str(item.get("season") or "").upper(),
            "seasonYear": self._coerce_positive_int(item.get("year"))
            or (start_date.get("year") if start_date else None),
            "source": self._normalize_source(item.get("source")),
            "genres": [genre["name"] for genre in item.get("genres") or [] if genre.get("name")],
            "tags": self._normalize_tags(item),
            "studios": {
                "nodes": [
                    {"name": studio["name"]}
                    for studio in item.get("studios") or []
                    if studio.get("name")
                ]
            },
            "description": item.get("synopsis") or "",
            "coverImage": self._normalize_cover_image(item.get("images")),
            "bannerImage": "",
            "trailer": self._normalize_trailer(item.get("trailer")),
            "rankings": self._normalize_rankings(item),
            "stats": self._normalize_statistics(stats_payload),
            "externalLinks": external_links,
            # List/search payloads carry no relations; None keeps the stored ones.
            "relations": {"edges": self._normalize_relations(item["relations"] or [])}
            if "relations" in item
            else None,
            "characterPreview": {
                "edges": self._normalize_characters((characters_payload or {}).get("data") or [])
            },
            "staffPreview": {
                "edges": self._normalize_staff((staff_payload or {}).get("data") or [])
            },
            "openings": theme_data.get("openings") or [],
            "endings": theme_data.get("endings") or [],
            "synonyms": self._normalize_synonyms(item),
            "producers": self._normalize_name_list(item.get("producers")),
            "sourceUrls": [url for url in [item.get("url")] if url],
            "providerIds": {"myanimelist": mal_id, "jikan": mal_id},
            "nextAiringEpisode": next_airing_payload,
            "broadcast": broadcast,
        }

        if not normalized["bannerImage"]:
            normalized["bannerImage"] = ""
        return normalized

    @staticmethod
    def _normalize_title_payload(item: dict[str, Any]) -> dict[str, str]:
        return {
            "romaji": (item.get("title") or "").strip(),
            "english": (item.get("title_english") or "").strip(),
            "native": (item.get("title_japanese") or "").strip(),
        }

    @classmethod
    def _normalize_format(cls, raw_type: Any) -> str:
        return cls._FORMAT_MAP.get(str(raw_type or "").strip().lower(), "TV")

    @classmethod
    def _normalize_status(cls, raw_status: Any) -> str:
        return cls._STATUS_MAP.get(str(raw_status or "").strip().lower(), "FINISHED")

    @classmethod
    def _normalize_source(cls, source: Any) -> str:
        return cls._SOURCE_MAP.get(str(source or "").strip().lower(), "")

    @staticmethod
    def _normalize_duration_minutes(raw_duration: Any) -> int:
        if isinstance(raw_duration, int):
            return raw_duration
        if not isinstance(raw_duration, str):
            return 24

        hours = re.search(r"(\d+)\s*hr", raw_duration, flags=re.IGNORECASE)
        minutes = re.search(r"(\d+)\s*min", raw_duration, flags=re.IGNORECASE)
        seconds = re.search(r"(\d+)\s*sec", raw_duration, flags=re.IGNORECASE)

        total = 0
        if hours:
            total += int(hours.group(1)) * 60
        if minutes:
            total += int(minutes.group(1))
        if seconds and not total:
            total = max(1, round(int(seconds.group(1)) / 60))
        return total or 24

    @staticmethod
    def _normalize_jikan_date(payload: dict[str, Any] | None) -> dict[str, int] | None:
        if not isinstance(payload, dict):
            return None
        year = payload.get("year")
        if not year:
            return None
        return {
            "year": int(year),
            "month": int(payload.get("month") or 1),
            "day": int(payload.get("day") or 1),
        }

    @staticmethod
    def _normalize_cover_image(images: dict[str, Any] | None) -> dict[str, str]:
        images = images or {}
        webp = images.get("webp") or {}
        jpg = images.get("jpg") or {}
        return {
            "large": webp.get("large_image_url")
            or jpg.get("large_image_url")
            or webp.get("image_url")
            or jpg.get("image_url")
            or "",
            "extraLarge": webp.get("large_image_url")
            or jpg.get("large_image_url")
            or webp.get("image_url")
            or jpg.get("image_url")
            or "",
        }

    @staticmethod
    def _normalize_trailer(trailer: dict[str, Any] | None) -> dict[str, str] | None:
        trailer = trailer or {}
        youtube_id = trailer.get("youtube_id")
        if not youtube_id:
            return None
        return {"id": youtube_id, "site": "youtube"}

    @staticmethod
    def _normalize_rankings(item: dict[str, Any]) -> list[dict[str, Any]]:
        rankings: list[dict[str, Any]] = []
        if item.get("rank") is not None:
            rankings.append(
                {
                    "rank": item["rank"],
                    "type": "RATED",
                    "allTime": True,
                    "context": "top_rated",
                }
            )
        if item.get("popularity") is not None:
            rankings.append(
                {
                    "rank": item["popularity"],
                    "type": "POPULAR",
                    "allTime": True,
                    "context": "most_popular",
                }
            )
        return rankings

    @staticmethod
    def _normalize_name_list(items: list[dict[str, Any]] | None) -> list[str]:
        names: list[str] = []
        seen: set[str] = set()
        for item in items or []:
            name = (item or {}).get("name")
            if not isinstance(name, str):
                continue
            normalized = name.strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                names.append(normalized)
        return names

    def _normalize_tags(self, item: dict[str, Any]) -> list[str]:
        raw_tags = (
            self._normalize_name_list(item.get("themes"))
            + self._normalize_name_list(item.get("demographics"))
            + self._normalize_name_list(item.get("explicit_genres"))
        )
        normalized_tags: list[str] = []
        seen: set[str] = set()
        for entry in raw_tags:
            clean_name = " ".join(str(entry).split()).strip().lower()
            if not clean_name or clean_name in seen:
                continue
            seen.add(clean_name)
            normalized_tags.append(clean_name)
        return normalized_tags

    def _normalize_external_links(
        self,
        external_items: list[dict[str, Any]] | None,
        streaming_items: list[dict[str, Any]] | None,
        canonical_url: str | None,
    ) -> list[dict[str, str]]:
        links: list[dict[str, str]] = []
        seen: set[str] = set()

        def add(site: str, url: str):
            clean_site = (site or "").strip()
            clean_url = (url or "").strip()
            if not clean_site or not clean_url or clean_url in seen:
                return
            seen.add(clean_url)
            links.append({"site": clean_site, "url": clean_url, "icon": ""})

        for item in external_items or []:
            add((item or {}).get("name", ""), (item or {}).get("url", ""))
        for item in streaming_items or []:
            add((item or {}).get("name", ""), (item or {}).get("url", ""))
        if canonical_url:
            add("MyAnimeList", canonical_url)
        return links

    def _normalize_relations(self, relations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        edges: list[dict[str, Any]] = []

        for relation in relations:
            relation_type = self._RELATION_TYPE_MAP.get(
                str((relation or {}).get("relation") or "").strip().lower(),
                "OTHER",
            )
            for entry in (relation or {}).get("entry") or []:
                if not isinstance(entry, dict):
                    continue
                mal_id = self._coerce_positive_int(entry.get("mal_id"))
                media_type = str(entry.get("type") or "").upper()
                edges.append(
                    {
                        "relationType": relation_type,
                        "node": {
                            "id": None,
                            "idMal": mal_id,
                            "title": {
                                "romaji": (entry.get("name") or "").strip(),
                                "english": (entry.get("name") or "").strip(),
                                "native": "",
                            },
                            "type": media_type,
                            "format": None,
                            "status": None,
                            "coverImage": {"large": ""},
                        },
                    }
                )

        return edges

    def _normalize_characters(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        edges: list[dict[str, Any]] = []

        for item in items:
            character = (item or {}).get("character") or {}
            role = str((item or {}).get("role") or "").upper() or "SUPPORTING"
            voice_actors = [
                self._normalize_voice_actor(voice_actor)
                for voice_actor in (item or {}).get("voice_actors") or []
                if str((voice_actor or {}).get("language") or "").lower() == "japanese"
            ]
            voice_actors = [voice_actor for voice_actor in voice_actors if voice_actor]

            edges.append(
                {
                    "role": role,
                    "node": {
                        "id": self._character_sync_id(character.get("mal_id")),
                        "name": {
                            "full": (character.get("name") or "").strip(),
                            "native": (character.get("name_kanji") or "").strip(),
                        },
                        "image": self._normalize_person_image(character.get("images")),
                        "description": character.get("about") or "",
                    },
                    "voiceActors": voice_actors,
                }
            )

        return edges

    def _normalize_voice_actor(self, voice_actor: dict[str, Any]) -> dict[str, Any] | None:
        person = (voice_actor or {}).get("person") or {}
        if not person:
            return None

        return {
            "id": self._staff_sync_id(person.get("mal_id")),
            "name": {
                "full": (person.get("name") or "").strip(),
                "native": "",
            },
            "image": self._normalize_person_image(person.get("images")),
            "description": person.get("about") or "",
        }

    def _normalize_staff(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        edges: list[dict[str, Any]] = []

        for item in items:
            person = (item or {}).get("person") or {}
            positions = (item or {}).get("positions") or []
            if not positions:
                positions = ["Staff"]

            for position in positions:
                edges.append(
                    {
                        "role": position,
                        "node": {
                            "id": self._staff_sync_id(person.get("mal_id")),
                            "name": {
                                "full": (person.get("name") or "").strip(),
                                "native": "",
                            },
                            "image": self._normalize_person_image(person.get("images")),
                            "description": person.get("about") or "",
                        },
                    }
                )

        return edges

    @staticmethod
    def _normalize_person_image(images: dict[str, Any] | None) -> dict[str, str]:
        images = images or {}
        jpg = images.get("jpg") or {}
        webp = images.get("webp") or {}
        return {
            "large": jpg.get("image_url") or webp.get("image_url") or "",
        }

    def _normalize_statistics(self, payload: dict | None) -> dict[str, Any]:
        data = (payload or {}).get("data") or {}
        distribution: list[dict[str, Any]] = []

        mappings = {
            "CURRENT": data.get("watching"),
            "COMPLETED": data.get("completed"),
            "PAUSED": data.get("on_hold"),
            "DROPPED": data.get("dropped"),
            "PLANNING": data.get("plan_to_watch"),
        }
        for status, amount in mappings.items():
            if amount is not None:
                distribution.append({"status": status, "amount": amount})
        return {"statusDistribution": distribution}

    def _normalize_synonyms(self, item: dict[str, Any]) -> list[str]:
        values = []
        seen: set[str] = set()

        for candidate in item.get("title_synonyms") or []:
            if not isinstance(candidate, str):
                continue
            normalized = candidate.strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                values.append(normalized)

        for title_entry in item.get("titles") or []:
            title = (title_entry or {}).get("title")
            if not isinstance(title, str):
                continue
            normalized = title.strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                values.append(normalized)

        return values

    @sync_to_async
    def _handle_relationships_async(self, anime, item):
        genres = item.get("genres") or []
        for genre_name in genres:
            genre, _ = Genre.objects.get_or_create(
                name=genre_name, defaults={"slug": slugify(genre_name)}
            )
            anime.genres.add(genre)

        studio_names = [
            node.get("name") for node in (item.get("studios") or {}).get("nodes") or []
        ]
        studio_names = [name for name in studio_names if name]
        if studio_names:
            anime.set_studios(
                Studio.objects.get_or_create(name=name)[0] for name in studio_names
            )

        sync_relations_from_media(anime, item)

        characters_data = (item.get("characterPreview") or {}).get("edges") or []
        for edge in characters_data:
            node = edge["node"]
            role = edge["role"]

            char_name = node["name"].get("full")
            char_native = node["name"].get("native")
            char_desc = node.get("description") or ""
            char_img = node.get("image", {}).get("large")
            char_sync_id = node.get("id")

            if char_sync_id:
                character, _ = Character.objects.update_or_create(
                    anilist_id=char_sync_id,
                    defaults={
                        "name": char_name,
                        "name_native": char_native or "",
                        "description": char_desc,
                        "image_url": char_img,
                    },
                )
            else:
                character, _ = Character.objects.update_or_create(
                    name=char_name,
                    defaults={
                        "name_native": char_native or "",
                        "description": char_desc,
                        "image_url": char_img,
                    },
                )

            voice_actors = edge.get("voiceActors") or []
            voice_actor = None
            if voice_actors:
                va_node = voice_actors[0]
                va_name = va_node["name"].get("full")
                va_native = va_node["name"].get("native")
                va_img = va_node.get("image", {}).get("large")
                va_desc = va_node.get("description") or ""
                va_sync_id = va_node.get("id")

                if va_sync_id:
                    voice_actor, _ = Staff.objects.update_or_create(
                        anilist_id=va_sync_id,
                        defaults={
                            "name": va_name,
                            "name_native": va_native or "",
                            "image_url": va_img,
                            "description": va_desc,
                        },
                    )
                else:
                    voice_actor, _ = Staff.objects.update_or_create(
                        name=va_name,
                        defaults={
                            "name_native": va_native or "",
                            "image_url": va_img,
                            "description": va_desc,
                        },
                    )

            role_map = {
                "MAIN": AnimeCharacter.Role.MAIN,
                "SUPPORTING": AnimeCharacter.Role.SUPPORTING,
                "BACKGROUND": AnimeCharacter.Role.BACKGROUND,
            }

            AnimeCharacter.objects.update_or_create(
                anime=anime,
                character=character,
                voice_actor=voice_actor,
                defaults={"role": role_map.get(role, AnimeCharacter.Role.SUPPORTING)},
            )

        staff_data = (item.get("staffPreview") or {}).get("edges") or []
        for edge in staff_data:
            node = edge["node"]
            role = edge["role"]

            staff_name = node["name"].get("full")
            staff_native = node["name"].get("native")
            staff_img = node.get("image", {}).get("large")
            staff_desc = node.get("description") or ""
            staff_sync_id = node.get("id")

            if staff_sync_id:
                staff_member, _ = Staff.objects.update_or_create(
                    anilist_id=staff_sync_id,
                    defaults={
                        "name": staff_name,
                        "name_native": staff_native or "",
                        "image_url": staff_img,
                        "description": staff_desc,
                    },
                )
            else:
                staff_member, _ = Staff.objects.update_or_create(
                    name=staff_name,
                    defaults={
                        "name_native": staff_native or "",
                        "image_url": staff_img,
                        "description": staff_desc,
                    },
                )

            AnimeStaff.objects.update_or_create(
                anime=anime,
                staff=staff_member,
                role=role,
            )

        self._process_theme_songs(anime, item)

    def _process_theme_songs(self, anime, item):
        from ..models import ThemeSong

        openings = item.get("openings") or []
        endings = item.get("endings") or []

        if not openings and not endings:
            return

        ThemeSong.objects.filter(anime=anime).delete()

        for idx, opening_text in enumerate(openings, 1):
            if opening_text:
                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.OPENING,
                    track_number=idx,
                    title=opening_text,
                    artist="",
                    episodes="",
                    anilist_raw=opening_text[:500],
                )

        for idx, ending_text in enumerate(endings, 1):
            if ending_text:
                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.ENDING,
                    track_number=idx,
                    title=ending_text,
                    artist="",
                    episodes="",
                    anilist_raw=ending_text[:500],
                )

    async def _download_and_save_images(self, anime, item):
        try:
            cover_image = item.get("coverImage") or {}
            if not isinstance(cover_image, dict):
                cover_image = {}

            cover_url = self.normalize_external_image_url(
                cover_image.get("extraLarge") or cover_image.get("large")
            )
            banner_url = self.normalize_external_image_url(item.get("bannerImage"))
            existing_cover_url = anime.cover_image_external_url or ""
            existing_banner_url = anime.banner_image_external_url or ""
            cover_url_changed = bool(cover_url and cover_url != existing_cover_url)
            banner_url_changed = bool(banner_url and banner_url != existing_banner_url)
            force_replace = cover_url_changed or banner_url_changed

            has_cover = await sync_to_async(lambda: bool(anime.cover_image))()
            has_banner = await sync_to_async(lambda: bool(anime.banner_image))()
            mal_id = item.get("idMal")

            if (
                (cover_url and not has_cover)
                or (banner_url and not has_banner)
                or (not has_banner and mal_id)
                or force_replace
            ):
                from ..tasks.images import _queue_image_fetch

                logger.info(f"Queueing background image fetch for {anime.title}")
                await sync_to_async(_queue_image_fetch)(
                    anime_id=anime.id,
                    cover_url=cover_url,
                    banner_url=banner_url,
                    mal_id=mal_id,
                    force_replace=force_replace,
                )

            has_trailer = await sync_to_async(lambda: bool(anime.trailer_url))()
            if not has_trailer:
                trailer = item.get("trailer")
                if trailer:
                    trailer_id = trailer.get("id")
                    trailer_site = trailer.get("site")
                    if trailer_id and trailer_site and trailer_site.lower() == "youtube":
                        await self._save_trailer_url(
                            anime,
                            f"https://www.youtube.com/watch?v={trailer_id}",
                        )

        except Exception as exc:
            logger.error(f"Error downloading media for {anime.title}: {exc}")

    @sync_to_async
    def _save_trailer_url(self, anime, trailer_url):
        anime.trailer_url = trailer_url
        anime.save()

    def save_anime_to_db(self, item: dict) -> Anime:
        return async_to_sync(self._save_anime_to_db_async)(item)

    async def _save_anime_to_db_async(self, item: dict) -> Anime:
        anilist_id = item.get("id")
        mal_id = item.get("idMal")
        title = item.get("title", {}).get("english") or item.get("title", {}).get("romaji")
        title_native = item.get("title", {}).get("native")
        provider_ids = item.get("providerIds") or {}

        if not title:
            raise ValueError("Anime must have a title")

        base_slug = slugify(title)
        existing = await sync_to_async(self._lookup_existing_anime)(
            anilist_id=anilist_id,
            mal_id=mal_id,
            slug=base_slug,
            title=title,
            provider_ids=provider_ids,
        )
        if existing:
            logger.info(
                "Found existing anime for Jikan anilist_id=%s mal_id=%s: %s",
                anilist_id,
                mal_id,
                existing.title,
            )
            await self._update_anime_async(existing, item, title, title_native, existing.slug)
            return existing

        final_slug = await sync_to_async(Anime.available_slug)(
            base_slug, year=item.get("seasonYear")
        )

        anime_data = with_creation_defaults(
            self._prepare_anime_data(item, title, title_native, final_slug)
        )
        anime_data["anilist_id"] = anilist_id
        anime_data["mal_id"] = mal_id
        try:
            anime = await sync_to_async(Anime.objects.create)(**anime_data)
            logger.info(f"Created new anime: {title} with slug {final_slug}")
        except IntegrityError as exc:
            recovered = await sync_to_async(self._lookup_existing_anime)(
                anilist_id=anilist_id,
                mal_id=mal_id,
                slug=final_slug,
                title=title,
                provider_ids=provider_ids,
            )
            if recovered:
                logger.warning(
                    f"Recovered from create integrity conflict for '{title}' (MAL ID: {mal_id}): {exc}"
                )
                await self._update_anime_async(recovered, item, title, title_native, recovered.slug)
                return recovered
            raise

        await self._handle_relationships_async(anime, item)
        await self._download_and_save_images(anime, item)
        return anime

    async def _update_anime_async(
        self, anime: Anime, item: dict, title: str, title_native: str, slug: str
    ):
        anime_data = self._prepare_anime_data(item, title, title_native, slug)
        anime_data["anilist_id"] = item.get("id") or anime.anilist_id
        anime_data["mal_id"] = item.get("idMal") or anime.mal_id

        if not item.get("nextAiringEpisode"):
            # Jikan often has no schedule even for airing shows; unlike
            # AniList, its silence does not mean the show stopped airing.
            anime_data.pop("next_airing_episode", None)
            anime_data.pop("next_airing_date", None)

        await self._update_anime(anime, anime_data)
        await self._handle_relationships_async(anime, item)
        await self._download_and_save_images(anime, item)

    async def get_streaming_episodes_for_anime(
        self,
        *,
        anilist_id: int | None = None,
        mal_id: int | None = None,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> dict | None:
        resolved_mal_id = self._coerce_positive_int(mal_id)
        if resolved_mal_id is None and anilist_id is not None:
            resolved_mal_id = await self._mal_id_for_anilist_id(anilist_id)

        if resolved_mal_id is None:
            self._set_last_error("invalid_variable", "missing_mal_id")
            return None

        payload = await self._get(
            f"/anime/{resolved_mal_id}/videos/episodes",
            endpoint="anime_videos_episodes",
            **self._query_options_for_budget(request_budget),
        )
        items = payload.get("data") or []
        if not isinstance(items, list):
            items = []

        streaming_episodes = []
        for item in items:
            if not isinstance(item, dict):
                continue
            image_data = ((item.get("images") or {}).get("jpg") or {}).get("image_url")
            streaming_episodes.append(
                {
                    "title": item.get("episode") or item.get("title") or "",
                    "thumbnail": self.normalize_external_image_url(image_data),
                    "url": item.get("url") or "",
                    "site": "MyAnimeList",
                }
            )

        return {
            "id": anilist_id,
            "idMal": resolved_mal_id,
            "streamingEpisodes": streaming_episodes,
        }

    async def get_recommendations_for_anime(
        self,
        mal_id: int,
        *,
        limit: int = 8,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> list[dict]:
        resolved_mal_id = self._coerce_positive_int(mal_id)
        if not resolved_mal_id:
            self._set_last_error("invalid_variable", "invalid_mal_id")
            return []

        payload = await self._get(
            f"/anime/{resolved_mal_id}/recommendations",
            endpoint="anime_recommendations",
            **self._query_options_for_budget(request_budget),
        )
        items = payload.get("data") or []
        if not isinstance(items, list):
            return []

        recommendations: list[dict] = []
        seen_ids: set[int] = set()

        for item in items:
            entry = (item or {}).get("entry") or {}
            recommendation_mal_id = self._coerce_positive_int(entry.get("mal_id"))
            if not recommendation_mal_id or recommendation_mal_id in seen_ids:
                continue

            seen_ids.add(recommendation_mal_id)
            image_data = entry.get("images")
            recommendations.append(
                {
                    "mal_id": recommendation_mal_id,
                    "title": entry.get("title") or "",
                    "title_jp": "",
                    "format": None,
                    "status": None,
                    "episode_count": 0,
                    "member_count": 0,
                    "rating": None,
                    "cover_image_external_url": self.normalize_external_image_url(
                        self._normalize_cover_image(image_data).get("extraLarge")
                    ),
                    "recommendation_rating": (item or {}).get("votes"),
                }
            )
            if len(recommendations) >= limit:
                break

        return recommendations

    async def _estimate_next_airing_episode(
        self,
        mal_id: int,
        *,
        anime_data: dict[str, Any] | None = None,
    ) -> dict[str, int] | None:
        if anime_data is None:
            anime_payload = await self._get(f"/anime/{mal_id}", endpoint="anime_core")
            anime_data = anime_payload.get("data")
        if not isinstance(anime_data, dict):
            return None
        if self._normalize_status(anime_data.get("status")) != "RELEASING":
            return None

        broadcast = anime_data.get("broadcast") or {}
        next_airing_at = self._next_broadcast_timestamp(
            day_name=broadcast.get("day"),
            time_text=broadcast.get("time"),
            timezone_name=broadcast.get("timezone"),
        )
        if not next_airing_at:
            return None

        first_page = await self._get(
            f"/anime/{mal_id}/episodes",
            params={"page": 1},
            endpoint="anime_episodes",
        )
        pagination = first_page.get("pagination") or {}
        last_visible_page = self._coerce_positive_int(pagination.get("last_visible_page")) or 1
        last_page = first_page
        if last_visible_page > 1:
            last_page = await self._get(
                f"/anime/{mal_id}/episodes",
                params={"page": last_visible_page},
                endpoint="anime_episodes",
            )

        latest_episode = self._latest_episode_number((last_page or {}).get("data") or [])
        if latest_episode is None:
            return {"episode": 1, "airingAt": next_airing_at}

        total_episodes = self._coerce_positive_int(anime_data.get("episodes"))
        next_episode = latest_episode + 1
        if total_episodes and next_episode > total_episodes:
            return None

        return {"episode": next_episode, "airingAt": next_airing_at}

    def _next_broadcast_timestamp(
        self,
        *,
        day_name: str | None,
        time_text: str | None,
        timezone_name: str | None,
    ) -> int | None:
        weekday = self._WEEKDAY_MAP.get(str(day_name or "").strip().lower())
        if weekday is None:
            return None

        try:
            hour_text, minute_text = (time_text or "00:00").split(":", 1)
            hour = int(hour_text)
            minute = int(minute_text)
        except (TypeError, ValueError):
            hour = 0
            minute = 0

        try:
            tz = ZoneInfo(str(timezone_name or "UTC"))
        except ZoneInfoNotFoundError:
            tz = ZoneInfo("UTC")

        now = datetime.now(tz)
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        days_ahead = (weekday - candidate.weekday()) % 7
        if days_ahead == 0 and candidate <= now:
            days_ahead = 7
        candidate += timedelta(days=days_ahead)
        return int(candidate.astimezone(UTC).timestamp())

    def _latest_episode_number(self, items: list[dict[str, Any]]) -> int | None:
        max_episode = None
        for item in items:
            number = self._coerce_positive_int((item or {}).get("mal_id"))
            if number is None:
                continue
            max_episode = max(max_episode or number, number)
        return max_episode


async def fetch_themes_from_jikan(
    http_client: httpx.AsyncClient,
    mal_id: int,
    rate_limiter: JikanRateLimiter,
    max_retries: int = 3,
) -> dict | None:
    result = await fetch_themes_from_jikan_with_reason(
        http_client=http_client,
        mal_id=mal_id,
        rate_limiter=rate_limiter,
        max_retries=max_retries,
    )
    if result.success:
        return result.themes or {"openings": [], "endings": []}
    return None


async def fetch_themes_from_jikan_with_reason(
    http_client: httpx.AsyncClient,
    mal_id: int,
    rate_limiter: JikanRateLimiter,
    max_retries: int = 3,
) -> JikanThemesFetchResult:
    from .metrics import API_CALL_COUNT, API_CALL_DURATION

    url = f"{get_jikan_base_url()}/anime/{mal_id}/themes"
    transient_status_codes = {500, 502, 503, 504}

    for attempt in range(max_retries + 1):
        _start = time.time()
        _status = "success"
        try:
            response = await http_client.get(url)

            if response.status_code == 429:
                _status = "rate_limited"
                wait_time = retry_after_seconds(response.headers.get("Retry-After"))
                if wait_time is None:
                    wait_time = min(2**attempt + random.uniform(0, 2), 60)
                rate_limiter.record_429(cooldown_hint=wait_time)

                if attempt < max_retries:
                    logger.warning(
                        "Jikan 429 for MAL ID %s, waiting %.1fs (attempt %s/%s)",
                        mal_id,
                        wait_time,
                        attempt + 1,
                        max_retries,
                    )
                    await asyncio.sleep(wait_time)
                    continue

                return JikanThemesFetchResult(
                    success=False,
                    reason_code="rate_limited",
                    message="http_429",
                    transient=True,
                )

            if response.status_code in transient_status_codes:
                _status = "failure"
                rate_limiter.record_error()
                if attempt < max_retries:
                    wait_time = min(2**attempt + random.uniform(0, 1), 15)
                    logger.warning(
                        "Jikan transient error %s for MAL ID %s, retrying in %.1fs (attempt %s/%s)",
                        response.status_code,
                        mal_id,
                        wait_time,
                        attempt + 1,
                        max_retries,
                    )
                    await asyncio.sleep(wait_time)
                    continue

                return JikanThemesFetchResult(
                    success=False,
                    reason_code="transport_error",
                    message=f"http_{response.status_code}",
                    transient=True,
                )

            if 400 <= response.status_code < 500:
                _status = "not_found" if response.status_code == 404 else "client_error"
                if response.status_code == 404:
                    return JikanThemesFetchResult(
                        success=False,
                        reason_code="not_found",
                        message="http_404",
                        transient=False,
                    )
                code = "invalid_variable" if response.status_code in {400, 422} else "transport_error"
                return JikanThemesFetchResult(
                    success=False,
                    reason_code=code,
                    message=f"http_{response.status_code}",
                    transient=False,
                )

            response.raise_for_status()
            data = response.json().get("data", {})
            rate_limiter.record_success()
            return JikanThemesFetchResult(
                success=True,
                themes={
                    "openings": data.get("openings", []),
                    "endings": data.get("endings", []),
                },
            )

        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            _status = "failure"
            rate_limiter.record_error()
            if attempt < max_retries:
                wait_time = min(2**attempt + random.uniform(0, 1), 15)
                logger.warning(
                    "Jikan network timeout for MAL ID %s: %s. Retrying in %.1fs (attempt %s/%s)",
                    mal_id,
                    exc,
                    wait_time,
                    attempt + 1,
                    max_retries,
                )
                await asyncio.sleep(wait_time)
                continue

            return JikanThemesFetchResult(
                success=False,
                reason_code="transport_error",
                message=str(exc),
                transient=True,
            )
        except httpx.HTTPError as exc:
            _status = "failure"
            rate_limiter.record_error()
            if attempt < max_retries:
                wait_time = min(2**attempt + random.uniform(0, 1), 15)
                logger.warning(
                    "Jikan HTTP error for MAL ID %s: %s. Retrying in %.1fs (attempt %s/%s)",
                    mal_id,
                    exc,
                    wait_time,
                    attempt + 1,
                    max_retries,
                )
                await asyncio.sleep(wait_time)
                continue

            return JikanThemesFetchResult(
                success=False,
                reason_code="transport_error",
                message=str(exc),
                transient=True,
            )
        except Exception as exc:
            _status = "failure"
            logger.error("Unexpected error fetching themes for MAL ID %s: %s", mal_id, exc)
            return JikanThemesFetchResult(
                success=False,
                reason_code="transport_error",
                message=str(exc),
                transient=True,
            )
        finally:
            try:
                API_CALL_DURATION.labels(
                    service="jikan",
                    endpoint="themes",
                    status=_status,
                ).observe(time.time() - _start)
                API_CALL_COUNT.labels(service="jikan", endpoint="themes", status=_status).inc()
            except Exception:
                pass

    return JikanThemesFetchResult(
        success=False,
        reason_code="transport_error",
        message="retries_exhausted",
        transient=True,
    )
