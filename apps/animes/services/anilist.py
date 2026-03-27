import asyncio
import contextlib
import json
import re
from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

import httpx
from asgiref.sync import async_to_sync, sync_to_async
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from django.utils.text import slugify

# Import models
from apps.animes.models import (
    Anime,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Genre,
    Staff,
    Studio,
)
from apps.shared.logger import logger

# Import rate limiting utilities
from .rate_limiting import (
    AniListRateLimiter,
    APICallCache,
    CircuitBreaker,
)


class MediaSort(StrEnum):
    ID_DESC = "ID_DESC"
    SCORE = "SCORE_DESC"
    POPULARITY = "POPULARITY_DESC"
    TRENDING = "TRENDING_DESC"
    START_DATE = "START_DATE_DESC"

class MediaStatus(StrEnum):
    FINISHED = "FINISHED"
    RELEASING = "RELEASING"
    NOT_YET_RELEASED = "NOT_YET_RELEASED"
    CANCELLED = "CANCELLED"

class MediaFormat(StrEnum):
    TV = "TV"
    TV_SHORT = "TV_SHORT"
    MOVIE = "MOVIE"
    SPECIAL = "SPECIAL"
    OVA = "OVA"
    ONA = "ONA"
    MUSIC = "MUSIC"

class AniListService:
    BASE_URL = "https://graphql.anilist.co"
    MAX_PER_PAGE = 50

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

    def __init__(self, enable_caching: bool = True, enable_rate_limiting: bool = True):
        self.client = httpx.AsyncClient(headers={"Content-Type": "application/json"}, timeout=15.0)
        self.rate_limiter = AniListRateLimiter() if enable_rate_limiting else None
        self.call_cache = APICallCache(ttl=1800) if enable_caching else None
        self.circuit_breaker = CircuitBreaker(
            "anilist_api", failure_threshold=5, recovery_timeout=300
        )
        self.last_error_code = ""
        self.last_error_message = ""

    def _set_last_error(self, code: str, message: str):
        self.last_error_code = code
        self.last_error_message = (message or "")[:500]

    def _reset_last_error(self):
        self.last_error_code = ""
        self.last_error_message = ""

    def _parse_graphql_error_code(self, message: str) -> str:
        lowered = (message or "").lower()
        if "too many requests" in lowered or "rate limit" in lowered:
            return "rate_limited"
        if "variable" in lowered and any(
            token in lowered for token in ("invalid", "expected", "cannot represent")
        ):
            return "invalid_variable"
        if "not found" in lowered or "no such" in lowered:
            return "not_found"
        return "transport_error"

    async def _acquire_rate_limit(self):
        """Acquire rate limit permission if enabled."""
        if self.rate_limiter:
            await self.rate_limiter.acquire()

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

    async def _query(
        self, query: str, variables: dict, retry_count: int = 5, use_cache: bool = True
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
        from apps.animes.services.metrics import API_CALL_COUNT, API_CALL_DURATION

        self._reset_last_error()

        # Generate cache key from query and variables
        cache_key = (
            f"{hash(query) & 0xFFFFFFFF}:{hash(str(sorted(variables.items()))) & 0xFFFFFFFF}"
        )
        endpoint = "graphql"

        # Check cache first
        if use_cache:
            cached = self._get_cached_result(endpoint, cache_key)
            if cached is not None:
                logger.debug(f"Cache hit for query with vars: {variables}")
                return cached

        # Check circuit breaker
        if not self._check_circuit_breaker():
            logger.error("Circuit breaker is OPEN - refusing API call")
            self._set_last_error("transport_error", "circuit_breaker_open")
            return {}

        for attempt in range(retry_count):
            try:
                # Acquire rate limit permission
                await self._acquire_rate_limit()

                import time as _time
                _start = _time.time()
                _status = "success"

                try:
                    response = await self.client.post(
                        self.BASE_URL, json={"query": query, "variables": variables}
                    )

                    # Check for rate limits
                    response.headers.get("X-RateLimit-Remaining")
                    reset_time = response.headers.get("X-RateLimit-Reset")

                    if response.status_code == 429:
                        retry_after = response.headers.get("Retry-After")
                        wait_time = float(retry_after) if retry_after else 60.0

                        if reset_time:
                            # Wait until reset time plus a small buffer
                            now = datetime.now().timestamp()
                            wait_time = max(float(reset_time) - now + 1, wait_time)

                        logger.warning(
                            f"AniList Rate Limit Hit! Waiting {wait_time:.2f}s before retry (Attempt {attempt + 1}/{retry_count})"
                        )
                        self._set_last_error("rate_limited", "http_429")
                        _status = "rate_limited"
                        await asyncio.sleep(wait_time)
                        continue

                    response.raise_for_status()
                    data = response.json()

                    if "errors" in data:
                        error_msg = data["errors"][0]["message"]
                        if "Too Many Requests" in error_msg:
                            logger.warning("AniList GraphQL Rate Limit Error. Sleeping 60s...")
                            self._set_last_error("rate_limited", error_msg)
                            _status = "rate_limited"
                            await asyncio.sleep(60)
                            continue
                        logger.error(f"GraphQL Error: {error_msg}")
                        self._set_last_error(self._parse_graphql_error_code(error_msg), error_msg)
                        _status = "failure"
                        if self.last_error_code == "transport_error":
                            self._record_failure()
                        return {}

                    # Success - record it
                    self._record_success()
                    self._reset_last_error()
                    result = data.get("data", {})

                    # Cache successful response
                    if use_cache and result:
                        self._cache_result(endpoint, cache_key, result)

                    return result

                except httpx.HTTPError as e:
                    _status = "failure"
                    if (
                        isinstance(e, httpx.HTTPStatusError)
                        and e.response is not None
                        and 400 <= e.response.status_code < 500
                        and e.response.status_code != 429
                    ):
                        response_excerpt = ""
                        try:
                            payload = e.response.json()
                            response_excerpt = json.dumps(payload, ensure_ascii=False)[:500]
                        except Exception:
                            response_excerpt = (e.response.text or "")[:500]

                        # Some AniList edge throttling paths return 400 with a rate-limit style payload.
                        lowered = response_excerpt.lower()
                        if any(marker in lowered for marker in ("too many requests", "rate limit")):
                            _status = "rate_limited"
                            wait_time = min(60.0 * (attempt + 1), 300.0)
                            self._set_last_error("rate_limited", response_excerpt)
                            logger.warning(
                                "AniList 400 rate-limit style response. Waiting %.2fs before retry (attempt %s/%s). Body: %s",
                                wait_time,
                                attempt + 1,
                                retry_count,
                                response_excerpt,
                            )
                            await asyncio.sleep(wait_time)
                            continue

                        logger.warning(
                            "AniList non-retryable client error %s (attempt %s): %s | body=%s",
                            e.response.status_code,
                            attempt + 1,
                            e,
                            response_excerpt,
                        )
                        if e.response.status_code == 404:
                            self._set_last_error("not_found", response_excerpt or str(e))
                        elif e.response.status_code in {400, 422}:
                            self._set_last_error("invalid_variable", response_excerpt or str(e))
                        else:
                            self._set_last_error("transport_error", response_excerpt or str(e))
                        if self.last_error_code == "transport_error":
                            self._record_failure()
                        return {}

                    logger.error(f"Request error (Attempt {attempt + 1}): {e}")
                    if isinstance(e, (httpx.TimeoutException, httpx.ConnectError)):
                        self._set_last_error("transport_error", str(e))
                    if attempt < retry_count - 1:
                        wait = (attempt + 1) * 2
                        await asyncio.sleep(wait)
                    else:
                        if not self.last_error_code:
                            self._set_last_error("transport_error", str(e))
                        self._record_failure()
                        return {}
                finally:
                    _duration = _time.time() - _start
                    try:
                        API_CALL_DURATION.labels(
                            service="anilist", endpoint=endpoint, status=_status
                        ).observe(_duration)
                        API_CALL_COUNT.labels(
                            service="anilist", endpoint=endpoint, status=_status
                        ).inc()
                    except Exception:
                        pass

            except Exception as e:
                logger.error(f"Unexpected error in _query (Attempt {attempt + 1}): {e}")
                if attempt >= retry_count - 1:
                    self._set_last_error("transport_error", str(e))
                    self._record_failure()
                    return {}

        # All retries exhausted
        if not self.last_error_code:
            self._set_last_error("transport_error", "retries_exhausted")
        self._record_failure()
        return {}

    async def download_image(self, url: str) -> bytes | None:
        """Download image from URL with SSRF protection.
        Only allows HTTPS URLs from trusted domains.
        """
        if not url:
            return None

        # SSRF Protection: Validate URL
        from urllib.parse import urlparse

        parsed = urlparse(url)

        # Only allow HTTPS URLs
        if parsed.scheme != "https":
            logger.warning(f"Blocked non-HTTPS image URL: {url}")
            return None

        # Only allow URLs from trusted domains (AniList/CDN domains)
        trusted_domains = [
            "s4.anilist.co",
            "anilist.co",
            "img.anilist.co",
            "cdn.myanimelist.net",
            "api-cdn.myanimelist.net",
        ]

        domain = parsed.netloc.lower()
        if not any(domain.endswith(trusted) or domain == trusted for trusted in trusted_domains):
            logger.warning(f"Blocked untrusted image domain: {domain}")
            return None

        try:
            await asyncio.sleep(0.2)  # Polite delay for images too
            response = await self.client.get(url, timeout=10)
            response.raise_for_status()

            # Validate content type is an image
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                logger.warning(f"Non-image content type blocked: {content_type}")
                return None

            return response.content
        except httpx.HTTPError as e:
            logger.error(f"Error downloading image {url}: {e}")
            return None

    @staticmethod
    def anime_query(include_season: bool = False) -> str:
        media_fields = AniListService.MEDIA_FIELDS

        if include_season:
            return f"""
            query BySeason($season: MediaSeason, $year: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {{
                Page(page: $page, perPage: $perPage) {{
                    pageInfo {{ total currentPage lastPage hasNextPage }}
                    media(type: ANIME, season: $season, seasonYear: $year, sort: $sort, isAdult: false) {{
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
                    media(type: ANIME, sort: $sort, isAdult: false) {{
                        {media_fields}
                    }}
                }}
            }}
            """

    async def _fetch_paginated(
        self,
        variables: dict,
        include_season: bool = False,
        limit: int = 50,
        custom_query: str | None = None,  # Added custom_query parameter
    ) -> list[dict]:
        results = []
        page = variables.get("page", 1)
        per_page = min(limit, self.MAX_PER_PAGE)

        # If limit is large (e.g. 1000), we loop pages until we hit limit or no more pages
        fetched_count = 0

        query = (
            custom_query if custom_query else self.anime_query(include_season)
        )  # Use custom_query if provided

        while fetched_count < limit:
            variables.update({"page": page, "perPage": per_page})
            data = await self._query(query, variables)
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

    async def get_recent_updates(self, limit: int = 50) -> list[dict]:
        return await self._fetch_paginated(
            variables={"sort": [MediaSort.TRENDING.value]},
            include_season=False,
            limit=limit,
        )

    async def get_top_rated(self, limit: int = 50) -> list[dict]:
        return await self._fetch_paginated(
            variables={"sort": [MediaSort.SCORE.value]},
            include_season=False,
            limit=limit,
        )

    async def get_by_season(
        self,
        season: Literal["WINTER", "SPRING", "SUMMER", "FALL"],
        year: int,
        limit: int = 50,
        sort: MediaSort = MediaSort.POPULARITY,
    ) -> list[dict]:
        return await self._fetch_paginated(
            variables={"season": season, "year": year, "sort": [sort.value]},
            include_season=True,
            limit=limit,
        )

    def _sanitize_search_query(self, query_string: str) -> str:
        cleaned = (query_string or "").strip()
        if not cleaned:
            return ""
        cleaned = "".join(ch for ch in cleaned if ch.isprintable())
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned[:120]

    def _search_variants(self, query_string: str) -> list[str]:
        primary = self._sanitize_search_query(query_string)
        if not primary:
            return []

        variants = [primary]
        simplified = re.sub(r"[^0-9A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\s]", " ", primary)
        simplified = re.sub(r"\s+", " ", simplified).strip()
        if simplified and simplified not in variants:
            variants.append(simplified[:120])

        return variants

    async def search_anime(self, query_string: str, *, per_page: int = 5) -> list[dict]:
        """Search anime by title with lightweight sanitization."""
        query = f"""
            query SearchAnime($search: String, $perPage: Int) {{
                Page(page: 1, perPage: $perPage) {{
                    media(type: ANIME, search: $search, isAdult: false) {{
                        {self.MEDIA_FIELDS}
                    }}
                }}
            }}
        """

        for variant in self._search_variants(query_string):
            variables = {"search": variant, "perPage": max(1, min(per_page, 10))}
            data = await self._query(query, variables)
            if not data:
                continue
            media = data.get("Page", {}).get("media", [])
            if media:
                return media

        return []

    async def close(self):
        with contextlib.suppress(Exception):
            await self.client.aclose()

    # --- Processing Logic (Extracted from Command) ---

    async def process_media_list(self, media_list: list[dict], progress_callback=None):
        """Process a list of media items and save/update them in the database.
        Returns stats dict with created anime IDs for theme sync.
        """
        stats = {"created": 0, "updated": 0, "skipped": 0, "created_anime_ids": []}
        all_anime_ids = []  # Track all anime IDs for post-processing

        for i, item in enumerate(media_list):
            try:
                title_romaji = item.get("title", {}).get("romaji", "")
                title_english = item.get("title", {}).get("english", "")
                title_native = item.get("title", {}).get("native", "")
                title = title_english or title_romaji

                if not title:
                    continue

                slug = slugify(title)
                anime_data_dict = self._prepare_anime_data(item, title, title_native, slug)

                # Get or Create
                anime, created = await self._get_or_create_anime(slug, anime_data_dict)
                all_anime_ids.append(anime.id)

                if created:
                    stats["created"] += 1
                    stats["created_anime_ids"].append(anime.id)
                    logger.info(f"Created Anime: {title} (ID: {anime.id})")
                else:
                    # Always update for real-time freshness
                    # Preserve existing slug to maintain URL stability
                    if "slug" in anime_data_dict:
                        del anime_data_dict["slug"]

                    await self._update_anime(anime, anime_data_dict)
                    stats["updated"] += 1
                    logger.info(f"Updated Anime: {title}")

                # Handle Relationships & Media
                await self._handle_relationships_async(anime, item)

                # Handle Extended Info (Chars, Staff, Links, Relations)
                await self._handle_extended_info_async(anime, item)

                # Download images if missing
                await self._download_and_save_images(anime, item)

                if progress_callback:
                    await progress_callback(i + 1)

            except Exception as e:
                logger.error(f"Error processing anime {item.get('id')}: {e}")
                stats["skipped"] += 1
                if progress_callback:
                    await progress_callback(i + 1)

        # Post-processing: Update relation slugs for all processed anime
        # This ensures related anime from the same batch are properly linked
        if all_anime_ids:
            await self._update_relation_slugs(all_anime_ids)

        return stats

    async def update_anime_manual(self, anime: Anime, item: dict):
        """Manually update a specific Anime instance with AniList data.
        Updates fields but PRESERVES the existing slug to avoid integrity errors/identity shifts.
        """
        try:
            item = await self._resolve_manual_update_item(anime, item)
            if not item:
                logger.warning(
                    f"Skipped manual update for Anime ID {anime.id}: could not resolve matching AniList media"
                )
                return False

            title_romaji = item.get("title", {}).get("romaji", "")
            title_english = item.get("title", {}).get("english", "")
            title_native = item.get("title", {}).get("native", "")
            title = title_english or title_romaji

            # Use the EXISTING slug to ensure we don't collide with other records
            anime_data_dict = self._prepare_anime_data(item, title, title_native, anime.slug)

            # Explicitly ensure slug is NOT in the update dict to be safe (though passing it above helps)
            # If prepare_anime_data just puts it in the dict, passing anime.slug ensures the dict matches current state.
            # But let's be doubly sure we don't error out if title changed enough to generate different slug in prepare logic?
            # actually _prepare uses the slug arg. So passing anime.slug is correct.

            await self._update_anime(anime, anime_data_dict)
            logger.info(f"Manually Updated Anime ID {anime.id}: {anime.title}")

            # Handle extended info
            await self._handle_relationships_async(anime, item)
            await self._handle_extended_info_async(anime, item)
            await self._download_and_save_images(anime, item)

            return True
        except Exception as e:
            logger.error(f"Error manual update anime {anime.id}: {e}")
            raise e

    async def _resolve_manual_update_item(self, anime: Anime, item: dict) -> dict | None:
        """Resolve identity mismatches before applying a manual update.

        Metadata searches can return ambiguous title matches. This prevents writes that
        would move an Anime row onto a different AniList/MAL identity.
        """
        incoming_anilist_id = item.get("id")
        incoming_mal_id = item.get("idMal")

        # Strongest identity: AniList ID
        if anime.anilist_id and incoming_anilist_id and anime.anilist_id != incoming_anilist_id:
            logger.warning(
                f"AniList mismatch for Anime ID {anime.id}: expected {anime.anilist_id}, got {incoming_anilist_id}. Re-fetching canonical media."
            )
            canonical_item = await self.get_anime_by_id(anime.anilist_id)
            return canonical_item

        # Secondary identity: MAL ID (only if AniList ID is unavailable)
        if (
            not anime.anilist_id
            and anime.mal_id
            and incoming_mal_id
            and anime.mal_id != incoming_mal_id
        ):
            logger.warning(
                f"MAL mismatch for Anime ID {anime.id}: expected {anime.mal_id}, got {incoming_mal_id}. Re-fetching canonical media."
            )
            canonical_item = await self.search_by_mal_id(anime.mal_id)
            return canonical_item

        # Don't attach an identity already owned by another row.
        if incoming_anilist_id and not anime.anilist_id:
            existing = await sync_to_async(
                lambda: Anime.objects.filter(anilist_id=incoming_anilist_id)
                .exclude(id=anime.id)
                .values("id", "title")
                .first()
            )()
            if existing:
                logger.warning(
                    f"Skipped manual update for Anime ID {anime.id}: incoming AniList ID {incoming_anilist_id} belongs to Anime ID {existing['id']} ({existing['title']})."
                )
                return None

        if incoming_mal_id and not anime.mal_id:
            existing = await sync_to_async(
                lambda: Anime.objects.filter(mal_id=incoming_mal_id)
                .exclude(id=anime.id)
                .values("id", "title")
                .first()
            )()
            if existing:
                logger.warning(
                    f"Skipped manual update for Anime ID {anime.id}: incoming MAL ID {incoming_mal_id} belongs to Anime ID {existing['id']} ({existing['title']})."
                )
                return None

        return item

    def _lookup_existing_anime(
        self,
        *,
        anilist_id: int | None = None,
        mal_id: int | None = None,
        slug: str | None = None,
        title: str | None = None,
    ) -> Anime | None:
        if anilist_id:
            anime = Anime.objects.filter(anilist_id=anilist_id).first()
            if anime:
                return anime

        if mal_id:
            anime = Anime.objects.filter(mal_id=mal_id).first()
            if anime:
                return anime

        if slug:
            anime = Anime.objects.filter(slug=slug).first()
            if anime:
                return anime

        if title:
            anime = Anime.objects.filter(title=title).first()
            if anime:
                return anime

        return None

    @sync_to_async
    def _get_or_create_anime(self, slug, anime_data_dict):
        anilist_id = anime_data_dict.get("anilist_id")
        mal_id = anime_data_dict.get("mal_id")
        title = anime_data_dict.get("title")

        if anilist_id:
            try:
                anime = Anime.objects.get(anilist_id=anilist_id)
                return anime, False
            except Anime.DoesNotExist:
                pass

        if mal_id:
            try:
                anime = Anime.objects.get(mal_id=mal_id)
                return anime, False
            except Anime.DoesNotExist:
                pass

        if title:
            try:
                anime = Anime.objects.get(title=title)
                return anime, False
            except Anime.DoesNotExist:
                pass

        try:
            return Anime.objects.get_or_create(slug=slug, defaults=anime_data_dict)
        except IntegrityError as exc:
            existing = self._lookup_existing_anime(
                anilist_id=anilist_id,
                mal_id=mal_id,
                slug=slug,
                title=title,
            )
            if existing:
                logger.warning(
                    f"Recovered from create race for slug '{slug}' (AniList ID: {anilist_id}): {exc}"
                )
                return existing, False
            raise

    @sync_to_async
    def _update_anime(self, anime, anime_data_dict):
        anime_data = dict(anime_data_dict)
        self._apply_recent_airing_transition(anime, anime_data)
        original_values = {field: getattr(anime, field, None) for field in anime_data}

        # Preemptively avoid unique-constraint collisions.
        for unique_field in ("title", "anilist_id", "mal_id", "slug"):
            if unique_field not in anime_data:
                continue
            value = anime_data.get(unique_field)
            if value in (None, ""):
                continue

            conflict_exists = Anime.objects.filter(**{unique_field: value}).exclude(
                id=anime.id
            ).exists()
            if conflict_exists:
                logger.warning(
                    f"Skipping conflicting {unique_field} '{value}' while updating Anime ID {anime.id}"
                )
                anime_data[unique_field] = original_values.get(unique_field)

        for key, value in anime_data.items():
            setattr(anime, key, value)

        try:
            anime.save()
        except IntegrityError as exc:
            # Last-resort safety: keep identity fields stable and persist remaining updates.
            for unique_field in ("title", "anilist_id", "mal_id", "slug"):
                if unique_field in original_values:
                    setattr(anime, unique_field, original_values[unique_field])
            anime.save()
            logger.warning(
                f"Recovered from integrity conflict while updating Anime ID {anime.id}: {exc}"
            )

    def _apply_recent_airing_transition(self, anime: Anime, anime_data: dict) -> None:
        """Persist the last confirmed aired episode before AniList advances the schedule."""
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

    def _prepare_anime_data(self, item, title, title_native, slug):
        format_map = {
            "TV": Anime.AnimeType.tv,
            "TV_SHORT": Anime.AnimeType.tv,
            "MOVIE": Anime.AnimeType.movie,
            "OVA": Anime.AnimeType.ova,
            "ONA": Anime.AnimeType.special,
            "SPECIAL": Anime.AnimeType.special,
            "MUSIC": Anime.AnimeType.special,
        }
        anime_type = format_map.get(item.get("format", "TV"), Anime.AnimeType.tv)

        status_map = {
            "RELEASING": Anime.AnimeStatus.airing,
            "FINISHED": Anime.AnimeStatus.finished,
            "NOT_YET_RELEASED": Anime.AnimeStatus.upcoming,
            "CANCELLED": Anime.AnimeStatus.finished,
        }
        status = status_map.get(item.get("status", "FINISHED"), Anime.AnimeStatus.finished)

        start_date = self._parse_date(item.get("startDate", {}))
        end_date = self._parse_date(item.get("endDate", {}))

        avg_score = item.get("averageScore", 0)
        rating = round(avg_score / 10, 1) if avg_score else None

        description = item.get("description", "")
        if description:
            import re

            description = re.sub(r"<[^>]+>", "", description)
            description = description.strip()

        return {
            "title": title,
            "title_jp": title_native or "",
            "slug": slug,
            "synopsis": description or "No description available.",
            "anime_type": anime_type,
            "status": status,
            "episode_count": item.get("episodes") or 0,
            "duration_minutes": item.get("duration") or 24,
            "member_count": item.get("popularity") or 0,
            "release_date": start_date,
            "end_date": end_date,
            "rating": rating,
            "meta_description": (description[:157] + "...")
            if description and len(description) > 160
            else (description or ""),
            "site_rank": next(
                (
                    r["rank"]
                    for r in item.get("rankings", [])
                    if r["allTime"] and r["type"] == "RATED"
                ),
                None,
            ),
            "popularity_rank": next(
                (
                    r["rank"]
                    for r in item.get("rankings", [])
                    if r["allTime"] and r["type"] == "POPULAR"
                ),
                None,
            ),
            "status_distribution": {
                s["status"]: s["amount"]
                for s in item.get("stats", {}).get("statusDistribution", [])
            },
            "external_links": item.get("externalLinks", []),
            "relations": [
                {
                    "id": edge["node"]["id"],
                    "type": edge["relationType"],
                    "title": edge["node"]["title"].get("english")
                    or edge["node"]["title"].get("romaji"),
                    "format": edge["node"]["format"],
                    "status": edge["node"]["status"],
                    "cover": edge["node"]["coverImage"].get("large"),
                }
                for edge in item.get("relations", {}).get("edges", [])
                if edge["node"]["type"] == "ANIME"
            ],
            "next_airing_episode": item.get("nextAiringEpisode", {}).get("episode")
            if item.get("nextAiringEpisode")
            else None,
            "next_airing_date": timezone.make_aware(
                datetime.fromtimestamp(item["nextAiringEpisode"]["airingAt"]),
                timezone=UTC,
            )
            if item.get("nextAiringEpisode") and item["nextAiringEpisode"].get("airingAt")
            else None,
            # Source Material
            "source_material": self._map_source_material(item.get("source")),
            # Season Information
            "season": item.get("season") or "",
            "season_year": item.get("seasonYear"),
            # External image URLs are available immediately while background jobs
            # fetch and persist local image files.
            "cover_image_external_url": item.get("coverImage", {}).get("extraLarge")
            or item.get("coverImage", {}).get("large")
            or "",
            "banner_image_external_url": item.get("bannerImage") or "",
            # External IDs
            "anilist_id": item.get("id"),
            "mal_id": item.get("idMal"),
        }

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
        """Map AniList source to our SourceMaterial choices"""
        source_map = {
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
        return source_map.get(source, "") if source else ""

    @sync_to_async
    def _handle_relationships_async(self, anime, item):
        genres = item.get("genres") or []
        for genre_name in genres:
            genre, _ = Genre.objects.get_or_create(
                name=genre_name, defaults={"slug": slugify(genre_name)}
            )
            anime.genres.add(genre)

        studios = (item.get("studios") or {}).get("nodes") or []
        if studios and len(studios) > 0:
            studio_name = studios[0].get("name")
            if studio_name:
                studio, _ = Studio.objects.get_or_create(name=studio_name)
                anime.studio = studio
                anime.save()

    @sync_to_async
    def _handle_extended_info_async(self, anime, item):
        from django.db import transaction

        with transaction.atomic():
            # Handle Characters
            characters_data = (item.get("characterPreview") or {}).get("edges") or []
            for edge in characters_data:
                node = edge["node"]
                role = edge["role"]  # MAIN, SUPPORTING, etc.

                # Create/Get Character
                char_name = node["name"].get("full")
                char_native = node["name"].get("native")
                char_desc = node.get("description") or ""
                char_img = node.get("image", {}).get("large")

                char_anilist_id = node.get("id")
                if char_anilist_id:
                    character, _ = Character.objects.update_or_create(
                        anilist_id=char_anilist_id,
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

                # Handle Voice Actor (Japanese)
                voice_actors = edge.get("voiceActors") or []
                voice_actor = None
                if voice_actors:
                    va_node = voice_actors[0]
                    va_name = va_node["name"].get("full")
                    va_native = va_node["name"].get("native")
                    va_img = va_node.get("image", {}).get("large")
                    va_anilist_id = va_node.get("id")

                    if va_anilist_id:
                        voice_actor, _ = Staff.objects.update_or_create(
                            anilist_id=va_anilist_id,
                            defaults={
                                "name": va_name,
                                "name_native": va_native or "",
                                "image_url": va_img,
                            },
                        )
                    else:
                        voice_actor, _ = Staff.objects.update_or_create(
                            name=va_name,
                            defaults={"name_native": va_native or "", "image_url": va_img},
                        )

                # Link Anime -> Character
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

            # Handle Staff
            staff_data = (item.get("staffPreview") or {}).get("edges") or []
            for edge in staff_data:
                node = edge["node"]
                role = edge["role"]

                staff_name = node["name"].get("full")
                staff_native = node["name"].get("native")
                staff_img = node.get("image", {}).get("large")
                staff_anilist_id = node.get("id")

                if staff_anilist_id:
                    staff_member, _ = Staff.objects.update_or_create(
                        anilist_id=staff_anilist_id,
                        defaults={
                            "name": staff_name,
                            "name_native": staff_native or "",
                            "image_url": staff_img,
                        },
                    )
                else:
                    staff_member, _ = Staff.objects.update_or_create(
                        name=staff_name,
                        defaults={"name_native": staff_native or "", "image_url": staff_img},
                    )

                AnimeStaff.objects.update_or_create(
                    anime=anime,
                    staff=staff_member,
                    role=role,  # Keep exact role string
                )

        # Handle Theme Songs
        self._process_theme_songs(anime, item)

    def _process_theme_songs(self, anime, item):
        """Process openings and endings from AniList data"""
        from apps.animes.models import ThemeSong

        # Get openings and endings from AniList
        openings = item.get("openings") or []
        endings = item.get("endings") or []

        # Only process if there's actual theme data
        # AniList doesn't provide themes, so this will typically be empty
        # Themes are fetched separately via Jikan API
        if not openings and not endings:
            return

        # Clear existing theme songs to avoid duplicates (only if we have data)
        ThemeSong.objects.filter(anime=anime).delete()

        # Process openings
        for idx, opening_text in enumerate(openings, 1):
            if opening_text:
                parsed = self._parse_theme_song(opening_text)
                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.OPENING,
                    track_number=idx,
                    title=parsed["title"],
                    artist=parsed["artist"],
                    episodes=parsed["episodes"],
                    anilist_raw=opening_text,
                )

        # Process endings
        for idx, ending_text in enumerate(endings, 1):
            if ending_text:
                parsed = self._parse_theme_song(ending_text)
                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.ENDING,
                    track_number=idx,
                    title=parsed["title"],
                    artist=parsed["artist"],
                    episodes=parsed["episodes"],
                    anilist_raw=ending_text,
                )

    def _parse_theme_song(self, text: str) -> dict:
        """Parse AniList theme song format: 'Song Title' by Artist (eps X-Y)"""
        result = {"title": text, "artist": "", "episodes": ""}

        if not text:
            return result

        # Try to extract episode range (eps X-Y)
        import re

        episode_match = re.search(r"\s*\(eps?\s*([\d\-\s,]+)\)\s*$", text, re.IGNORECASE)
        if episode_match:
            result["episodes"] = episode_match.group(1).strip()
            text = text[: episode_match.start()].strip()

        # Try to extract artist: look for ' by ' pattern
        # Handle quoted titles: "Song Title" by Artist
        if text.startswith('"') and '" by ' in text:
            parts = text.split('" by ', 1)
            if len(parts) == 2:
                result["title"] = parts[0][1:].strip()  # Remove opening quote
                result["artist"] = parts[1].strip()
        elif text.startswith("'") and "' by " in text:
            parts = text.split("' by ", 1)
            if len(parts) == 2:
                result["title"] = parts[0][1:].strip()  # Remove opening quote
                result["artist"] = parts[1].strip()
        elif " by " in text:
            # Simple format: Song Title by Artist
            parts = text.rsplit(" by ", 1)
            if len(parts) == 2:
                result["title"] = parts[0].strip()
                result["artist"] = parts[1].strip()
        else:
            result["title"] = text.strip()

        return result

    async def _download_and_save_images(self, anime, item):
        try:
            cover_url = item.get("coverImage", {}).get("extraLarge") or item.get(
                "coverImage", {}
            ).get("large")
            banner_url = item.get("bannerImage")
            existing_cover_url = anime.cover_image_external_url or ""
            existing_banner_url = anime.banner_image_external_url or ""
            cover_url_changed = bool(cover_url and cover_url != existing_cover_url)
            banner_url_changed = bool(banner_url and banner_url != existing_banner_url)
            force_replace = cover_url_changed or banner_url_changed

            # Queue background task to download cover and banner images
            has_cover = await sync_to_async(lambda: bool(anime.cover_image))()
            has_banner = await sync_to_async(lambda: bool(anime.banner_image))()

            # Pass mal_id for Jikan fallback
            mal_id = item.get("idMal")

            if (
                (cover_url and not has_cover)
                or (banner_url and not has_banner)
                or (not has_banner and mal_id)
                or force_replace
            ):
                from apps.animes.tasks.images import fetch_anime_images

                logger.info(f"Queueing background image fetch for {anime.title}")
                await sync_to_async(fetch_anime_images.delay)(
                    anime_id=anime.id,
                    cover_url=cover_url,
                    banner_url=banner_url,
                    mal_id=mal_id,
                    force_replace=force_replace,
                )

            # Check if anime already has a trailer URL
            has_trailer = await sync_to_async(lambda: bool(anime.trailer_url))()
            if not has_trailer:
                trailer = item.get("trailer")
                if trailer:
                    trailer_id = trailer.get("id")
                    trailer_site = trailer.get("site")
                    if trailer_id and trailer_site:
                        trailer_url = None
                        if trailer_site.lower() == "youtube":
                            trailer_url = f"https://www.youtube.com/watch?v={trailer_id}"
                        elif trailer_site.lower() == "dailymotion":
                            trailer_url = f"https://www.dailymotion.com/video/{trailer_id}"

                        if trailer_url:
                            await self._save_trailer_url(anime, trailer_url)

        except Exception as e:
            logger.error(f"Error downloading media for {anime.title}: {e}")

    @sync_to_async
    def _save_image(self, anime, field_name, filename, image_data):
        field = getattr(anime, field_name)
        field.save(filename, ContentFile(image_data), save=True)

        # Queue thumbnail generation asynchronously to avoid blocking import
        # This runs in the background via Celery
        from apps.animes.tasks import generate_image_thumbnails

        generate_image_thumbnails.delay(anime.id)

    @sync_to_async
    def _save_trailer_url(self, anime, trailer_url):
        anime.trailer_url = trailer_url
        anime.save()

    @sync_to_async
    def _save_external_url(self, anime, field_name, url):
        """Save external image URL for fallback purposes"""
        setattr(anime, field_name, url)
        anime.save(update_fields=[field_name])

    async def get_anime_by_id(self, anilist_id: int) -> dict | None:
        """Fetch a single anime by AniList ID"""
        if not isinstance(anilist_id, int) or anilist_id <= 0 or anilist_id > 2_147_483_647:
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
        data = await self._query(query, variables)

        if data and data.get("Media"):
            return data["Media"]
        if not self.last_error_code:
            self._set_last_error("not_found", f"anilist_id:{anilist_id}")
        return None

    async def search_by_mal_id(self, mal_id: int) -> dict | None:
        """Search for anime by MyAnimeList ID"""
        if not isinstance(mal_id, int) or mal_id <= 0 or mal_id > 2_147_483_647:
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
        data = await self._query(query, variables)

        if data and data.get("Media"):
            return data["Media"]
        if not self.last_error_code:
            self._set_last_error("not_found", f"mal_id:{mal_id}")
        return None

    def save_anime_to_db(self, item: dict) -> Anime:
        """Synchronously save anime data to database (for use in Celery tasks)"""
        # Use asgiref bridge instead of asyncio.run() to avoid executor/thread
        # conflicts when called from request threads that already used async_to_sync.
        return async_to_sync(self._save_anime_to_db_async)(item)

    async def _save_anime_to_db_async(self, item: dict) -> Anime:
        """Async implementation of save_anime_to_db"""
        anilist_id = item.get("id")
        mal_id = item.get("idMal")
        title = item.get("title", {}).get("english") or item.get("title", {}).get("romaji")
        title_native = item.get("title", {}).get("native")

        if not title:
            raise ValueError("Anime must have a title")

        base_slug = slugify(title)

        # Try to find existing anime by AniList ID
        if anilist_id:
            try:
                anime = await sync_to_async(Anime.objects.get)(anilist_id=anilist_id)
                logger.debug(f"Found anime by AniList ID {anilist_id}: {anime.title}")
                await self._update_anime_async(anime, item, title, title_native, anime.slug)
                return anime
            except Anime.DoesNotExist:
                pass

        # Try to find by MAL ID
        if mal_id:
            try:
                anime = await sync_to_async(Anime.objects.get)(mal_id=mal_id)
                logger.debug(f"Found anime by MAL ID {mal_id}: {anime.title}")
                await self._update_anime_async(anime, item, title, title_native, anime.slug)
                return anime
            except Anime.DoesNotExist:
                pass

        # Try to find by slug - anime might exist without these IDs
        try:
            anime = await sync_to_async(Anime.objects.get)(slug=base_slug)
            logger.info(
                f"Found anime by slug '{base_slug}': {anime.title}. Adding AniList ID {anilist_id} and MAL ID {mal_id}"
            )
            await self._update_anime_async(anime, item, title, title_native, anime.slug)
            return anime
        except Anime.DoesNotExist:
            pass

        # Try to find by title to avoid duplicate-key failures on unique title constraint.
        try:
            anime = await sync_to_async(Anime.objects.get)(title=title)
            logger.info(
                f"Found anime by title '{title}': {anime.title}. Adding AniList ID {anilist_id} and MAL ID {mal_id}"
            )
            await self._update_anime_async(anime, item, title, title_native, anime.slug)
            return anime
        except Anime.DoesNotExist:
            pass

        # Check if slug is taken by a DIFFERENT anime (different title)
        # If so, generate a unique slug
        final_slug = base_slug
        counter = 0
        while True:
            try:
                await sync_to_async(Anime.objects.get)(slug=final_slug)
                # Found anime with this slug - if it's the same title, we would have found it above
                # So this must be a different anime with same slug
                counter += 1
                final_slug = f"{base_slug}-{counter}"
                if counter > 100:  # Safety limit
                    raise ValueError(
                        f"Could not generate unique slug for '{title}' after 100 attempts"
                    )
            except Anime.DoesNotExist:
                # This slug is available
                break

        # Create new anime with unique slug
        anime_data = self._prepare_anime_data(item, title, title_native, final_slug)
        anime_data["anilist_id"] = anilist_id
        anime_data["mal_id"] = mal_id

        # Add slugs to relations by looking up related anime in database
        relations = anime_data.get("relations", [])
        if relations:
            for rel in relations:
                rel_anilist_id = rel.get("id")
                if rel_anilist_id:
                    try:
                        related_anime = await sync_to_async(Anime.objects.get)(
                            anilist_id=rel_anilist_id
                        )
                        rel["slug"] = related_anime.slug
                    except Anime.DoesNotExist:
                        rel["slug"] = None

        try:
            anime = await sync_to_async(Anime.objects.create)(**anime_data)
            logger.info(f"Created new anime: {title} with slug {final_slug}")
        except IntegrityError as e:
            recovered = await sync_to_async(self._lookup_existing_anime)(
                anilist_id=anilist_id,
                mal_id=mal_id,
                slug=final_slug,
                title=title,
            )
            if recovered:
                logger.warning(
                    f"Recovered from create integrity conflict for '{title}' (AniList ID: {anilist_id}): {e}"
                )
                await self._update_anime_async(
                    recovered, item, title, title_native, recovered.slug
                )
                return recovered
            logger.error(f"Failed to create anime '{title}' with slug '{final_slug}': {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to create anime '{title}' with slug '{final_slug}': {e}")
            raise

        # Handle relationships
        await self._handle_relationships_async(anime, item)

        # Download images
        await self._download_and_save_images(anime, item)

        return anime

    async def _update_anime_async(
        self, anime: Anime, item: dict, title: str, title_native: str, slug: str
    ):
        """Update an existing anime asynchronously"""
        anime_data = self._prepare_anime_data(item, title, title_native, slug)
        anime_data["anilist_id"] = item.get("id") or anime.anilist_id
        anime_data["mal_id"] = item.get("idMal") or anime.mal_id

        # Add slugs to relations by looking up related anime in database
        relations = anime_data.get("relations", [])
        if relations:
            for rel in relations:
                anilist_id = rel.get("id")
                if anilist_id:
                    try:
                        related_anime = await sync_to_async(Anime.objects.get)(
                            anilist_id=anilist_id
                        )
                        rel["slug"] = related_anime.slug
                    except Anime.DoesNotExist:
                        rel["slug"] = None

        await self._update_anime(anime, anime_data)
        await self._handle_relationships_async(anime, item)
        await self._download_and_save_images(anime, item)

    async def _update_relation_slugs(self, anime_ids: list[int]):
        """Post-processing step to update relation slugs for processed anime.
        This ensures related anime from the same batch are properly linked.
        """
        logger.info(f"Updating relation slugs for {len(anime_ids)} anime")

        @sync_to_async
        def update_slugs():
            from apps.animes.models import Anime

            # Step 1: Collect all anilist_ids referenced in relations that need slug lookup
            anime_list = list(Anime.objects.filter(id__in=anime_ids))
            needed_anilist_ids = set()
            for anime in anime_list:
                relations = anime.relations or []
                for rel in relations:
                    rel_anilist_id = rel.get("id")
                    if rel_anilist_id and not rel.get("slug"):
                        needed_anilist_ids.add(rel_anilist_id)

            if not needed_anilist_ids:
                return 0

            # Step 2: Single batch query to resolve anilist_id -> slug
            anilist_to_slug = dict(
                Anime.objects.filter(anilist_id__in=needed_anilist_ids).values_list(
                    "anilist_id", "slug"
                )
            )

            # Step 3: Update relations with resolved slugs
            updated_count = 0
            for anime in anime_list:
                relations = anime.relations or []
                needs_save = False

                for rel in relations:
                    rel_anilist_id = rel.get("id")
                    if rel_anilist_id and not rel.get("slug"):
                        slug = anilist_to_slug.get(rel_anilist_id)
                        if slug:
                            rel["slug"] = slug
                            needs_save = True
                            logger.debug(f"Linked relation {rel_anilist_id} -> {slug}")

                if needs_save:
                    anime.relations = relations
                    anime.save(update_fields=["relations"])
                    updated_count += 1

            return updated_count

        try:
            count = await update_slugs()
            logger.info(f"Updated relation slugs for {count} anime")
        except Exception as e:
            logger.error(f"Error updating relation slugs: {e}")
