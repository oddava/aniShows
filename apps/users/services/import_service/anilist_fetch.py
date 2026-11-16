"""Every AniList request the list imports make, in one module (spec 3 P1-3 fallback).

The integrator's public ``AniListClient.run_query`` / ``get_media_by_ids`` are not on
``revamp/base`` yet, so this module uses its own httpx client and takes each request
slot from the shared ``AniListRateLimiter`` (background budget, so imports count
against the same per-IP minute counter as the catalog sync, and a 429 pauses every
worker). When the public methods land, only this file changes.

Schema checked live on 2026-11-16: ``MediaListCollection.lists.isCustomList``,
``MediaList.score(format: POINT_100)``, ``Page.mediaList(sort: UPDATED_TIME_DESC)``.
An unknown user answers 404 "User not found" (``Page.mediaList``: a 500), a private
list 404 "Private User".
"""

from __future__ import annotations

import random
import time
from typing import TYPE_CHECKING, Any

import httpx
from django.conf import settings

from ....animes.services.providers.anilist.client import (
    DEFAULT_ANILIST_API_URL,
    MEDIA_FIELDS,
    AniListClient,
)
from ....animes.services.rate_limiting import AniListRateLimiter
from ....shared.logger import logger
from ....shared.retry import retry_after_seconds

if TYPE_CHECKING:
    from collections.abc import Iterable

MAX_ATTEMPTS = 5
REQUEST_TIMEOUT_SECONDS = 30.0
MAX_BACKOFF_SECONDS = 60.0
MAX_RATE_LIMIT_WAIT_SECONDS = 120.0
LIST_PAGE_SIZE = 50
MEDIA_PAGE_SIZE = AniListClient.FULL_MEDIA_PER_PAGE  # 25: full payloads nest cast and staff

ENTRY_FIELDS = """
    mediaId status score(format: POINT_100) progress repeat notes updatedAt
    startedAt { year month day } completedAt { year month day }
    media { id idMal episodes title { romaji english native } }
"""

LIST_COLLECTION_QUERY = f"""
query ImportListCollection($userName: String) {{
    MediaListCollection(userName: $userName, type: ANIME) {{
        user {{ id }}
        lists {{ isCustomList entries {{ {ENTRY_FIELDS} }} }}
    }}
}}
"""

RECENT_ENTRIES_QUERY = f"""
query ImportRecentEntries($userName: String, $page: Int, $perPage: Int) {{
    Page(page: $page, perPage: $perPage) {{
        pageInfo {{ hasNextPage }}
        mediaList(userName: $userName, type: ANIME, sort: UPDATED_TIME_DESC) {{ {ENTRY_FIELDS} }}
    }}
}}
"""


def _media_query(argument: str) -> str:
    return f"""
query ImportMediaByIds($ids: [Int], $perPage: Int) {{
    Page(page: 1, perPage: $perPage) {{
        media({argument}: $ids, type: ANIME) {{ {MEDIA_FIELDS} }}
    }}
}}
"""


class AniListFetchError(Exception):
    """A request that failed for good. ``code``: not_found, private, rate_limited, unavailable, rejected."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


USER_MESSAGES = {
    "not_found": "AniList user not found. Check the username.",
    "private": "This AniList list is private. Make it public on AniList, then try again.",
    "rate_limited": "AniList is busy right now. Please try again in a few minutes.",
    "unavailable": "AniList is unavailable right now. Please try again later.",
    "rejected": "AniList rejected the request. Please try again later.",
}


def _error(code: str) -> AniListFetchError:
    return AniListFetchError(code, USER_MESSAGES[code])


class AniListFetcher:
    """One httpx session plus the shared limiter, for the length of one import job."""

    def __init__(self, *, client: httpx.Client | None = None, limiter=None):
        self._client = client or httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        self._limiter = limiter or AniListRateLimiter()
        self.api_url = getattr(settings, "ANILIST_API_URL", "") or DEFAULT_ANILIST_API_URL
        self.request_count = 0

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> AniListFetcher:
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    # ------------------------------------------------------------------ transport

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(2.0 * (2 ** (attempt - 1)), MAX_BACKOFF_SECONDS) + random.uniform(0.1, 0.5)

    def run_query(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        """POST one query; the ``data`` object, or ``AniListFetchError``."""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._limiter.acquire()
            self.request_count += 1
            try:
                response = self._client.post(
                    self.api_url, json={"query": query, "variables": variables}
                )
            except httpx.HTTPError as exc:
                logger.warning("AniList import request failed (%s), attempt %s", exc, attempt)
                if attempt == MAX_ATTEMPTS:
                    raise _error("unavailable") from exc
                time.sleep(self._backoff(attempt))
                continue

            if response.status_code == 429:
                wait = retry_after_seconds(response.headers.get("Retry-After"))
                wait = min(max(wait or self._backoff(attempt), 1.0), MAX_RATE_LIMIT_WAIT_SECONDS)
                self._limiter.pause(wait)  # every worker backs off, not only this one
                if attempt == MAX_ATTEMPTS:
                    raise _error("rate_limited")
                time.sleep(wait)
                continue

            body = self._json(response)
            message = self._first_error(body)
            lowered = message.lower()
            if "private" in lowered:
                raise _error("private")
            if response.status_code == 404 or "not found" in lowered:
                raise _error("not_found")
            if response.status_code >= 500:
                if attempt == MAX_ATTEMPTS:
                    raise _error("unavailable")
                time.sleep(self._backoff(attempt))
                continue
            data = body.get("data") if isinstance(body, dict) else None
            if response.status_code >= 400 or not isinstance(data, dict):
                logger.warning(
                    "AniList rejected an import query",
                    extra={"status_code": response.status_code, "message": message[:200]},
                )
                raise _error("rejected")
            return data
        raise _error("unavailable")

    @staticmethod
    def _json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return {}

    @staticmethod
    def _first_error(body: Any) -> str:
        if not isinstance(body, dict):
            return ""
        errors = body.get("errors")
        if isinstance(errors, list) and errors and isinstance(errors[0], dict):
            return str(errors[0].get("message") or "")
        return ""

    # ------------------------------------------------------------------ list reads

    def fetch_list_collection(self, username: str) -> tuple[list[dict], int | None]:
        """Every entry on the user's lists, custom lists skipped, deduped by media id.

        Returns ``(entries, anilist_user_id)``. AniList repeats an entry in every
        custom list it is filed under, so those lists are skipped and ids are deduped.
        """
        data = self.run_query(LIST_COLLECTION_QUERY, {"userName": username})
        collection = data.get("MediaListCollection")
        if not isinstance(collection, dict):
            raise _error("not_found")
        seen: set[int] = set()
        entries: list[dict] = []
        for group in collection.get("lists") or []:
            if not isinstance(group, dict) or group.get("isCustomList"):
                continue
            for row in group.get("entries") or []:
                media_id = row.get("mediaId") if isinstance(row, dict) else None
                if not media_id or media_id in seen:
                    continue
                seen.add(media_id)
                entries.append(row)
        user = collection.get("user") or {}
        return entries, user.get("id")

    def fetch_recent_entries(
        self, username: str, *, since: int | None, max_pages: int = 200
    ) -> list[dict]:
        """Entries changed after ``since`` (unix seconds), newest first.

        Stops at the first entry with ``updatedAt <= since``: a typical daily sync is
        one request.
        """
        entries: list[dict] = []
        for page in range(1, max_pages + 1):
            data = self.run_query(
                RECENT_ENTRIES_QUERY,
                {"userName": username, "page": page, "perPage": LIST_PAGE_SIZE},
            )
            block = data.get("Page") or {}
            for row in block.get("mediaList") or []:
                if not isinstance(row, dict):
                    continue
                if since is not None and int(row.get("updatedAt") or 0) <= since:
                    return entries
                entries.append(row)
            if not (block.get("pageInfo") or {}).get("hasNextPage"):
                break
        return entries

    # ------------------------------------------------------------------ catalog

    def fetch_media_by_ids(
        self, *, anilist_ids: Iterable[int] = (), mal_ids: Iterable[int] = ()
    ) -> Iterable[list[dict]]:
        """Full media payloads in pages of 25; yields one page at a time (so a caller can stop)."""
        for argument, ids in (("id_in", anilist_ids), ("idMal_in", mal_ids)):
            unique = list(dict.fromkeys(i for i in ids if i))
            query = _media_query(argument)
            for start in range(0, len(unique), MEDIA_PAGE_SIZE):
                chunk = unique[start : start + MEDIA_PAGE_SIZE]
                data = self.run_query(query, {"ids": chunk, "perPage": len(chunk)})
                media = (data.get("Page") or {}).get("media") or []
                yield [item for item in media if isinstance(item, dict)]


def save_media(service, item: dict):
    """Store one media payload as an ``Anime`` row through the catalog persistence."""
    return service.save_anime_to_db(item)
