import re
from datetime import datetime
from typing import Literal
from urllib.parse import quote_plus, urlparse
from zoneinfo import ZoneInfo

from django.core.cache import cache

from ...shared.logger import logger
from ...shared.parsing import positive_int
from ..models import Anime
from .anilist import AniListService
from .providers.base import BROADCAST_TIMEZONE

BROADCAST_TZ = ZoneInfo(BROADCAST_TIMEZONE)


class AnimeWatchEpisodeService:
    """Fetch and cache an anime's episode list for its detail page.

    One AniList query gives the aired schedule (dates), the next-episode marker
    (how many are out) and the streaming links (titles, thumbnails, real
    Crunchyroll URLs); other episodes link to a Crunchyroll search.
    """

    CACHE_VERSION = "v2"
    CACHE_TTL = 60 * 60 * 6
    EMPTY_CACHE_TTL = 60 * 30
    REQUEST_BUDGET_DEFAULT: Literal["default"] = "default"
    REQUEST_BUDGET_INTERACTIVE: Literal["interactive"] = "interactive"
    _STREAMING_EPISODE_PATTERNS = (
        re.compile(r"(?i)\bepisode\s+(\d{1,4})\b"),
        re.compile(r"(?i)\bep\.?\s*(\d{1,4})\b"),
        re.compile(r"^(\d{1,4})(?:\b|\s*[:\-])"),
    )
    # "Episode 3 - The Title" -> "The Title"
    _EPISODE_TITLE_PREFIX = re.compile(
        r"^(?:episode|ep\.?)\s*\d{1,4}\s*(?:[-:\u2013\u2014]\s*)?", re.I
    )

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

        episodes = self._build_for_anime(anime, request_budget=request_budget)
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
        updated_at_token = (
            int(updated_at.timestamp()) if getattr(updated_at, "timestamp", None) else 0
        )
        return f"anime_watch_episodes:{cls.CACHE_VERSION}:{anime_id}:{updated_at_token}"

    def _build_for_anime(
        self,
        anime: Anime,
        *,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> list[dict]:
        if not (anime.anilist_id or anime.mal_id):
            return self._build_fallback_episodes(anime)

        service = AniListService(enable_caching=True, enable_rate_limiting=True)
        try:
            media = service.get_episode_schedule(
                anilist_id=anime.anilist_id,
                mal_id=anime.mal_id,
                request_budget=request_budget,
            )
        except Exception:
            logger.warning("Failed to fetch episode data for %s", anime.slug, exc_info=True)
            media = None
        finally:
            service.close()

        if not media:
            return self._build_fallback_episodes(anime)

        aired_at = self._aired_dates(media.get("airingSchedule") or [])
        streaming_index = self._index_streaming_episodes(media.get("streamingEpisodes") or [])
        episode_total = self._released_episode_count(media, aired_at, streaming_index)
        if episode_total <= 0:
            if self._nothing_aired_yet(media):
                return []
            # AniList knows the show but not its episodes: list the stored total.
            return self._build_fallback_episodes(anime)

        return [
            self._merge_episode(
                anime,
                {
                    "number": number,
                    "title": (streaming_index.get(number) or {}).get("episode_title")
                    or f"Episode {number}",
                    "aired": aired_at.get(number),
                },
                streaming_index.get(number),
            )
            for number in range(1, episode_total + 1)
        ]

    @staticmethod
    def _released_episode_count(media: dict, aired_at: dict, streaming_index: dict) -> int:
        """How many episodes are out: AniList's next-episode marker, else its totals."""
        next_airing = media.get("nextAiringEpisode") or {}
        next_episode = positive_int(next_airing.get("episode"))
        if next_episode:
            return next_episode - 1
        known = max([*aired_at, *streaming_index, 0])
        if media.get("status") == "FINISHED":
            return max(positive_int(media.get("episodes")) or 0, known)
        return known

    @staticmethod
    def _nothing_aired_yet(media: dict) -> bool:
        """AniList says no episode is out: not released yet, or episode 1 is next."""
        next_episode = positive_int((media.get("nextAiringEpisode") or {}).get("episode"))
        return media.get("status") == "NOT_YET_RELEASED" or next_episode == 1

    @staticmethod
    def _aired_dates(schedule: list[dict]) -> dict[int, str]:
        """Episode number -> broadcast date (YYYY-MM-DD, Japan time)."""
        dates: dict[int, str] = {}
        for node in schedule:
            number = positive_int(node.get("episode"))
            airing_at = node.get("airingAt")
            if not number or not isinstance(airing_at, int | float):
                continue
            dates[number] = datetime.fromtimestamp(airing_at, tz=BROADCAST_TZ).date().isoformat()
        return dates

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

            title = str(item.get("title") or "").strip()
            index[episode_number] = {
                "title": title,
                "episode_title": self._EPISODE_TITLE_PREFIX.sub("", title).strip(),
                "thumbnail": AniListService.normalize_external_image_url(item.get("thumbnail")),
                "crunchyroll_url": url,
            }

        return index

    def _merge_episode(self, anime: Anime, episode: dict, streaming_episode: dict | None) -> dict:
        number = episode["number"]
        crunchyroll_url = (
            streaming_episode.get("crunchyroll_url") if streaming_episode else ""
        ) or self._build_crunchyroll_search_url(anime.title, number)

        return {
            "number": number,
            "title": episode.get("title") or f"Episode {number}",
            "aired": episode.get("aired"),
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
                return positive_int(match.group(1))
        return None

    @staticmethod
    def _is_crunchyroll_stream(site: str, url: str) -> bool:
        site_lower = site.lower()
        if "crunchyroll" in site_lower:
            return True

        hostname = (urlparse(url).hostname or "").lower()
        return "crunchyroll.com" in hostname
