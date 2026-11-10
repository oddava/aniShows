"""AniList GraphQL client: HTTP, rate limiting, circuit breaker, response cache.

Runtime network access is disabled (anime data comes from the self-hosted
Jikan instance), so ``_query`` raises; the query builders and response
handling stay for the AniList-only provider (decision D1).
"""

import time
from enum import StrEnum
from typing import Any, Literal

import httpx

from .....shared.logger import logger
from ...rate_limiting import AniListRateLimiter, APICallCache, CircuitBreaker
from ..base import CatalogProviderBase
from . import mapper


class MediaSort(StrEnum):
    ID_DESC = "ID_DESC"
    SCORE = "SCORE_DESC"
    POPULARITY = "POPULARITY_DESC"
    TRENDING = "TRENDING_DESC"
    START_DATE = "START_DATE_DESC"


# Common GraphQL fields for anime media queries.
# Used across anime_query(), search_anime(), get_anime_by_id(), search_by_mal_id().
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

# Extended fields that include theme song data (openings/endings).
MEDIA_FIELDS_WITH_THEMES = (
    MEDIA_FIELDS
    + """
        openings
        endings
    """
)


class AniListClient(CatalogProviderBase):
    RUNTIME_ACCESS_DISABLED_MESSAGE = (
        "AniListService network access is disabled. "
        "Runtime anime data fetches must go through the self-hosted Jikan instance."
    )
    MAX_PER_PAGE = 50
    REQUEST_BUDGET_DEFAULT = "default"
    REQUEST_BUDGET_INTERACTIVE = "interactive"
    TRUSTED_IMAGE_DOMAINS = mapper.TRUSTED_IMAGE_DOMAINS
    MAL_IMAGE_PROXY_DOMAINS = mapper.MAL_IMAGE_PROXY_DOMAINS
    IMAGE_FILE_EXTENSIONS = mapper.IMAGE_FILE_EXTENSIONS
    MEDIA_FIELDS = MEDIA_FIELDS
    MEDIA_FIELDS_WITH_THEMES = MEDIA_FIELDS_WITH_THEMES

    def __init__(self, enable_caching: bool = True, enable_rate_limiting: bool = True):
        self.client = httpx.Client(headers={"Content-Type": "application/json"}, timeout=15.0)
        self.rate_limiter = AniListRateLimiter() if enable_rate_limiting else None
        self.call_cache = APICallCache(ttl=1800) if enable_caching else None
        self.circuit_breaker = CircuitBreaker(
            "anilist_api", failure_threshold=5, recovery_timeout=300
        )
        self.last_error_code = ""
        self.last_error_message = ""

    def _parse_graphql_error_code(self, message: str) -> str:
        return mapper.parse_graphql_error_code(message)

    def _acquire_rate_limit(self):
        """Acquire rate limit permission if enabled."""
        if self.rate_limiter:
            self.rate_limiter.acquire()

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
        retry_count: int = 5,
        use_cache: bool = True,
        *,
        max_rate_limit_wait: float | None = None,
        request_timeout: float | None = None,
    ) -> dict:
        """Execute GraphQL query with rate limiting, caching, and circuit breaker.

        Args:
            query: GraphQL query string
            variables: Query variables
            retry_count: Number of retries on failure
            use_cache: Whether to use response caching

        Returns:
            API response data or empty dict on failure
        """
        self._reset_last_error()
        self._set_last_error("disabled", self.RUNTIME_ACCESS_DISABLED_MESSAGE)
        raise RuntimeError(self.RUNTIME_ACCESS_DISABLED_MESSAGE)

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
        results = []
        page = variables.get("page", 1)
        per_page = min(limit, self.MAX_PER_PAGE)

        # If limit is large (e.g. 1000), we loop pages until we hit limit or no more pages
        fetched_count = 0

        query = custom_query if custom_query else self.anime_query(include_season)

        while fetched_count < limit:
            variables.update({"page": page, "perPage": per_page})
            data = self._query(query, variables)
            page_data = data.get("Page", {})
            media = page_data.get("media", [])

            if not media:
                break

            results.extend(media)
            fetched_count += len(media)

            page_info = page_data.get("pageInfo", {})
            if not page_info.get("hasNextPage"):
                break

            page += 1
            # Adjust per_page for the last request if near limit
            remaining = limit - fetched_count
            if remaining < per_page:
                per_page = remaining

        return results[:limit]

    def get_recent_updates(self, limit: int = 50) -> list[dict]:
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

    def get_anime_by_id(self, anilist_id: int) -> dict | None:
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

    def get_streaming_episodes_for_anime(
        self,
        *,
        anilist_id: int | None = None,
        mal_id: int | None = None,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> dict | None:
        """Fetch AniList streaming episode metadata for an anime."""
        resolved_anilist_id = anilist_id if mapper.is_valid_id(anilist_id) else None
        resolved_mal_id = mal_id if mapper.is_valid_id(mal_id) else None
        if resolved_anilist_id is None and resolved_mal_id is None:
            self._set_last_error("invalid_variable", "missing_anilist_or_mal_id")
            return None

        if resolved_anilist_id is not None:
            variable_definitions = "$id: Int!"
            lookup_args = "id: $id, type: ANIME"
            variables = {"id": resolved_anilist_id}
        else:
            variable_definitions = "$malId: Int!"
            lookup_args = "idMal: $malId, type: ANIME"
            variables = {"malId": resolved_mal_id}

        query = f"""
            query GetAnimeStreamingEpisodes({variable_definitions}) {{
                Media({lookup_args}) {{
                    id
                    idMal
                    streamingEpisodes {{
                        title
                        thumbnail
                        url
                        site
                    }}
                }}
            }}
        """

        data = self._query(query, variables, **self._query_options_for_budget(request_budget))
        media = data.get("Media") if isinstance(data, dict) else None
        if isinstance(media, dict):
            return media
        if not self.last_error_code:
            lookup_value = resolved_anilist_id or resolved_mal_id
            self._set_last_error("not_found", f"streaming_episodes:{lookup_value}")
        return None

    def get_recommendations_for_anime(
        self,
        anilist_id: int,
        *,
        limit: int = 8,
        request_budget: Literal["default", "interactive"] = REQUEST_BUDGET_DEFAULT,
    ) -> list[dict]:
        """Fetch AniList recommendations for a specific anime."""
        if not mapper.is_valid_id(anilist_id):
            self._set_last_error("invalid_variable", "invalid_anilist_id")
            return []

        query = """
            query GetAnimeRecommendations($id: Int!, $perPage: Int!) {
                Media(id: $id, type: ANIME) {
                    recommendations(sort: [RATING_DESC], perPage: $perPage) {
                        nodes {
                            rating
                            mediaRecommendation {
                                id
                                idMal
                                title { romaji english native }
                                format
                                status
                                episodes
                                averageScore
                                popularity
                                coverImage { large extraLarge }
                            }
                        }
                    }
                }
            }
        """

        variables = {"id": anilist_id, "perPage": min(limit, self.MAX_PER_PAGE)}
        data = self._query(query, variables, **self._query_options_for_budget(request_budget))
        return mapper.map_recommendations(data, self.normalize_external_image_url)

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

    def search_by_mal_id(self, mal_id: int) -> dict | None:
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
