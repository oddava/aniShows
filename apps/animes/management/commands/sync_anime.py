"""Unified management command for anime synchronization and enrichment.

Replaces multiple individual commands with a single interface.
"""

from celery import chain
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Unified command for anime synchronization and enrichment tasks"

    def add_arguments(self, parser):
        parser.add_argument(
            "workflow",
            choices=[
                "sync-catalog",
                "sync-airing",
                "enrich-metadata",
                "sync-themes",
                "import-offline-catalog",
                "reconcile-offline-sync",
                "generate-recommendations",
                "full-sync",
            ],
            help="Workflow to execute",
        )

        # Sync catalog options
        parser.add_argument(
            "--sync-type",
            choices=["trending", "seasonal", "next_season", "airing", "full_catalog"],
            default="trending",
            help="Type of catalog sync (for sync-catalog workflow)",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=50,
            help="Maximum number of anime to process",
        )

        # Airing workflow options
        parser.add_argument(
            "--phases",
            nargs="+",
            choices=["sync", "cleanup", "backfill"],
            help="Airing workflow phases to run",
        )

        # Metadata options
        parser.add_argument(
            "--mode",
            choices=["single", "backfill"],
            default="backfill",
            help="Metadata enrichment mode",
        )
        parser.add_argument(
            "--anime-id",
            type=int,
            help="Specific anime ID (for single mode)",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=50,
            help="Batch size for backfill mode",
        )

        # Theme options
        parser.add_argument(
            "--force-resync",
            action="store_true",
            help="Force re-sync of themes even if already present",
        )
        parser.add_argument(
            "--release-tag",
            default="latest",
            help="Anime Offline Database release tag or 'latest'",
        )
        parser.add_argument(
            "--asset-name",
            default="anime-offline-database.jsonl.zst",
            help="Anime Offline Database release asset to import",
        )
        parser.add_argument(
            "--source-url",
            default=None,
            help="Override download URL for Anime Offline Database import",
        )
        parser.add_argument(
            "--source-path",
            default=None,
            help="Local path to Anime Offline Database asset for import/testing",
        )
        parser.add_argument(
            "--resume",
            action="store_true",
            help="Resume the latest incomplete Anime Offline Database import",
        )
        parser.add_argument(
            "--enqueue-enrichment",
            action="store_true",
            help="Queue metadata, franchise, and theme enrichment after offline import",
        )
        parser.add_argument(
            "--enrichment-chunk-size",
            type=int,
            default=100,
            help="Chunk size for follow-up enrichment jobs after offline import",
        )
        parser.add_argument(
            "--import-limit",
            type=int,
            default=None,
            help="Optional row limit for Anime Offline Database imports",
        )
        parser.add_argument(
            "--strict",
            action="store_true",
            help="For offline reconciliation: keep scheduling rounds until completion cap",
        )
        parser.add_argument(
            "--max-rounds",
            type=int,
            default=24,
            help="Maximum reconciliation rounds in strict mode",
        )
        parser.add_argument(
            "--round-interval-minutes",
            type=int,
            default=15,
            help="Delay between strict reconciliation rounds",
        )
        parser.add_argument(
            "--chunk-size",
            type=int,
            default=100,
            help="Chunk size for reconciliation enqueue batches",
        )

        # Recommendation options
        parser.add_argument(
            "--user-id",
            type=int,
            help="Generate recommendations for specific user only",
        )
        parser.add_argument(
            "--rec-limit",
            type=int,
            default=10,
            help="Number of recommendations per user",
        )

        # General options
        parser.add_argument(
            "--async",
            action="store_true",
            dest="run_async",
            help="Run tasks asynchronously (return immediately)",
        )
        parser.add_argument(
            "--chain",
            action="store_true",
            help="Chain multiple tasks together",
        )
        parser.add_argument(
            "--queue",
            default=None,
            choices=[
                "critical",
                "high_priority",
                "default",
                "batch",
                "images",
                "notifications",
                "analytics",
                "low_priority",
            ],
            help=(
                "Optional queue override. If omitted, Celery task_routes decides the queue "
                "(recommended)."
            ),
        )

    def handle(self, *args, **options):
        workflow = options["workflow"]
        run_async = options["run_async"]
        queue = options["queue"]

        self.stdout.write(f"Starting workflow: {workflow}")
        self.stdout.write(f"Queue: {queue or 'auto (task_routes)'}")
        self.stdout.write(f"Async: {run_async}")

        if workflow == "sync-catalog":
            self._handle_sync_catalog(options, run_async, queue)
        elif workflow == "sync-airing":
            self._handle_sync_airing(options, run_async, queue)
        elif workflow == "enrich-metadata":
            self._handle_enrich_metadata(options, run_async, queue)
        elif workflow == "sync-themes":
            self._handle_sync_themes(options, run_async, queue)
        elif workflow == "import-offline-catalog":
            self._handle_import_offline_catalog(options, run_async, queue)
        elif workflow == "reconcile-offline-sync":
            self._handle_reconcile_offline_sync(options, run_async, queue)
        elif workflow == "generate-recommendations":
            self._handle_generate_recommendations(options, run_async, queue)
        elif workflow == "full-sync":
            self._handle_full_sync(options, run_async, queue)

    def _handle_sync_catalog(self, options, run_async, queue):
        """Handle catalog sync workflow."""
        from apps.animes.tasks import sync_anime_catalog

        sync_type = options["sync_type"]
        limit = options["limit"]

        self.stdout.write(f"Syncing catalog: {sync_type} (limit: {limit})")

        task = sync_anime_catalog.s(sync_type=sync_type, limit=limit)

        self._dispatch_task(task, run_async, queue)

    def _handle_sync_airing(self, options, run_async, queue):
        """Handle airing workflow."""
        from apps.animes.tasks import sync_airing_workflow

        phases = options.get("phases") or ["sync", "cleanup", "backfill"]
        batch_size = options.get("batch_size", 100)

        self.stdout.write(f"Running airing workflow: {phases}")

        task = sync_airing_workflow.s(
            phases=phases,
            batch_size=batch_size,
        )

        self._dispatch_task(task, run_async, queue)

    def _handle_enrich_metadata(self, options, run_async, queue):
        """Handle metadata enrichment."""
        from apps.animes.tasks import enrich_metadata

        mode = options["mode"]
        batch_size = options["batch_size"]
        anime_id = options.get("anime_id")

        if mode == "single" and not anime_id:
            raise CommandError("--anime-id required for single mode")

        self.stdout.write(f"Enriching metadata: {mode}")

        if mode == "single":
            task = enrich_metadata.s(anime_id=anime_id, mode="single")
        else:
            task = enrich_metadata.s(mode="backfill", batch_size=batch_size)

        self._dispatch_task(task, run_async, queue)

    def _handle_sync_themes(self, options, run_async, queue):
        """Handle theme song sync."""
        from apps.animes.tasks import sync_theme_songs

        limit = options["limit"]
        force_resync = options["force_resync"]
        anime_id = options.get("anime_id")

        if anime_id:
            self.stdout.write(f"Syncing themes for anime ID: {anime_id}")
            task = sync_theme_songs.s(anime_id=anime_id)
        else:
            self.stdout.write(f"Syncing themes (limit: {limit}, force: {force_resync})")
            task = sync_theme_songs.s(limit=limit, force_resync=force_resync)

        self._dispatch_task(task, run_async, queue)

    def _handle_import_offline_catalog(self, options, run_async, queue):
        """Handle Anime Offline Database import."""
        from apps.animes.tasks import import_offline_catalog

        release_tag = options["release_tag"]
        asset_name = options["asset_name"]
        source_url = options.get("source_url")
        source_path = options.get("source_path")
        limit = options["import_limit"]
        resume = options["resume"]
        enqueue_enrichment = options["enqueue_enrichment"]
        enrichment_chunk_size = options["enrichment_chunk_size"]

        self.stdout.write(
            f"Importing Anime Offline Database: {release_tag} ({asset_name})"
        )

        task = import_offline_catalog.s(
            release_tag=release_tag,
            asset_name=asset_name,
            source_url=source_url,
            source_path=source_path,
            limit=limit,
            resume=resume,
            enqueue_enrichment=enqueue_enrichment,
            enforce_full_sync=True,
            batch_size=options["batch_size"],
            enrichment_chunk_size=enrichment_chunk_size,
        )

        self._dispatch_task(task, run_async, queue)

    def _handle_reconcile_offline_sync(self, options, run_async, queue):
        """Reconcile metadata/themes for all offline-imported anime."""
        from apps.animes.tasks import reconcile_offline_catalog_sync

        batch_size = options["batch_size"]
        chunk_size = options["chunk_size"]
        strict = options["strict"]
        max_rounds = options["max_rounds"]
        round_interval_minutes = options["round_interval_minutes"]

        self.stdout.write(
            "Reconciling Offline Catalog sync "
            f"(batch_size={batch_size}, chunk_size={chunk_size}, strict={strict})"
        )

        task = reconcile_offline_catalog_sync.s(
            anime_ids=[],
            batch_size=batch_size,
            chunk_size=chunk_size,
            require_themes=True,
            strict=strict,
            max_rounds=max_rounds,
            round_number=1,
            round_interval_minutes=round_interval_minutes,
        )

        self._dispatch_task(task, run_async, queue)

    def _handle_generate_recommendations(self, options, run_async, queue):
        """Handle recommendation generation."""
        from apps.animes.tasks import generate_recommendations

        user_id = options.get("user_id")
        limit = options["rec_limit"]

        if user_id:
            self.stdout.write(f"Generating recommendations for user {user_id}")
            task = generate_recommendations.s(user_id=user_id, limit=limit)
        else:
            self.stdout.write("Generating recommendations for all users")
            task = generate_recommendations.s(limit=limit)

        self._dispatch_task(task, run_async, queue)

    def _handle_full_sync(self, options, run_async, queue):
        """Handle full synchronization workflow."""
        from apps.animes.tasks import (
            enrich_metadata,
            generate_recommendations,
            sync_airing_workflow,
            sync_anime_catalog,
            sync_theme_songs,
        )

        self.stdout.write("Starting full synchronization workflow...")

        # Create task chain
        # Use .si() (immutable signature) to prevent passing previous task results
        task_chain = chain(
            sync_anime_catalog.s(sync_type="trending", limit=50),
            sync_airing_workflow.si(phases=["sync", "cleanup", "backfill"]),
            enrich_metadata.si(mode="backfill", batch_size=50),
            sync_theme_songs.si(limit=50),
            generate_recommendations.si(),
        )

        if run_async:
            kwargs = {"queue": queue} if queue else {}
            result = task_chain.apply_async(**kwargs)
            self.stdout.write(self.style.SUCCESS(f"Task chain queued. ID: {result.id}"))
        else:
            self.stdout.write(
                self.style.WARNING(
                    "Full sync cannot run synchronously. Use --async flag."
                )
            )

    def _dispatch_task(self, task, run_async, queue):
        if run_async:
            kwargs = {"queue": queue} if queue else {}
            result = task.apply_async(**kwargs)
            self.stdout.write(self.style.SUCCESS(f"Task queued. ID: {result.id}"))
            return

        result = task.apply()
        self._print_result(result)

    def _print_result(self, result):
        """Pretty print task result."""
        if result.successful():
            self.stdout.write(self.style.SUCCESS("Task completed successfully"))
            self.stdout.write(f"Result: {result.result}")
        else:
            self.stdout.write(self.style.ERROR("Task failed"))
            if result.result:
                self.stdout.write(f"Error: {result.result}")
