"""AniList GraphQL client: HTTP, rate limiting, circuit breaker, response cache.

AniList is the only catalog provider (decision D1). Every request goes
through ``_query``: the shared rate limiter, a Redis response cache, the
circuit breaker, and bounded retries. Failures never raise; they return
``{}`` and leave the reason in ``last_error_code`` / ``last_error_message``.
"""

import json
import re
import time
from enum import StrEnum
from typing import Any, Literal

import httpx
from django.conf import settings

from .....shared.logger import logger
from .....shared.retry import backoff, retry_after_seconds
from ...rate_limiting import AniListRateLimiter, APICallCache, CircuitBreaker
from ..base import CatalogProviderBase
from . import mapper

DEFAULT_ANILIST_API_URL = "https://graphql.anilist.co"

# Returned by one try of ``_query`` to mean "try the request again".
_RETRY = object()


class MediaSort(StrEnum):
    ID_DESC = "ID_DESC"
    SCORE = "SCORE_DESC"
    POPULARITY = "POPULARITY_DESC"
    TRENDING = "TRENDING_DESC"
    START_DATE = "START_DATE_DESC"


# Fields for a full anime payload (detail, metadata refresh, new rows).
MEDIA_FIELDS = """
        id
        idMal
        title { romaji english native }
        synonyms
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
                node { id idMal title { romaji english native } type format status coverImage { large } }
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

# The schedule and status fields the hourly airing refresh needs. Small enough
# to fetch a whole page of shows per request.
AIRING_FIELDS = """
        id
        idMal
        title { romaji english native }
        format status episodes
        startDate { year month day }
        endDate { year month day }
        season seasonYear
        nextAiringEpisode { episode airingAt }
    """

_OPERATION_NAME = re.compile(r"query\s+(\w+)")


def _operation_name(query: str) -> str:
    match = _OPERATION_NAME.search(query)
    return match.group(1) if match else "anonymous"


class AniListClient(CatalogProviderBase):
    MAX_PER_PAGE = 50
    # Full payloads nest characters, voice actors and staff; keep pages of them
    # small so a query stays under AniList's complexity limit.
    FULL_MEDIA_PER_PAGE = 25
    # Pages of airing history fetched for one episode list (50 episodes each).
    EPISODE_SCHEDULE_MAX_PAGES = 30
    EPISODE_SCHEDULE_INTERACTIVE_PAGES = 4
    # Never sleep longer than this on one 429, whatever the headers say.
    MAX_RATE_LIMIT_WAIT_SECONDS = 120.0
    REQUEST_BUDGET_DEFAULT: Literal["default"] = "default"
    REQUEST_BUDGET_INTERACTIVE: Literal["interactive"] = "interactive"
    TRUSTED_IMAGE_DOMAINS = mapper.TRUSTED_IMAGE_DOMAINS
    MAL_IMAGE_PROXY_DOMAINS = mapper.MAL_IMAGE_PROXY_DOMAINS
    IMAGE_FILE_EXTENSIONS = mapper.IMAGE_FILE_EXTENSIONS
    MEDIA_FIELDS = MEDIA_FIELDS
    AIRING_FIELDS = AIRING_FIELDS

    def __init__(
        self,
        enable_caching: bool = True,
        enable_rate_limiting: bool = True,
        *,
        request_budget: Literal["default", "interactive"] = "default",
    ):
        self.api_url = (settings.ANILIST_API_URL or DEFAULT_ANILIST_API_URL).strip()
        # "interactive": a user is waiting (a web request), so every query is
        # capped at one try, no waiting for a rate-limit slot, a short timeout.
        self.request_budget = request_budget
        self.client = httpx.Client(
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=15.0,
        )
        self.rate_limiter = AniListRateLimiter() if enable_rate_limiting else None
        self.call_cache = APICallCache(ttl=1800) if enable_caching else None
        self.circuit_breaker = CircuitBreaker(
            "anilist_api", failure_threshold=5, recovery_timeout=300
        )
        self.last_error_code = ""
        self.last_error_message = ""

    def _parse_graphql_error_code(self, message: str) -> str:
        return mapper.parse_graphql_error_code(message)

    def _acquire_rate_limit(self, max_wait: float | None = None) -> bool:
        """Wait for a request slot (if rate limiting is on); False if none came in ``max_wait``."""
        if self.rate_limiter:
            return self.rate_limiter.acquire(max_wait=max_wait)
        return True

    def _get_cached_result(self, endpoint: str, params: str) -> dict | None:
        """Get cached API result if available."""
        if self.call_cache:
            return self.call_cache.get(endpoint, params)
        return None

    def _cache_result(self, endpoint: str, params: str, result: dict):
        """Cache API result if caching enabled."""
        if self.call_cache:
            self.call_cache.set(endpoint, params, result)

    def _check_circuit_breaker(self) -> bool:
        """Check if circuit breaker allows the request."""
        return not self.circuit_breaker.is_open()

    def _record_success(self):
        """Record successful API call."""
        self.circuit_breaker.record_success()

    def _record_failure(self):
        """Record failed API call."""
        self.circuit_breaker.record_failure()

    def _query(
        self,
        query: str,
        variables: dict,
        retry_count: int = 4,
        use_cache: bool = True,
        *,
        max_rate_limit_wait: float | None = None,
        request_timeout: float | None = None,
    ) -> dict:
        """Run a GraphQL query: cache, circuit breaker, then up to ``retry_count`` tries.

        Returns the response's ``data`` object, or ``{}`` with ``last_error_code``
        set: ``rate_limited`` and ``transport_error`` are worth retrying later,
        ``not_found`` and ``invalid_variable`` are not.
        """
        self._reset_last_error()
        if self.request_budget == self.REQUEST_BUDGET_INTERACTIVE:
            interactive = self._query_options_for_budget(self.REQUEST_BUDGET_INTERACTIVE)
            unbounded = float("inf")
            retry_count = min(retry_count, interactive["retry_count"])
            max_rate_limit_wait = min(
                interactive["max_rate_limit_wait"],
                unbounded if max_rate_limit_wait is None else max_rate_limit_wait,
            )
            request_timeout = min(
                interactive["request_timeout"],
                unbounded if request_timeout is None else request_timeout,
            )
        operation = _operation_name(query)
        cache_key = json.dumps({"query": query, "variables": variables}, sort_keys=True)

        if use_cache:
            cached = self._get_cached_result(operation, cache_key)
            if cached is not None:
                return cached

        if not self._check_circuit_breaker():
            self._set_last_error("transport_error", "circuit_breaker_open")
            return {}

        for attempt in range(max(retry_count, 1)):
            result = self._attempt_query(
                query,
                variables,
                operation,
                attempt=attempt,
                is_last=attempt >= retry_count - 1,
                max_rate_limit_wait=max_rate_limit_wait,
                request_timeout=request_timeout,
            )
            if result is _RETRY:
                continue
            if use_cache and result:
                self._cache_result(operation, cache_key, result)
            return result

        if not self.last_error_code:
            self._set_last_error("transport_error", "retries_exhausted")
        return {}

    def _attempt_query(
        self,
        query: str,
        variables: dict,
        operation: str,
        *,
        attempt: int,
        is_last: bool,
        max_rate_limit_wait: float | None,
        request_timeout: float | None,
    ):
        """One try: the ``data`` dict, ``{}`` to give up, or ``_RETRY`` to try again."""
        started = time.time()
        status = "success"
        try:
            if not self._acquire_rate_limit(max_wait=max_rate_limit_wait):
                # Every slot is taken (or AniList asked everyone to back off):
                # a caller with a wait budget gets "rate limited" now.
                status = "rate_limited"
                self._set_last_error("rate_limited", f"local_rate_limit:{operation}")
                return {}
            response = self.client.post(
                self.api_url,
                json={"query": query, "variables": variables},
                timeout=request_timeout if request_timeout is not None else self.client.timeout,
            )

            if response.status_code == 429:
                status = "rate_limited"
                return self._after_rate_limit(
                    response, operation, attempt=attempt, is_last=is_last, limit=max_rate_limit_wait
                )

            if response.status_code >= 500:
                status = "failure"
                return self._after_failure(
                    f"http_{response.status_code}", attempt=attempt, is_last=is_last
                )

            try:
                body = response.json()
            except ValueError:
                status = "failure"
                return self._after_failure("invalid_json", attempt=attempt, is_last=is_last)

            if not isinstance(body, dict):
                status = "failure"
                return self._after_failure("invalid_payload", attempt=attempt, is_last=is_last)

            raw_data = body.get("data")
            data = raw_data if isinstance(raw_data, dict) else {}
            errors = body.get("errors") or []
            if response.status_code >= 400 or (errors and not any(data.values())):
                status = self._after_query_error(response.status_code, errors, operation)
                return {}

            self._record_success()
            self._reset_last_error()
            return data
        except httpx.HTTPError as exc:
            # Timeouts, connection and other transport errors.
            status = "failure"
            return self._after_failure(
                str(exc) or type(exc).__name__, attempt=attempt, is_last=is_last
            )
        finally:
            self._observe_call(operation, status, started)

    def _after_rate_limit(
        self,
        response: httpx.Response,
        operation: str,
        *,
        attempt: int,
        is_last: bool,
        limit: float | None,
    ):
        """HTTP 429: wait as told and retry, unless the wait exceeds the caller's budget."""
        wait_time = retry_after_seconds(response.headers.get("Retry-After"))
        if wait_time is None:
            # X-RateLimit-Reset is a Unix timestamp; without either header, back off.
            reset_header = (response.headers.get("X-RateLimit-Reset") or "").strip()
            if reset_header.isdigit():
                wait_time = max(int(reset_header) - time.time(), 0.0)
            else:
                wait_time = min(2**attempt * 5, 60)
        wait_time = min(wait_time, self.MAX_RATE_LIMIT_WAIT_SECONDS)
        self._set_last_error("rate_limited", f"http_429:{operation}")
        logger.warning("AniList rate limited %s; retry in %.1fs", operation, wait_time)
        if self.rate_limiter:
            self.rate_limiter.pause(wait_time)
        if is_last or (limit is not None and wait_time > limit):
            return {}
        backoff(wait_time)
        return _RETRY

    def _after_failure(self, message: str, *, attempt: int, is_last: bool):
        """A 5xx, transport or decoding error: back off and retry; trip the breaker at the end."""
        if not is_last:
            backoff(min(2**attempt, 15))
            return _RETRY
        self._set_last_error("transport_error", message)
        self._record_failure()
        logger.warning("AniList request failed after retries: %s", message)
        return {}

    def _after_query_error(self, status_code: int, errors: list, operation: str) -> str:
        """A GraphQL or 4xx error: record why (never retried) and return the metrics status."""
        messages = [str(error.get("message") or "") for error in errors if isinstance(error, dict)]
        statuses = {error.get("status") for error in errors if isinstance(error, dict)}
        message = "; ".join(filter(None, messages)) or f"http_{status_code}:{operation}"
        if status_code == 404 or 404 in statuses:
            self._set_last_error("not_found", message)
            return "not_found"
        if status_code in {400, 422} or statuses & {400, 422}:
            # A bad variable (an ID out of range) is final. Anything else here
            # means AniList rejected the query itself (a schema change, the
            # complexity limit): our bug or theirs, so it stays retryable
            # (transport_error) instead of blocking rows, and is logged loudly.
            code = self._parse_graphql_error_code(message)
            self._set_last_error(code, message)
            if code == "invalid_variable":
                logger.warning("AniList rejected a variable in %s: %s", operation, message)
            else:
                logger.error("AniList rejected the %s query: %s", operation, message)
            return "client_error"
        self._set_last_error(self._parse_graphql_error_code(message), message)
        return "client_error"

    @staticmethod
    def _observe_call(operation: str, status: str, started: float) -> None:
        from ...metrics import API_CALL_COUNT, API_CALL_DURATION

        API_CALL_DURATION.labels(service="anilist", endpoint=operation, status=status).observe(
            time.time() - started
        )
        API_CALL_COUNT.labels(service="anilist", endpoint=operation, status=status).inc()

    def download_image(self, url: str) -> bytes | None:
        """Download image from URL with SSRF protection.
        Only allows HTTPS URLs from trusted domains.
        """
        if not url:
            return None

        resolved_url = self.resolve_fetchable_image_url(url)
        if not resolved_url:
            return None

        try:
            time.sleep(0.2)  # Polite delay for images too
            response = self.client.get(resolved_url, timeout=10)
            response.raise_for_status()

            # Validate content type is an image
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                logger.warning(f"Non-image content type blocked: {content_type}")
                return None

            return response.content
        except httpx.HTTPError as e:
            logger.error(f"Error downloading image {resolved_url}: {e}")
            return None

    @classmethod
    def _is_trusted_image_domain(cls, domain: str) -> bool:
        return mapper.is_trusted_image_domain(domain, cls.TRUSTED_IMAGE_DOMAINS)

    @classmethod
    def normalize_external_image_url(cls, url: str | None) -> str:
        """Normalize external image URLs while preserving display-safe fallbacks."""
        return mapper.normalize_external_image_url(
            url,
            proxy_domains=cls.MAL_IMAGE_PROXY_DOMAINS,
            image_extensions=cls.IMAGE_FILE_EXTENSIONS,
        )

    @classmethod
    def resolve_fetchable_image_url(cls, url: str | None) -> str:
        """Return a trusted direct image URL suitable for Celery fetch workers."""
        return mapper.resolve_fetchable_image_url(
            cls.normalize_external_image_url(url), trusted_domains=cls.TRUSTED_IMAGE_DOMAINS
        )

    @staticmethod
    def anime_query(include_season: bool = False) -> str:
        media_fields = MEDIA_FIELDS

        if include_season:
            return f"""
            query BySeason($season: MediaSeason, $year: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {{
                Page(page: $page, perPage: $perPage) {{
                    pageInfo {{ total currentPage lastPage hasNextPage }}
                    media(type: ANIME, season: $season, seasonYear: $year, sort: $sort) {{
                        {media_fields}
                    }}
                }}
            }}
            """
        else:
            return f"""
            query GetAnime($page: Int, $perPage: Int, $sort: [MediaSort]) {{
                Page(page: $page, perPage: $perPage) {{
                    pageInfo {{ total currentPage lastPage hasNextPage }}
                    media(type: ANIME, sort: $sort) {{
                        {media_fields}
                    }}
                }}
            }}
            """

    def _fetch_paginated(
        self,
        variables: dict,
        include_season: bool = False,
        limit: int = 50,
        custom_query: str | None = None,
    ) -> list[dict]:
        """Up to ``limit`` media, page by page.

        ``perPage`` stays the same on every page: AniList offsets pages by
        ``(page - 1) * perPage``, so a smaller last page would re-read rows.
        """
        results: list[dict] = []
        page = variables.get("page", 1)
        per_page = max(1, min(limit, self.FULL_MEDIA_PER_PAGE))
        query = custom_query if custom_query else self.anime_query(include_season)

        while len(results) < limit:
            data = self._query(query, {**variables, "page": page, "perPage": per_page})
            page_data = data.get("Page", {})
            media = page_data.get("media", [])
            if not media:
                break

            results.extend(media)
            if not page_data.get("pageInfo", {}).get("hasNextPage"):
                break
            page += 1

        return results[:limit]

    def get_recent_updates(self, limit: int = 50) -> list[dict]:
        """The ``limit`` currently trending anime, most trending first."""
        return self._fetch_paginated(
            variables={"sort": [MediaSort.TRENDING.value]},
            include_season=False,
            limit=limit,
        )

    def get_top_rated(self, limit: int = 50) -> list[dict]:
        return self._fetch_paginated(
            variables={"sort": [MediaSort.SCORE.value]},
            include_season=False,
            limit=limit,
        )

    def get_by_season(
        self,
        season: Literal["WINTER", "SPRING", "SUMMER", "FALL"],
        year: int,
        limit: int = 50,
        sort: MediaSort = MediaSort.POPULARITY,
    ) -> list[dict]:
        return self._fetch_paginated(
            variables={"season": season, "year": year, "sort": [sort.value]},
            include_season=True,
            limit=limit,
        )

    def _search_variants(self, query_string: str) -> list[str]:
        return mapper.search_variants(self._sanitize_search_query(query_string))

    def search_anime(self, query_string: str, *, per_page: int = 5) -> list[dict]:
        """Search anime by title with lightweight sanitization."""
        query = f"""
            query SearchAnime($search: String, $perPage: Int) {{
                Page(page: 1, perPage: $perPage) {{
                    media(type: ANIME, search: $search) {{
                        {self.MEDIA_FIELDS}
                    }}
                }}
            }}
        """

        for variant in self._search_variants(query_string):
            variables = {"search": variant, "perPage": max(1, min(per_page, 10))}
            data = self._query(query, variables)
            if not data:
                continue
            media = data.get("Page", {}).get("media", [])
            if media:
                return media

        return []

    def get_anime_by_id(self, anilist_id: int | None) -> dict | None:
        """Fetch a single anime by AniList ID"""
        if not mapper.is_valid_id(anilist_id):
            self._set_last_error("invalid_variable", "invalid_anilist_id")
            return None

        query = f"""
            query GetAnimeById($id: Int) {{
                Media(id: $id, type: ANIME) {{
                    {self.MEDIA_FIELDS}
                }}
            }}
        """

        variables = {"id": anilist_id}
        data = self._query(query, variables)

        if data and data.get("Media"):
            return data["Media"]
        if not self.last_error_code:
            self._set_last_error("not_found", f"anilist_id:{anilist_id}")
        return None

    def search_by_mal_id(self, mal_id: int | None) -> dict | None:
        """Search for anime by MyAnimeList ID"""
        if not mapper.is_valid_id(mal_id):
            self._set_last_error("invalid_variable", "invalid_mal_id")
            return None

        query = f"""
            query SearchByMalId($idMal: Int) {{
                Media(idMal: $idMal, type: ANIME) {{
                    {self.MEDIA_FIELDS}
                }}
            }}
        """

        variables = {"idMal": mal_id}
        data = self._query(query, variables)

        if data and data.get("Media"):
            return data["Media"]
        if not self.last_error_code:
            self._set_last_error("not_found", f"mal_id:{mal_id}")
        return None

    def get_airing_by_ids(
        self,
        *,
        anilist_ids: list[int] | tuple[int, ...] = (),
        mal_ids: list[int] | tuple[int, ...] = (),
    ) -> list[dict]:
        """Airing-field payloads for many anime, ``MAX_PER_PAGE`` per request.

        Unknown IDs are simply absent from the result.
        """
        results: list[dict] = []
        for argument, ids in (("id_in", anilist_ids), ("idMal_in", mal_ids)):
            valid = list(dict.fromkeys(i for i in ids if mapper.is_valid_id(i)))
            query = f"""
                query GetAiringByIds($ids: [Int], $perPage: Int) {{
                    Page(page: 1, perPage: $perPage) {{
                        media({argument}: $ids, type: ANIME) {{
                            {self.AIRING_FIELDS}
                        }}
                    }}
                }}
            """
            for start in range(0, len(valid), self.MAX_PER_PAGE):
                chunk = valid[start : start + self.MAX_PER_PAGE]
                data = self._query(query, {"ids": chunk, "perPage": len(chunk)}, use_cache=False)
                media = (data.get("Page") or {}).get("media") or []
                results.extend(item for item in media if isinstance(item, dict))
        return results

    def get_airing_anime(self, *, anilist_id: int | None = None, mal_id: int | None = None):
        """Airing-field payload for one anime, by AniList ID (preferred) or MAL ID."""
        lookup = self._media_lookup(anilist_id=anilist_id, mal_id=mal_id)
        if lookup is None:
            return None
        definitions, arguments, variables = lookup
        query = f"""
            query GetAiringAnime({definitions}) {{
                Media({arguments}) {{
                    {self.AIRING_FIELDS}
                }}
            }}
        """
        data = self._query(query, variables, use_cache=False)
        media = data.get("Media")
        if isinstance(media, dict):
            return media
        if not self.last_error_code:
            self._set_last_error("not_found", f"airing:{next(iter(variables.values()))}")
        return None

    def get_episode_schedule(
        self,
        *,
        anilist_id: int | None = None,
        mal_id: int | None = None,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> dict | None:
        """Episode data for one anime: totals, aired schedule and streaming links.

        Returns ``{"id", "idMal", "episodes", "status", "nextAiringEpisode",
        "streamingEpisodes", "airingSchedule"}``, where ``airingSchedule`` lists
        ``{"episode", "airingAt"}`` for episodes that have aired.
        """
        lookup = self._media_lookup(anilist_id=anilist_id, mal_id=mal_id)
        if lookup is None:
            return None
        definitions, arguments, variables = lookup
        query = f"""
            query GetAnimeEpisodes({definitions}, $page: Int, $withStreaming: Boolean!) {{
                Media({arguments}) {{
                    id
                    idMal
                    episodes
                    status
                    nextAiringEpisode {{ episode airingAt }}
                    streamingEpisodes @include(if: $withStreaming) {{ title thumbnail url site }}
                    airingSchedule(notYetAired: false, page: $page, perPage: 50) {{
                        pageInfo {{ hasNextPage }}
                        nodes {{ episode airingAt }}
                    }}
                }}
            }}
        """
        options = self._query_options_for_budget(request_budget)
        max_pages = (
            self.EPISODE_SCHEDULE_INTERACTIVE_PAGES
            if request_budget == self.REQUEST_BUDGET_INTERACTIVE
            else self.EPISODE_SCHEDULE_MAX_PAGES
        )

        result: dict | None = None
        schedule: list[dict] = []
        for page in range(1, max_pages + 1):
            # Streaming links are per anime, not per page: only the first page asks.
            page_variables = {**variables, "page": page, "withStreaming": page == 1}
            data = self._query(query, page_variables, **options)
            media = data.get("Media")
            if not isinstance(media, dict):
                break
            if result is None:
                result = {
                    key: media.get(key)
                    for key in ("id", "idMal", "episodes", "status", "nextAiringEpisode")
                }
                result["streamingEpisodes"] = [
                    episode
                    for episode in media.get("streamingEpisodes") or []
                    if isinstance(episode, dict)
                ]
            connection = media.get("airingSchedule") or {}
            schedule.extend(
                node for node in connection.get("nodes") or [] if isinstance(node, dict)
            )
            if not (connection.get("pageInfo") or {}).get("hasNextPage"):
                break

        if result is None:
            if not self.last_error_code:
                self._set_last_error("not_found", f"episodes:{next(iter(variables.values()))}")
            return None
        result["airingSchedule"] = schedule
        return result

    def get_recommendations_for_anime(
        self,
        anilist_id: int | None = None,
        *,
        mal_id: int | None = None,
        limit: int = 8,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> list[dict]:
        """Fetch AniList recommendations for an anime, by AniList ID or MAL ID."""
        lookup = self._media_lookup(anilist_id=anilist_id, mal_id=mal_id)
        if lookup is None:
            return []
        definitions, arguments, variables = lookup

        query = f"""
            query GetAnimeRecommendations({definitions}, $perPage: Int!) {{
                Media({arguments}) {{
                    recommendations(sort: [RATING_DESC], perPage: $perPage) {{
                        nodes {{
                            rating
                            mediaRecommendation {{
                                id
                                idMal
                                title {{ romaji english native }}
                                format
                                status
                                episodes
                                averageScore
                                popularity
                                coverImage {{ large extraLarge }}
                            }}
                        }}
                    }}
                }}
            }}
        """

        variables = {**variables, "perPage": min(limit, self.MAX_PER_PAGE)}
        data = self._query(query, variables, **self._query_options_for_budget(request_budget))
        return mapper.map_recommendations(data, self.normalize_external_image_url)

    def _media_lookup(
        self, *, anilist_id: int | None, mal_id: int | None
    ) -> tuple[str, str, dict] | None:
        """(variable definitions, Media arguments, variables) for an ID lookup."""
        if mapper.is_valid_id(anilist_id):
            return "$id: Int!", "id: $id, type: ANIME", {"id": anilist_id}
        if mapper.is_valid_id(mal_id):
            return "$idMal: Int!", "idMal: $idMal, type: ANIME", {"idMal": mal_id}
        self._set_last_error("invalid_variable", "missing_anilist_or_mal_id")
        return None

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
