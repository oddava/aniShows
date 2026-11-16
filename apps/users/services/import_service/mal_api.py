"""MyAnimeList API import by username (``MAL_CLIENT_ID``)."""

from __future__ import annotations

import os
import time
from typing import TYPE_CHECKING, Any

import httpx

from ....shared.logger import logger
from ....shared.retry import retry_after_seconds
from .base import BaseImporter, ImportSourceError
from .entries import ImportedEntry, mal_api_entry

if TYPE_CHECKING:
    from ...models import UserImportJob

LIST_FIELDS = (
    "list_status{status,score,num_episodes_watched,start_date,finish_date,"
    "num_times_rewatched,is_rewatching,comments,updated_at}"
)
UNAVAILABLE = "MyAnimeList API is currently unavailable. Please try again later."


class MyAnimeListAPIImporter(BaseImporter):
    BASE_URL = "https://api.myanimelist.net/v2"
    PAGE_SIZE = 100
    MAX_PAGE_RETRIES = 5
    BASE_BACKOFF_SECONDS = 2
    MAX_BACKOFF_SECONDS = 30
    PAGE_DELAY_SECONDS = 0.5
    source_name = "mal_api"

    def __init__(
        self,
        job: UserImportJob,
        username: str,
        client_id: str | None = None,
        *,
        http_client: httpx.Client | None = None,
        **kwargs: Any,
    ):
        super().__init__(job, **kwargs)
        self.username = username
        self.client_id = client_id or os.getenv("MAL_CLIENT_ID")
        if not self.client_id:
            raise ValueError(
                "MAL_CLIENT_ID environment variable is required for MyAnimeList API imports. "
                "Please set it in your .env file or environment."
            )
        self._http = http_client

    def _retry_delay(self, attempt: int, response: httpx.Response | None = None) -> float:
        if response is not None:
            retry_after = retry_after_seconds(response.headers.get("Retry-After"))
            if retry_after is not None:
                return max(retry_after, 1.0)
        return min(self.BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)), self.MAX_BACKOFF_SECONDS)

    def _get_page(self, client: httpx.Client, offset: int) -> dict:
        url = f"{self.BASE_URL}/users/{self.username}/animelist"
        params = {"offset": offset, "limit": self.PAGE_SIZE, "fields": LIST_FIELDS, "nsfw": "true"}
        for attempt in range(1, self.MAX_PAGE_RETRIES + 1):
            try:
                response = client.get(url, params=params)
            except httpx.HTTPError as exc:
                if attempt == self.MAX_PAGE_RETRIES:
                    raise ImportSourceError(UNAVAILABLE) from exc
                time.sleep(self._retry_delay(attempt))
                continue
            if response.status_code == 404:
                raise ImportSourceError(f"User '{self.username}' not found on MyAnimeList.")
            if response.status_code == 403:
                raise ImportSourceError(
                    "This MyAnimeList list is private. Make it public, then try again."
                )
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == self.MAX_PAGE_RETRIES:
                    raise ImportSourceError(
                        "MyAnimeList is busy right now. Please try again in a few minutes."
                    )
                wait = self._retry_delay(attempt, response=response)
                logger.warning(
                    "MAL list fetch retrying",
                    extra={"status_code": response.status_code, "offset": offset, "wait": wait},
                )
                time.sleep(wait)
                continue
            if response.status_code >= 400:
                raise ImportSourceError(
                    f"MyAnimeList rejected the request ({response.status_code})."
                )
            try:
                return response.json()
            except ValueError as exc:
                raise ImportSourceError("MyAnimeList returned an unreadable response.") from exc
        raise ImportSourceError(UNAVAILABLE)

    def load_entries(self) -> list[ImportedEntry]:
        client = self._http or httpx.Client(
            timeout=30.0, headers={"X-MAL-CLIENT-ID": self.client_id}
        )
        entries: list[ImportedEntry] = []
        try:
            offset = 0
            while True:
                data = self._get_page(client, offset)
                entries.extend(mal_api_entry(item) for item in data.get("data") or [])
                if not (data.get("paging") or {}).get("next"):
                    break
                offset += self.PAGE_SIZE
                time.sleep(self.PAGE_DELAY_SECONDS)
        finally:
            if self._http is None:
                client.close()
        return entries
