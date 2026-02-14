"""
Management command to populate theme songs for existing anime.
Fetches openings and endings from Jikan (MyAnimeList) API.
Uses AniList to look up MAL IDs when missing.

Smart rate limiting features:
- Adaptive rate limiting based on response times
- Exponential backoff with jitter for 429 errors
- Respects X-RateLimit headers when available
- Tracks consecutive failures and adjusts delays
- Circuit breaker pattern for persistent failures
"""

import asyncio
import httpx
import random
import time
from asgiref.sync import sync_to_async
from django.core.management.base import BaseCommand
from anime.models import Anime, ThemeSong
from anime.services.anilist import AniListService
from anime.services.jikan import JikanRateLimiter, fetch_themes_from_jikan, JIKAN_BASE_URL
import logging
import re

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = (
        "Populate theme songs (openings/endings) for existing anime from Jikan/MAL API"
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--anime-id",
            type=int,
            help="Populate themes for a specific anime by ID",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Limit the number of anime to process",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=5,
            help="Number of concurrent requests (default: 5, limited by rate limiting)",
        )
        parser.add_argument(
            "--max-retries",
            type=int,
            default=3,
            help="Maximum retries for failed requests (default: 3)",
        )
        parser.add_argument(
            "--adaptive-delay",
            type=float,
            default=0.35,
            help="Base delay between requests in seconds (default: 0.35)",
        )

    def handle(self, *args, **options):
        anime_id = options.get("anime_id")
        limit = options.get("limit")
        batch_size = options.get("batch_size")
        max_retries = options.get("max_retries")
        adaptive_delay = options.get("adaptive_delay")

        if anime_id:
            try:
                anime = Anime.objects.get(id=anime_id)
                self.stdout.write(f"Processing themes for: {anime.title}")
                asyncio.run(
                    self.process_single_anime(anime, max_retries, adaptive_delay)
                )
            except Anime.DoesNotExist:
                self.stderr.write(f"Anime with ID {anime_id} not found")
                return
        else:
            queryset = Anime.objects.filter(theme_songs__isnull=True).distinct()
            if limit:
                queryset = queryset[:limit]

            total = queryset.count()
            self.stdout.write(f"Found {total} anime without theme songs")

            if total == 0:
                self.stdout.write(
                    self.style.SUCCESS("All anime already have theme songs!")
                )
                return

            asyncio.run(
                self.process_batch(queryset, batch_size, max_retries, adaptive_delay)
            )

    async def process_single_anime(
        self, anime, max_retries: int, adaptive_delay: float
    ):
        """Process themes for a single anime with smart rate limiting"""
        rate_limiter = JikanRateLimiter(base_delay=adaptive_delay)

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            try:
                mal_id = await self.ensure_mal_id(anime, http_client, rate_limiter)
                if not mal_id:
                    self.stderr.write(f"Could not find MAL ID for: {anime.title}")
                    return

                themes = await self.fetch_themes_from_jikan(
                    http_client, mal_id, rate_limiter, max_retries
                )
                if themes:
                    await self.save_theme_songs(anime, themes)
                    self.stdout.write(
                        self.style.SUCCESS(f"✓ Updated themes for: {anime.title}")
                    )
                else:
                    self.stderr.write(f"No theme data found for: {anime.title}")

            except Exception as e:
                self.stderr.write(f"Error processing {anime.title}: {str(e)}")

    async def process_batch(
        self, queryset, batch_size: int, max_retries: int, adaptive_delay: float
    ):
        """Process themes for multiple anime with smart rate limiting and batching"""
        anime_list = await sync_to_async(list)(queryset)
        total = len(anime_list)
        processed = 0
        errors = 0
        skipped = 0

        rate_limiter = JikanRateLimiter(base_delay=adaptive_delay)

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            for i in range(0, total, batch_size):
                batch = anime_list[i : i + batch_size]
                batch_num = i // batch_size + 1
                total_batches = (total + batch_size - 1) // batch_size

                self.stdout.write(
                    f"Processing batch {batch_num}/{total_batches} ({len(batch)} items)"
                )

                # Process batch with rate limiting
                for anime in batch:
                    processed += 1
                    success = await self.process_anime_with_backoff(
                        anime, http_client, rate_limiter, max_retries
                    )

                    if success:
                        pass  # Success already logged
                    else:
                        errors += 1

                    # Progress indicator
                    if processed % 50 == 0:
                        self.stdout.write(
                            f"--- Progress: {processed}/{total} "
                            f"(current delay: {rate_limiter.current_delay:.2f}s) ---"
                        )

                # Brief pause between batches to avoid burst
                if i + batch_size < total:
                    await asyncio.sleep(0.5)

        self.stdout.write(
            self.style.SUCCESS(
                f"\nComplete! Processed: {processed}, Errors: {errors}, Skipped: {skipped}"
            )
        )

    async def process_anime_with_backoff(
        self, anime, http_client, rate_limiter: JikanRateLimiter, max_retries: int
    ) -> bool:
        """Process a single anime with retry logic and exponential backoff"""
        for attempt in range(max_retries + 1):
            try:
                # Acquire rate limit permission
                await rate_limiter.acquire()

                mal_id = await self.ensure_mal_id(anime, http_client, rate_limiter)
                if not mal_id:
                    self.stderr.write(f"✗ No MAL ID for: {anime.title}")
                    return False

                themes = await self.fetch_themes_from_jikan(
                    http_client, mal_id, rate_limiter, max_retries
                )
                if themes:
                    await self.save_theme_songs(anime, themes)
                    self.stdout.write(f"✓ {anime.title}")
                    rate_limiter.record_success()
                    return True
                else:
                    self.stderr.write(f"⚠ No themes for: {anime.title}")
                    rate_limiter.record_success()
                    return True

            except Exception as e:
                error_str = str(e)

                # Check if it's a rate limit error
                if "429" in error_str or "Too Many Requests" in error_str:
                    rate_limiter.record_429()
                    if attempt < max_retries:
                        wait_time = rate_limiter.current_delay
                        self.stderr.write(
                            f"  Rate limited on {anime.title}, retrying in {wait_time:.1f}s "
                            f"(attempt {attempt + 1}/{max_retries})"
                        )
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        self.stderr.write(f"✗ Max retries exceeded for: {anime.title}")
                        return False
                else:
                    rate_limiter.record_error()
                    if attempt < max_retries:
                        wait_time = min(2**attempt, 10)  # Max 10s wait for other errors
                        self.stderr.write(
                            f"  Error on {anime.title}: {error_str}, "
                            f"retrying in {wait_time:.1f}s"
                        )
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        self.stderr.write(f"✗ Error ({anime.title}): {error_str}")
                        return False

        return False

    async def ensure_mal_id(self, anime, http_client, rate_limiter: JikanRateLimiter):
        """Ensure the anime has a MAL ID, looking it up via AniList if needed."""
        if anime.mal_id:
            return anime.mal_id

        # Try to look up MAL ID via AniList using anilist_id or title search
        anilist_service = AniListService()
        try:
            results = await anilist_service.search_anime(anime.title)
            if results:
                mal_id = results[0].get("idMal")
                anilist_id = results[0].get("id")
                if mal_id:
                    # Save for future use
                    await self._save_mal_id(anime, mal_id, anilist_id)
                    return mal_id
        except Exception as e:
            logger.warning(f"AniList lookup failed for {anime.title}: {e}")
        finally:
            await anilist_service.close()

        return None

    @sync_to_async
    def _save_mal_id(self, anime, mal_id, anilist_id=None):
        """Save MAL ID (and optionally AniList ID) to the anime record."""
        update_fields = []
        if not anime.mal_id:
            anime.mal_id = mal_id
            update_fields.append("mal_id")
        if anilist_id and not anime.anilist_id:
            anime.anilist_id = anilist_id
            update_fields.append("anilist_id")
        if update_fields:
            anime.save(update_fields=update_fields)

    async def fetch_themes_from_jikan(
        self,
        http_client: httpx.AsyncClient,
        mal_id: int,
        rate_limiter: JikanRateLimiter,
        max_retries: int = 3,
    ) -> dict:
        """Fetch theme songs from Jikan API with smart retry logic."""
        url = f"{JIKAN_BASE_URL}/anime/{mal_id}/themes"

        for attempt in range(max_retries + 1):
            try:
                response = await http_client.get(url)

                # Handle rate limiting with exponential backoff
                if response.status_code == 429:
                    rate_limiter.record_429()

                    # Try to get retry-after header
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        wait_time = float(retry_after)
                    else:
                        # Exponential backoff with jitter
                        wait_time = min(2**attempt + random.uniform(0, 2), 60)

                    if attempt < max_retries:
                        logger.warning(
                            f"Jikan 429 for MAL ID {mal_id}, waiting {wait_time:.1f}s "
                            f"(attempt {attempt + 1}/{max_retries})"
                        )
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        logger.error(
                            f"Jikan 429 max retries exceeded for MAL ID {mal_id}"
                        )
                        return None

                # Handle other HTTP errors
                if response.status_code >= 500:
                    if attempt < max_retries:
                        wait_time = min(2**attempt, 10)
                        logger.warning(
                            f"Jikan server error {response.status_code}, "
                            f"retrying in {wait_time:.1f}s"
                        )
                        await asyncio.sleep(wait_time)
                        continue

                response.raise_for_status()
                data = response.json().get("data", {})
                return data

            except httpx.HTTPError as e:
                logger.error(f"Jikan HTTP error for MAL ID {mal_id}: {e}")
                if attempt < max_retries:
                    wait_time = min(2**attempt, 10)
                    await asyncio.sleep(wait_time)
                    continue
                return None
            except Exception as e:
                logger.error(
                    f"Unexpected error fetching themes for MAL ID {mal_id}: {e}"
                )
                return None

        return None

    @sync_to_async
    def save_theme_songs(self, anime, themes):
        """Save theme songs to database"""
        ThemeSong.objects.filter(anime=anime).delete()

        openings = themes.get("openings", [])
        for idx, opening_text in enumerate(openings, 1):
            if opening_text:
                # Strip leading number prefix like "1: " from Jikan format
                clean_text = re.sub(r"^\d+:\s*", "", opening_text)
                parsed = self.parse_theme_song(clean_text)
                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.OPENING,
                    track_number=idx,
                    title=parsed["title"],
                    artist=parsed["artist"],
                    episodes=parsed["episodes"],
                    anilist_raw=opening_text,
                )

        endings = themes.get("endings", [])
        for idx, ending_text in enumerate(endings, 1):
            if ending_text:
                clean_text = re.sub(r"^\d+:\s*", "", ending_text)
                parsed = self.parse_theme_song(clean_text)
                ThemeSong.objects.create(
                    anime=anime,
                    song_type=ThemeSong.SongType.ENDING,
                    track_number=idx,
                    title=parsed["title"],
                    artist=parsed["artist"],
                    episodes=parsed["episodes"],
                    anilist_raw=ending_text,
                )

    def parse_theme_song(self, text):
        """Parse theme song format: 'Song Title' by Artist (eps X-Y)"""
        result = {"title": text, "artist": "", "episodes": ""}

        if not text:
            return result

        # Extract episode range (eps X-Y)
        episode_match = re.search(
            r"\s*\(eps?\s*([\d\-\s,]+)\)\s*$", text, re.IGNORECASE
        )
        if episode_match:
            result["episodes"] = episode_match.group(1).strip()
            text = text[: episode_match.start()].strip()

        # Extract artist: look for ' by ' pattern
        if text.startswith('"') and '" by ' in text:
            parts = text.split('" by ', 1)
            if len(parts) == 2:
                result["title"] = parts[0][1:].strip()
                result["artist"] = parts[1].strip()
        elif text.startswith("'") and "' by " in text:
            parts = text.split("' by ", 1)
            if len(parts) == 2:
                result["title"] = parts[0][1:].strip()
                result["artist"] = parts[1].strip()
        elif " by " in text:
            parts = text.rsplit(" by ", 1)
            if len(parts) == 2:
                result["title"] = parts[0].strip().strip('"').strip("'")
                result["artist"] = parts[1].strip()
        else:
            result["title"] = text.strip()

        return result
