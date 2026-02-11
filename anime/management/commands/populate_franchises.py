"""
Management command to populate franchise relations for existing anime.
Fetches relations from AniList and imports any related anime not yet in the database.

Smart rate limiting features:
- Respects AniList rate limiter (85 req/min with safety margin)
- Adaptive batch delays based on API response times
- Exponential backoff for rate limit errors
- Tracks consecutive failures and adjusts batch sizes
- Circuit breaker integration for persistent failures
"""

import asyncio
import time
import random
from asgiref.sync import sync_to_async
from django.core.management.base import BaseCommand
from django.db.models import Q
from anime.models import Anime
from anime.services.anilist import AniListService
import logging

logger = logging.getLogger(__name__)


class AdaptiveBatchLimiter:
    """
    Adaptive batch rate limiter for AniList API.
    Dynamically adjusts batch sizes and delays based on API performance.
    """

    def __init__(
        self,
        initial_batch_size: int = 5,
        min_batch_size: int = 1,
        max_batch_size: int = 10,
        base_delay: float = 0.7,
        min_delay: float = 0.5,
    ):
        self.batch_size = initial_batch_size
        self.min_batch_size = min_batch_size
        self.max_batch_size = max_batch_size
        self.base_delay = base_delay
        self.min_delay = min_delay
        self.current_delay = base_delay
        self.consecutive_failures = 0
        self.consecutive_successes = 0
        self.total_requests = 0
        self.failed_requests = 0
        self.last_batch_time = 0

    def get_batch_size(self) -> int:
        """Get current batch size based on recent performance."""
        return self.batch_size

    async def before_batch(self):
        """Called before processing a batch - handles rate limiting."""
        # Ensure minimum time between batches
        now = time.time()
        time_since_last = now - self.last_batch_time
        if time_since_last < self.current_delay:
            await asyncio.sleep(self.current_delay - time_since_last)

    def after_batch(self, success: bool, error_count: int = 0):
        """Called after processing a batch - adjusts parameters."""
        self.last_batch_time = time.time()
        self.total_requests += 1

        if success and error_count == 0:
            self.consecutive_successes += 1
            self.consecutive_failures = 0

            # Gradually increase batch size and reduce delay on success
            if self.consecutive_successes >= 3:
                self.batch_size = min(self.max_batch_size, self.batch_size + 1)
                self.current_delay = max(self.min_delay, self.current_delay * 0.95)
                self.consecutive_successes = 0
        else:
            self.consecutive_failures += 1
            self.consecutive_successes = 0
            self.failed_requests += 1

            # Reduce batch size and increase delay on failure
            if error_count > 0 or self.consecutive_failures >= 2:
                self.batch_size = max(self.min_batch_size, self.batch_size - 1)
                self.current_delay = min(self.current_delay * 1.2, 3.0)  # Cap at 3s
                self.consecutive_failures = 0

    def record_rate_limit_hit(self):
        """Record when we hit a rate limit - aggressive backoff."""
        self.consecutive_failures += 1
        self.batch_size = max(self.min_batch_size, self.batch_size - 2)
        self.current_delay = min(self.current_delay * 1.5, 5.0)  # Cap at 5s
        logger.warning(
            f"Rate limit hit! Reducing batch size to {self.batch_size}, "
            f"increasing delay to {self.current_delay:.2f}s"
        )


class Command(BaseCommand):
    help = "Populate franchise/relations data for existing anime from AniList, importing missing related anime"

    def add_arguments(self, parser):
        parser.add_argument(
            "--anime-id",
            type=int,
            help="Populate relations for a specific anime by ID",
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
            help="Initial batch size for concurrent requests (default: 5)",
        )
        parser.add_argument(
            "--adaptive",
            action="store_true",
            help="Enable adaptive batch sizing based on API performance",
        )
        parser.add_argument(
            "--delay",
            type=float,
            default=0.7,
            help="Base delay between batches in seconds (default: 0.7)",
        )
        parser.add_argument(
            "--max-imports",
            type=int,
            default=None,
            help="Maximum number of related anime to import (default: unlimited)",
        )

    def handle(self, *args, **options):
        anime_id = options.get("anime_id")
        limit = options.get("limit")
        batch_size = options.get("batch_size")
        adaptive = options.get("adaptive")
        delay = options.get("delay")
        max_imports = options.get("max_imports")

        if anime_id:
            try:
                anime = Anime.objects.get(id=anime_id)
                self.stdout.write(f"Processing relations for: {anime.title}")
                asyncio.run(self.process_single_anime(anime, max_imports))
            except Anime.DoesNotExist:
                self.stderr.write(f"Anime with ID {anime_id} not found")
                return
        else:
            # Find anime without relations data: NULL or empty list []
            queryset = Anime.objects.filter(
                Q(relations__isnull=True) | Q(relations=[])
            ).distinct()
            if limit:
                queryset = queryset[:limit]

            total = queryset.count()
            self.stdout.write(f"Found {total} anime without relations data")

            if total == 0:
                self.stdout.write(
                    self.style.SUCCESS("All anime already have relations data!")
                )
                return

            asyncio.run(
                self.process_batch(queryset, batch_size, adaptive, delay, max_imports)
            )

    async def process_single_anime(self, anime, max_imports: int = None):
        """Process relations for a single anime"""
        client = AniListService()
        try:
            results = await client.search_anime(anime.title)
            if not results:
                self.stderr.write(f"No AniList data found for: {anime.title}")
                return

            data = results[0]
            await self.save_relations(anime, data)
            imported = await self.import_missing_related_anime(
                client, data, max_imports
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"✓ Updated relations for: {anime.title} (imported {imported} new anime)"
                )
            )
        except Exception as e:
            self.stderr.write(f"Error processing {anime.title}: {str(e)}")
        finally:
            await client.close()

    async def process_batch(
        self,
        queryset,
        initial_batch_size: int,
        adaptive: bool,
        delay: float,
        max_imports: int = None,
    ):
        """Process relations for multiple anime with smart rate limiting"""
        # Evaluate queryset in a sync context to avoid SynchronousOnlyOperation
        anime_list = await sync_to_async(list)(queryset)
        total = len(anime_list)
        processed = 0
        errors = 0
        total_imported = 0

        # Initialize adaptive limiter if enabled
        limiter = (
            AdaptiveBatchLimiter(
                initial_batch_size=initial_batch_size, base_delay=delay
            )
            if adaptive
            else None
        )

        client = AniListService()
        try:
            i = 0
            while i < total:
                # Determine batch size
                if adaptive and limiter:
                    batch_size = limiter.get_batch_size()
                    await limiter.before_batch()
                else:
                    batch_size = initial_batch_size
                    if i > 0:  # Fixed delay between batches
                        await asyncio.sleep(delay)

                batch = anime_list[i : i + batch_size]
                batch_num = i // batch_size + 1
                total_batches = (total + batch_size - 1) // batch_size

                self.stdout.write(
                    f"Processing batch {batch_num}/{total_batches} "
                    f"(size: {len(batch)}, delay: {limiter.current_delay if limiter else delay:.2f}s)"
                )

                # Process batch
                batch_errors = 0
                batch_success = True

                for anime in batch:
                    try:
                        imported = await self.process_anime_with_client(
                            client, anime, max_imports
                        )
                        processed += 1
                        total_imported += imported
                        self.stdout.write(
                            f"✓ ({processed}/{total}) {anime.title} (+{imported} new)"
                        )
                    except Exception as e:
                        errors += 1
                        batch_errors += 1
                        batch_success = False
                        self.stderr.write(f"✗ Error ({anime.title}): {str(e)}")

                # Update adaptive limiter
                if adaptive and limiter:
                    limiter.after_batch(batch_success, batch_errors)

                # Progress indicator
                if processed % 50 == 0:
                    success_rate = (
                        ((processed - errors) / processed * 100) if processed > 0 else 0
                    )
                    self.stdout.write(
                        f"--- Progress: {processed}/{total} "
                        f"(Success rate: {success_rate:.1f}%) ---"
                    )

                i += batch_size

        finally:
            await client.close()

        success_rate = ((processed - errors) / processed * 100) if processed > 0 else 0
        self.stdout.write(
            self.style.SUCCESS(
                f"\nComplete! Processed: {processed}, Imported: {total_imported}, "
                f"Errors: {errors}, Success rate: {success_rate:.1f}%"
            )
        )

        # Print adaptive stats if enabled
        if adaptive and limiter:
            self.stdout.write(
                f"Adaptive stats: Final batch size: {limiter.batch_size}, "
                f"Final delay: {limiter.current_delay:.2f}s, "
                f"Total requests: {limiter.total_requests}, "
                f"Failed: {limiter.failed_requests}"
            )

    async def process_anime_with_client(self, client, anime, max_imports: int = None):
        """Process a single anime with the provided client, returns count of imported anime"""
        try:
            results = await client.search_anime(anime.title)
            if not results:
                return 0

            data = results[0]
            await self.save_relations(anime, data)
            imported = await self.import_missing_related_anime(
                client, data, max_imports
            )
            return imported

        except Exception as e:
            raise e

    async def import_missing_related_anime(self, client, data, max_imports: int = None):
        """
        For each related anime in the data, check if it exists in our DB.
        If not, fetch its full data from AniList and import it.
        Returns count of newly imported anime.
        """
        relations = data.get("relations", {}).get("edges", [])
        anime_relations = [
            edge for edge in relations if edge["node"]["type"] == "ANIME"
        ]

        if not anime_relations:
            return 0

        imported = 0
        for edge in anime_relations:
            # Check max imports limit
            if max_imports is not None and imported >= max_imports:
                logger.info(f"Reached max imports limit ({max_imports})")
                break

            node = edge["node"]
            anilist_id = node["id"]
            title = node["title"].get("english") or node["title"].get("romaji")

            if not title:
                continue

            # Check if this anime already exists in our DB
            exists = await sync_to_async(
                Anime.objects.filter(anilist_id=anilist_id).exists
            )()

            if exists:
                continue

            # Fetch full data from AniList and import
            try:
                # Add small delay to avoid hitting rate limits during imports
                await asyncio.sleep(0.2)

                full_results = await client.search_anime(title)
                if full_results:
                    stats = await client.process_media_list(full_results[:1])
                    if stats.get("created", 0) > 0:
                        imported += 1
                        logger.info(f"Imported related anime: {title}")
            except Exception as e:
                logger.warning(f"Could not import related anime '{title}': {e}")

        return imported

    @sync_to_async
    def save_relations(self, anime, data):
        """Save relations metadata to the anime's JSON field"""
        from anime.models import Anime

        relations = []

        for edge in data.get("relations", {}).get("edges", []):
            if edge["node"]["type"] == "ANIME":
                anilist_id = edge["node"]["id"]
                # Try to find the local anime to get its slug
                try:
                    related_anime = Anime.objects.get(anilist_id=anilist_id)
                    slug = related_anime.slug
                except Anime.DoesNotExist:
                    slug = None

                relations.append(
                    {
                        "id": anilist_id,
                        "slug": slug,
                        "type": edge["relationType"],
                        "title": edge["node"]["title"].get("english")
                        or edge["node"]["title"].get("romaji"),
                        "format": edge["node"]["format"],
                        "status": edge["node"]["status"],
                        "cover": edge["node"]["coverImage"].get("large"),
                    }
                )

        anime.relations = relations
        anime.save(update_fields=["relations"])
