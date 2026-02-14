"""
Management command to populate franchise relations for existing anime.
Fetches relations from AniList and imports any related anime not yet in the database.

Smart rate limiting features:
- Respects AniList rate limiter (85 req/min with safety margin)
- Adaptive batch delays based on API response times
- Exponential backoff for rate limit errors
- Tracks consecutive failures and adjusts batch sizes
- Circuit breaker integration for persistent failures

Usage:
    # Run synchronously (default) - imports missing anime to ensure all slugs are linked
    python manage.py populate_franchises
    
    # Run via Celery tasks (async)
    python manage.py populate_franchises --async
    
    # Process specific anime
    python manage.py populate_franchises --anime-id 123
    
    # Don't import missing related anime (not recommended - slugs may be missing)
    python manage.py populate_franchises --no-import-missing
"""

import asyncio
from asgiref.sync import sync_to_async
from django.core.management.base import BaseCommand
from django.db.models import Q
from anime.models import Anime
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Populate franchise/relations data for existing anime from AniList, ensuring ALL franchises have slugs linked"

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
            default=50,
            help="Batch size for processing (default: 50)",
        )
        parser.add_argument(
            "--no-import-missing",
            action="store_true",
            help="Don't import missing related anime (not recommended - slugs may be missing)",
        )
        parser.add_argument(
            "--max-imports",
            type=int,
            default=10,
            help="Maximum number of related anime to import per anime (default: 10)",
        )
        parser.add_argument(
            "--async",
            action="store_true",
            dest="use_async",
            help="Run via Celery tasks instead of synchronously",
        )
        parser.add_argument(
            "--priority-field",
            type=str,
            default="-popularity_rank",
            help="Field to order by (default: -popularity_rank)",
        )

    def handle(self, *args, **options):
        anime_id = options.get("anime_id")
        limit = options.get("limit")
        batch_size = options.get("batch_size")
        import_missing = not options.get("no_import_missing")  # Default to True
        max_imports = options.get("max_imports")
        use_async = options.get("use_async")
        priority_field = options.get("priority_field")

        if use_async:
            self._handle_async(
                anime_id, batch_size, import_missing, max_imports, priority_field
            )
        else:
            self._handle_sync(anime_id, limit, batch_size, import_missing, max_imports)

    def _handle_async(self, anime_id, batch_size, import_missing, max_imports, priority_field):
        """Handle via Celery tasks."""
        from anime.tasks import sync_franchises

        if anime_id:
            # Single anime
            result = sync_franchises.delay(
                anime_id=anime_id,
                import_missing=import_missing,
                max_imports=max_imports,
            )
            self.stdout.write(
                self.style.SUCCESS(f"Triggered franchise sync for anime ID {anime_id}")
            )
            self.stdout.write(f"Task ID: {result.id}")
            if import_missing:
                self.stdout.write("Import missing anime: ENABLED (ensures all slugs linked)")
        else:
            # Batch backfill
            result = sync_franchises.delay(
                mode="backfill",
                batch_size=batch_size,
                import_missing=import_missing,
                max_imports=max_imports,
                priority_field=priority_field,
            )
            self.stdout.write(
                self.style.SUCCESS(f"Triggered franchise backfill for {batch_size} anime")
            )
            self.stdout.write(f"Task ID: {result.id}")
            if import_missing:
                self.stdout.write("Import missing anime: ENABLED (ensures all slugs linked)")

    def _handle_sync(self, anime_id, limit, batch_size, import_missing, max_imports):
        """Handle synchronously."""
        if anime_id:
            try:
                anime = Anime.objects.get(id=anime_id)
                self.stdout.write(f"Processing relations for: {anime.title}")
                if import_missing:
                    self.stdout.write("Import missing anime: ENABLED (ensures all slugs linked)")
                asyncio.run(self.process_single_anime(anime, import_missing, max_imports))
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
            if import_missing:
                self.stdout.write("Import missing anime: ENABLED (ensures all slugs linked)")

            if total == 0:
                self.stdout.write(
                    self.style.SUCCESS("All anime already have relations data!")
                )
                return

            asyncio.run(
                self.process_batch(queryset, batch_size, import_missing, max_imports)
            )

    async def process_single_anime(self, anime, import_missing: bool, max_imports: int):
        """Process relations for a single anime using the franchise task logic."""
        from anime.tasks.franchises import FranchiseSyncTask
        
        task = FranchiseSyncTask()
        async with task.service_context() as service:
            try:
                result = await task._process_anime_franchises(
                    service, anime, import_missing, max_imports
                )
                
                if result.get("status") == "success":
                    linked = result.get("relations_linked", 0)
                    total = result.get("relations_count", 0)
                    imported = result.get("imported_count", 0)
                    missing = result.get("missing_slugs", 0)
                    
                    status_msg = f"✓ Updated relations for: {anime.title} ({total} relations"
                    if linked == total:
                        status_msg += f", ALL {linked} linked with slugs"
                    else:
                        status_msg += f", {linked} linked, {missing} missing slugs"
                    if imported > 0:
                        status_msg += f", {imported} imported"
                    status_msg += ")"
                    
                    self.stdout.write(self.style.SUCCESS(status_msg))
                else:
                    self.stderr.write(
                        f"✗ Failed to update {anime.title}: {result.get('error')}"
                    )
            except Exception as e:
                self.stderr.write(f"✗ Error processing {anime.title}: {e}")

    async def process_batch(
        self, queryset, batch_size: int, import_missing: bool, max_imports: int
    ):
        """Process relations for multiple anime."""
        from anime.tasks.franchises import FranchiseSyncTask
        
        # Evaluate queryset in a sync context
        anime_list = await sync_to_async(list)(queryset[:batch_size])
        total = len(anime_list)
        processed = 0
        errors = 0
        total_imported = 0
        total_relations = 0
        total_linked = 0

        task = FranchiseSyncTask()
        
        async with task.service_context() as service:
            for i, anime in enumerate(anime_list):
                try:
                    result = await task._process_anime_franchises(
                        service, anime, import_missing, max_imports
                    )
                    
                    if result.get("status") == "success":
                        processed += 1
                        total_imported += result.get("imported_count", 0)
                        rel_count = result.get("relations_count", 0)
                        linked_count = result.get("relations_linked", 0)
                        total_relations += rel_count
                        total_linked += linked_count
                        
                        status_msg = f"✓ ({i+1}/{total}) {anime.title}: {rel_count} relations"
                        if linked_count == rel_count:
                            status_msg += f", ALL linked"
                        else:
                            status_msg += f", {linked_count} linked"
                        if result.get("imported_count", 0) > 0:
                            status_msg += f", {result['imported_count']} imported"
                        
                        self.stdout.write(status_msg)
                    else:
                        errors += 1
                        self.stderr.write(
                            f"⚠ ({i+1}/{total}) {anime.title}: {result.get('error')}"
                        )

                    # Progress indicator
                    if (i + 1) % 10 == 0:
                        self.stdout.write(
                            f"--- Progress: {i+1}/{total} "
                            f"(Success: {processed}, Errors: {errors}, "
                            f"Linked: {total_linked}/{total_relations}) ---"
                        )

                except Exception as e:
                    errors += 1
                    self.stderr.write(f"✗ Error ({anime.title}): {str(e)}")

        self.stdout.write(
            self.style.SUCCESS(
                f"\nComplete! Processed: {processed}, "
                f"Total relations: {total_relations}, "
                f"Linked with slugs: {total_linked}, "
                f"Imported: {total_imported}, Errors: {errors}"
            )
        )
        
        if total_linked < total_relations:
            self.stdout.write(
                self.style.WARNING(
                    f"WARNING: {total_relations - total_linked} relations still missing slugs. "
                    f"Run 'update_relation_slugs' task to fix."
                )
            )
