import asyncio
import re
from typing import Literal
from urllib.parse import quote_plus, urlparse

import httpx
from asgiref.sync import async_to_sync
from django.core.cache import cache

from ...shared.logger import logger
from ...shared.retry import backoff
from ..models import Anime
from .jikan import JIKAN_BASE_URL, JikanRateLimiter, JikanService


class AnimeWatchEpisodeService:
    """Fetch and cache merged episode watch data for an anime detail page."""

    CACHE_VERSION = "v1"
    CACHE_TTL = 60 * 60 * 6
    EMPTY_CACHE_TTL = 60 * 30
    REQUEST_BUDGET_DEFAULT = "default"
    REQUEST_BUDGET_INTERACTIVE = "interactive"
    _STREAMING_EPISODE_PATTERNS = (
        re.compile(r"(?i)\bepisode\s+(\d{1,4})\b"),
        re.compile(r"(?i)\bep\.?\s*(\d{1,4})\b"),
        re.compile(r"^(\d{1,4})(?:\b|\s*[:\-])"),
    )
    _JIKAN_EPISODE_URL_PATTERN = re.compile(r"/episode/(\d+)")

    def get_for_anime(
        self,
        anime: Anime,
        *,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> list[dict]:
        cache_key = self._cache_key(anime)
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        episodes = async_to_sync(self._build_for_anime)(anime, request_budget=request_budget)
        cache.set(cache_key, episodes, timeout=self.CACHE_TTL if episodes else self.EMPTY_CACHE_TTL)
        return episodes

    def invalidate_for_anime(self, anime: Anime) -> None:
        cache.delete(self._cache_key(anime))

    @classmethod
    def invalidate_for_anime_version(cls, anime_id: int, updated_at) -> None:
        cache.delete(cls._cache_key_for_identity(anime_id, updated_at))

    @classmethod
    def _cache_key(cls, anime: Anime) -> str:
        return cls._cache_key_for_identity(anime.id, getattr(anime, "updated_at", None))

    @classmethod
    def _cache_key_for_identity(cls, anime_id: int, updated_at) -> str:
        updated_at_token = int(updated_at.timestamp()) if getattr(updated_at, "timestamp", None) else 0
        return f"anime_watch_episodes:{cls.CACHE_VERSION}:{anime_id}:{updated_at_token}"

    async def _build_for_anime(
        self,
        anime: Anime,
        *,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> list[dict]:
        episode_media: dict = {}
        mal_id = anime.mal_id

        if anime.anilist_id or mal_id:
            service = JikanService(enable_caching=True, enable_rate_limiting=True)
            try:
                episode_media = await service.get_streaming_episodes_for_anime(
                    anilist_id=anime.anilist_id,
                    mal_id=mal_id,
                    request_budget=request_budget,
                ) or {}
            except Exception as exc:
                logger.warning(
                    "Failed to fetch episode streaming metadata for %s: %s",
                    anime.slug,
                    exc,
                )
            finally:
                await service.close()

        mal_id = mal_id or self._coerce_positive_int(episode_media.get("idMal"))
        if not mal_id:
            return self._build_fallback_episodes(anime)

        jikan_episodes = await self._fetch_jikan_episodes(mal_id, request_budget=request_budget)
        if not jikan_episodes:
            return self._build_fallback_episodes(anime)

        crunchyroll_index = self._index_streaming_episodes(episode_media.get("streamingEpisodes") or [])
        return [
            self._merge_episode(anime, episode, crunchyroll_index.get(episode["number"]))
            for episode in jikan_episodes
        ]

    def _build_fallback_episodes(self, anime: Anime) -> list[dict]:
        episode_count = int(anime.episode_count or 0)
        if episode_count <= 0:
            return []

        return [
            {
                "number": episode_number,
                "title": f"Episode {episode_number}",
                "aired": "",
                "thumbnail": "",
                "crunchyroll_url": self._build_crunchyroll_search_url(anime.title, episode_number),
                "has_real_crunchyroll_url": False,
            }
            for episode_number in range(1, episode_count + 1)
        ]

    async def _fetch_jikan_episodes(
        self,
        mal_id: int,
        *,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> list[dict]:
        limiter = JikanRateLimiter(base_delay=0.4)
        url = f"{JIKAN_BASE_URL}/anime/{mal_id}/episodes"
        episodes: list[dict] = []
        page = 1
        max_retries = 0 if request_budget == self.REQUEST_BUDGET_INTERACTIVE else 3
        request_timeout = 8.0 if request_budget == self.REQUEST_BUDGET_INTERACTIVE else 15.0

        async with httpx.AsyncClient(timeout=request_timeout) as client:
            while True:
                payload = await self._get_jikan_page(
                    client,
                    url,
                    page,
                    limiter,
                    max_retries=max_retries,
                )
                if not payload:
                    break

                page_items = payload.get("data") or []
                if not isinstance(page_items, list) or not page_items:
                    break

                for offset, item in enumerate(page_items, start=1):
                    if not isinstance(item, dict):
                        continue
                    normalized = self._normalize_jikan_episode(
                        item,
                        fallback_number=((page - 1) * len(page_items)) + offset,
                    )
                    if normalized:
                        episodes.append(normalized)

                pagination = payload.get("pagination") or {}
                if not pagination.get("has_next_page"):
                    break
                page += 1

        return episodes

    async def _get_jikan_page(
        self,
        client: httpx.AsyncClient,
        url: str,
        page: int,
        limiter: JikanRateLimiter,
        max_retries: int = 3,
    ) -> dict | None:
        for attempt in range(max_retries + 1):
            await limiter.acquire()
            try:
                response = await client.get(url, params={"page": page})
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                limiter.record_error()
                if attempt < max_retries:
                    await backoff(min(2**attempt, 10))
                    continue
                logger.warning("Jikan episode fetch failed for page %s: %s", page, exc)
                return None
            except httpx.HTTPError as exc:
                limiter.record_error()
                logger.warning("Jikan episode fetch error for page %s: %s", page, exc)
                return None

            if response.status_code == 404:
                return None

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                wait_time = float(retry_after) if retry_after else min(2**attempt + 1, 60)
                limiter.record_429(cooldown_hint=wait_time)
                if attempt < max_retries:
                    await asyncio.sleep(wait_time)
                    continue
                return None

            if 500 <= response.status_code < 600:
                limiter.record_error()
                if attempt < max_retries:
                    await backoff(min(2**attempt, 10))
                    continue
                return None

            if 400 <= response.status_code < 500:
                logger.warning(
                    "Jikan episode fetch returned non-retryable status %s for page %s",
                    response.status_code,
                    page,
                )
                return None

            response.raise_for_status()
            limiter.record_success()
            return response.json()

        return None

    def _normalize_jikan_episode(self, item: dict, *, fallback_number: int) -> dict | None:
        number = (
            self._coerce_positive_int(item.get("mal_id"))
            or self._coerce_positive_int(item.get("episode"))
            or self._episode_number_from_jikan_url(item.get("url"))
            or fallback_number
        )
        if not number:
            return None

        title = (
            (item.get("title") or "").strip()
            or (item.get("title_romanji") or "").strip()
            or (item.get("title_japanese") or "").strip()
            or f"Episode {number}"
        )
        aired = self._normalize_aired_date(item.get("aired"))

        return {
            "number": number,
            "title": title,
            "aired": aired,
        }

    def _index_streaming_episodes(self, episodes: list[dict]) -> dict[int, dict]:
        index: dict[int, dict] = {}

        for item in episodes:
            if not isinstance(item, dict):
                continue

            site = str(item.get("site") or "")
            url = str(item.get("url") or "").strip()
            if not self._is_crunchyroll_stream(site, url):
                continue

            episode_number = self._parse_streaming_episode_number(item.get("title"))
            if not episode_number or episode_number in index:
                continue

            index[episode_number] = {
                "title": str(item.get("title") or "").strip(),
                "thumbnail": JikanService.normalize_external_image_url(item.get("thumbnail")),
                "crunchyroll_url": url,
            }

        return index

    def _merge_episode(self, anime: Anime, jikan_episode: dict, streaming_episode: dict | None) -> dict:
        number = jikan_episode["number"]
        crunchyroll_url = (
            streaming_episode.get("crunchyroll_url") if streaming_episode else ""
        ) or self._build_crunchyroll_search_url(anime.title, number)

        return {
            "number": number,
            "title": jikan_episode.get("title") or f"Episode {number}",
            "aired": jikan_episode.get("aired"),
            "thumbnail": (streaming_episode or {}).get("thumbnail", ""),
            "crunchyroll_url": crunchyroll_url,
            "has_real_crunchyroll_url": bool((streaming_episode or {}).get("crunchyroll_url")),
        }

    @classmethod
    def _build_crunchyroll_search_url(cls, anime_title: str, episode_number: int) -> str:
        query = quote_plus(f"{anime_title} episode {episode_number}")
        return f"https://www.crunchyroll.com/search?q={query}"

    @classmethod
    def _parse_streaming_episode_number(cls, title: str | None) -> int | None:
        candidate = str(title or "").strip()
        if not candidate:
            return None

        for pattern in cls._STREAMING_EPISODE_PATTERNS:
            match = pattern.search(candidate)
            if match:
                return cls._coerce_positive_int(match.group(1))
        return None

    @classmethod
    def _episode_number_from_jikan_url(cls, url: str | None) -> int | None:
        candidate = str(url or "").strip()
        if not candidate:
            return None

        match = cls._JIKAN_EPISODE_URL_PATTERN.search(candidate)
        if not match:
            return None
        return cls._coerce_positive_int(match.group(1))

    @staticmethod
    def _normalize_aired_date(value: str | None) -> str | None:
        candidate = str(value or "").strip()
        if not candidate:
            return None
        return candidate[:10]

    @staticmethod
    def _coerce_positive_int(value) -> int | None:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    @staticmethod
    def _is_crunchyroll_stream(site: str, url: str) -> bool:
        site_lower = site.lower()
        if "crunchyroll" in site_lower:
            return True

        hostname = (urlparse(url).hostname or "").lower()
        return "crunchyroll.com" in hostname
