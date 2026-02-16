import httpx
import asyncio
import logging
from typing import Literal, Optional, List, Dict
from enum import Enum
from datetime import datetime, timezone as dt_timezone
from django.utils import timezone
from django.utils.text import slugify
from django.core.files.base import ContentFile
from asgiref.sync import sync_to_async

# Import models
from anime.models import (
    Anime,
    Genre,
    Studio,
    Character,
    Staff,
    AnimeCharacter,
    AnimeStaff,
)

# Import rate limiting utilities
from .rate_limiting import (
    AniListRateLimiter,
    APICallCache,
    CircuitBreaker,
    circuit_breaker_protected,
)

logger = logging.getLogger(__name__)


class MediaSort(str, Enum):
    ID_DESC = "ID_DESC"
    SCORE = "SCORE_DESC"
    POPULARITY = "POPULARITY_DESC"
    TRENDING = "TRENDING_DESC"
    START_DATE = "START_DATE_DESC"


class MediaStatus(str, Enum):
    FINISHED = "FINISHED"
    RELEASING = "RELEASING"
    NOT_YET_RELEASED = "NOT_YET_RELEASED"
    CANCELLED = "CANCELLED"


class MediaFormat(str, Enum):
    TV = "TV"
    TV_SHORT = "TV_SHORT"
    MOVIE = "MOVIE"
    SPECIAL = "SPECIAL"
    OVA = "OVA"
    ONA = "ONA"
    MUSIC = "MUSIC"


class AniListService:
    BASE_URL = "https://graphql.anilist.co/"
    MAX_PER_PAGE = 50

    def __init__(self, enable_caching: bool = True, enable_rate_limiting: bool = True):
        self.client = httpx.AsyncClient(
            headers={"Content-Type": "application/json"}, timeout=15.0
        )
        self.rate_limiter = AniListRateLimiter() if enable_rate_limiting else None
        self.call_cache = APICallCache(ttl=1800) if enable_caching else None
        self.circuit_breaker = CircuitBreaker(
            "anilist_api", failure_threshold=5, recovery_timeout=300
        )

    async def _acquire_rate_limit(self):
        """Acquire rate limit permission if enabled."""
        if self.rate_limiter:
            await self.rate_limiter.acquire()

    def _get_cached_result(self, endpoint: str, params: str) -> Optional[dict]:
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
        """
        Execute GraphQL query with rate limiting, caching, and circuit breaker.

        Args:
            query: GraphQL query string
            variables: Query variables
            retry_count: Number of retries on failure
            use_cache: Whether to use response caching

        Returns:
            API response data or empty dict on failure
        """
        # Generate cache key from query and variables
        cache_key = f"{hash(query) & 0xFFFFFFFF}:{hash(str(sorted(variables.items()))) & 0xFFFFFFFF}"
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
            return {}

        for attempt in range(retry_count):
            try:
                # Acquire rate limit permission
                await self._acquire_rate_limit()

                response = await self.client.post(
                    self.BASE_URL, json={"query": query, "variables": variables}
                )

                # Check for rate limits
                remaining = response.headers.get("X-RateLimit-Remaining")
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
                    await asyncio.sleep(wait_time)
                    continue

                response.raise_for_status()
                data = response.json()

                if "errors" in data:
                    error_msg = data["errors"][0]["message"]
                    if "Too Many Requests" in error_msg:
                        logger.warning(
                            f"AniList GraphQL Rate Limit Error. Sleeping 60s..."
                        )
                        await asyncio.sleep(60)
                        continue
                    logger.error(f"GraphQL Error: {error_msg}")
                    self._record_failure()
                    return {}

                # Success - record it
                self._record_success()
                result = data.get("data", {})

                # Cache successful response
                if use_cache and result:
                    self._cache_result(endpoint, cache_key, result)

                return result

            except httpx.HTTPError as e:
                logger.error(f"Request error (Attempt {attempt + 1}): {e}")
                if attempt < retry_count - 1:
                    wait = (attempt + 1) * 2
                    await asyncio.sleep(wait)
                else:
                    self._record_failure()
                    return {}

        # All retries exhausted
        self._record_failure()
        return {}

    async def download_image(self, url: str) -> Optional[bytes]:
        """
        Download image from URL with SSRF protection.
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
        if not any(
            domain.endswith(trusted) or domain == trusted for trusted in trusted_domains
        ):
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
        # Common fields to avoid duplication
        media_fields = """
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
        custom_query: Optional[str] = None,  # Added custom_query parameter
    ) -> List[dict]:
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

    async def get_recent_updates(self, limit: int = 50) -> List[dict]:
        return await self._fetch_paginated(
            variables={"sort": [MediaSort.TRENDING.value]},
            include_season=False,
            limit=limit,
        )

    async def get_top_rated(self, limit: int = 50) -> List[dict]:
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
    ) -> List[dict]:
        return await self._fetch_paginated(
            variables={"season": season, "year": year, "sort": [sort.value]},
            include_season=True,
            limit=limit,
        )

    async def search_anime(self, query_string: str) -> List[dict]:
        """Search for a single anime by title to get detailed info"""
        # We construct a query that allows searching
        media_fields_search = """
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

        query = f"""
            query SearchAnime($search: String) {{
                Page(page: 1, perPage: 1) {{
                    media(type: ANIME, search: $search, isAdult: false) {{
                        {media_fields_search}
                    }}
                }}
            }}
        """

        variables = {"search": query_string}
        data = await self._query(query, variables)
        if not data:
            return []

        return data.get("Page", {}).get("media", [])

    async def close(self):
        try:
            await self.client.aclose()
        except Exception:
            pass

    # --- Processing Logic (Extracted from Command) ---

    async def process_media_list(self, media_list: List[dict]):
        """
        Process a list of media items and save/update them in the database.
        Returns stats dict.
        """
        stats = {"created": 0, "updated": 0, "skipped": 0}

        for item in media_list:
            try:
                title_romaji = item.get("title", {}).get("romaji", "")
                title_english = item.get("title", {}).get("english", "")
                title_native = item.get("title", {}).get("native", "")
                title = title_english or title_romaji

                if not title:
                    continue

                slug = slugify(title)
                anime_data_dict = self._prepare_anime_data(
                    item, title, title_native, slug
                )

                # Get or Create
                anime, created = await self._get_or_create_anime(slug, anime_data_dict)

                if created:
                    stats["created"] += 1
                    logger.info(f"Created Anime: {title}")
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

            except Exception as e:
                logger.error(f"Error processing anime {item.get('id')}: {e}")
                stats["skipped"] += 1

        return stats

    async def update_anime_manual(self, anime: Anime, item: dict):
        """
        Manually update a specific Anime instance with AniList data.
        Updates fields but PRESERVES the existing slug to avoid integrity errors/identity shifts.
        """
        try:
            title_romaji = item.get("title", {}).get("romaji", "")
            title_english = item.get("title", {}).get("english", "")
            title_native = item.get("title", {}).get("native", "")
            title = title_english or title_romaji

            # Use the EXISTING slug to ensure we don't collide with other records
            anime_data_dict = self._prepare_anime_data(
                item, title, title_native, anime.slug
            )

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

    @sync_to_async
    def _get_or_create_anime(self, slug, anime_data_dict):
        anilist_id = anime_data_dict.get("anilist_id")

        if anilist_id:
            try:
                anime = Anime.objects.get(anilist_id=anilist_id)
                return anime, False
            except Anime.DoesNotExist:
                pass

        return Anime.objects.get_or_create(slug=slug, defaults=anime_data_dict)

    @sync_to_async
    def _update_anime(self, anime, anime_data_dict):
        for key, value in anime_data_dict.items():
            setattr(anime, key, value)
        anime.save()

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
        status = status_map.get(
            item.get("status", "FINISHED"), Anime.AnimeStatus.finished
        )

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
                timezone=dt_timezone.utc,
            )
            if item.get("nextAiringEpisode")
            and item["nextAiringEpisode"].get("airingAt")
            else None,
            # Source Material
            "source_material": self._map_source_material(item.get("source")),
            # Season Information
            "season": item.get("season", ""),
            "season_year": item.get("seasonYear"),
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
        genres = item.get("genres", [])
        for genre_name in genres:
            genre, _ = Genre.objects.get_or_create(
                name=genre_name, defaults={"slug": slugify(genre_name)}
            )
            anime.genres.add(genre)

        studios = item.get("studios", {}).get("nodes", [])
        if studios and len(studios) > 0:
            studio_name = studios[0].get("name")
            if studio_name:
                studio, _ = Studio.objects.get_or_create(name=studio_name)
                anime.studio = studio
                anime.save()

    @sync_to_async
    def _handle_extended_info_async(self, anime, item):
        # Handle Characters
        characters_data = item.get("characterPreview", {}).get("edges", [])
        for edge in characters_data:
            node = edge["node"]
            role = edge["role"]  # MAIN, SUPPORTING, etc.

            # Create/Get Character
            char_name = node["name"].get("full")
            char_native = node["name"].get("native")
            char_desc = node.get("description") or ""
            char_img = node.get("image", {}).get("large")

            character, _ = Character.objects.update_or_create(
                name=char_name,
                defaults={
                    "name_native": char_native or "",
                    "description": char_desc,
                    "image_url": char_img,  # Save the remote URL
                },
            )
            # We can download char image async later or just store URL if model allowed URL.
            # Current model has ImageField. For MVP speed, let's skip downloading char images for now or queue it.
            # To avoid stalling the scrape, we won't download char images here unless critically needed.

            # Handle Voice Actor (Japanese)
            voice_actors = edge.get("voiceActors", [])
            voice_actor = None
            if voice_actors:
                va_node = voice_actors[0]
                va_name = va_node["name"].get("full")
                va_native = va_node["name"].get("native")
                va_img = va_node.get("image", {}).get("large")

                voice_actor, _ = Staff.objects.update_or_create(
                    name=va_name,
                    defaults={"name_native": va_native or "", "image_url": va_img},
                )

            # Link Anime -> Character
            # Map role
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
        staff_data = item.get("staffPreview", {}).get("edges", [])
        for edge in staff_data:
            node = edge["node"]
            role = edge["role"]

            staff_name = node["name"].get("full")
            staff_native = node["name"].get("native")
            staff_img = node.get("image", {}).get("large")

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
        from anime.models import ThemeSong

        # Clear existing theme songs to avoid duplicates
        ThemeSong.objects.filter(anime=anime).delete()

        # Process openings
        openings = item.get("openings", [])
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
        endings = item.get("endings", [])
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

        episode_match = re.search(
            r"\s*\(eps?\s*([\d\-\s,]+)\)\s*$", text, re.IGNORECASE
        )
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

            # Using sync_to_async/lambda to check fields to avoid sync DB access in async
            has_cover = await sync_to_async(lambda: bool(anime.cover_image))()
            has_banner = await sync_to_async(lambda: bool(anime.banner_image))()
            has_trailer = await sync_to_async(lambda: bool(anime.trailer_url))()

            # Always store external URLs for fallback, even if download fails
            if cover_url:
                await self._save_external_url(
                    anime, "cover_image_external_url", cover_url
                )

            if banner_url:
                await self._save_external_url(
                    anime, "banner_image_external_url", banner_url
                )

            if cover_url and not has_cover:
                cover_data = await self.download_image(cover_url)
                if cover_data:
                    filename = f"{anime.slug}_cover.jpg"
                    await self._save_image(anime, "cover_image", filename, cover_data)

            if banner_url and not has_banner:
                banner_data = await self.download_image(banner_url)
                if banner_data:
                    filename = f"{anime.slug}_banner.jpg"
                    await self._save_image(anime, "banner_image", filename, banner_data)

            if not has_trailer:
                trailer = item.get("trailer")
                if trailer:
                    trailer_id = trailer.get("id")
                    trailer_site = trailer.get("site")
                    if trailer_id and trailer_site:
                        trailer_url = None
                        if trailer_site.lower() == "youtube":
                            trailer_url = (
                                f"https://www.youtube.com/watch?v={trailer_id}"
                            )
                        elif trailer_site.lower() == "dailymotion":
                            trailer_url = (
                                f"https://www.dailymotion.com/video/{trailer_id}"
                            )

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
        from anime.tasks import generate_image_thumbnails

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

    async def get_anime_by_id(self, anilist_id: int) -> Optional[dict]:
        """Fetch a single anime by AniList ID"""
        media_fields = """
            id
            idMal
            title { romaji english native }
            format status episodes averageScore popularity duration
            startDate { year month day }
            endDate { year month day }
            season seasonYear
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

        query = f"""
            query GetAnimeById($id: Int) {{
                Media(id: $id, type: ANIME) {{
                    {media_fields}
                }}
            }}
        """

        variables = {"id": anilist_id}
        data = await self._query(query, variables)

        if data and data.get("Media"):
            return data["Media"]
        return None

    async def search_by_mal_id(self, mal_id: int) -> Optional[dict]:
        """Search for anime by MyAnimeList ID"""
        media_fields = """
            id
            idMal
            title { romaji english native }
            format status episodes averageScore popularity duration
            startDate { year month day }
            endDate { year month day }
            season seasonYear
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
            openings
            endings
        """

        query = f"""
            query SearchByMalId($idMal: Int) {{
                Media(idMal: $idMal, type: ANIME) {{
                    {media_fields}
                }}
            }}
        """

        variables = {"idMal": mal_id}
        data = await self._query(query, variables)

        if data and data.get("Media"):
            return data["Media"]
        return None

    def save_anime_to_db(self, item: dict) -> Anime:
        """Synchronously save anime data to database (for use in Celery tasks)"""
        import asyncio

        # Run the async save method synchronously
        return asyncio.run(self._save_anime_to_db_async(item))

    async def _save_anime_to_db_async(self, item: dict) -> Anime:
        """Async implementation of save_anime_to_db"""
        import logging

        logger = logging.getLogger(__name__)

        anilist_id = item.get("id")
        mal_id = item.get("idMal")
        title = item.get("title", {}).get("english") or item.get("title", {}).get(
            "romaji"
        )
        title_native = item.get("title", {}).get("native")

        if not title:
            raise ValueError("Anime must have a title")

        base_slug = slugify(title)

        # Try to find existing anime by AniList ID
        if anilist_id:
            try:
                anime = await sync_to_async(Anime.objects.get)(anilist_id=anilist_id)
                logger.debug(f"Found anime by AniList ID {anilist_id}: {anime.title}")
                await self._update_anime_async(
                    anime, item, title, title_native, anime.slug
                )
                return anime
            except Anime.DoesNotExist:
                pass

        # Try to find by MAL ID
        if mal_id:
            try:
                anime = await sync_to_async(Anime.objects.get)(mal_id=mal_id)
                logger.debug(f"Found anime by MAL ID {mal_id}: {anime.title}")
                await self._update_anime_async(
                    anime, item, title, title_native, anime.slug
                )
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

        # Check if slug is taken by a DIFFERENT anime (different title)
        # If so, generate a unique slug
        final_slug = base_slug
        counter = 0
        while True:
            try:
                existing = await sync_to_async(Anime.objects.get)(slug=final_slug)
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
            from anime.models import Anime

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
        except Exception as e:
            logger.error(
                f"Failed to create anime '{title}' with slug '{final_slug}': {e}"
            )
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
            from anime.models import Anime

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

        for key, value in anime_data.items():
            setattr(anime, key, value)

        await sync_to_async(anime.save)()
        await self._handle_relationships_async(anime, item)
        await self._download_and_save_images(anime, item)
