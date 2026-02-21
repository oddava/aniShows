"""
Management command to backfill theme songs for anime.
Useful when themes weren't fetched during initial import or when fixing theme sync issues.
"""

from django.core.management.base import BaseCommand
from django.db.models import Count
from apps.animes.models import Anime
from apps.animes.tasks import sync_theme_songs
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Backfill theme songs for anime that are missing them"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum number of anime to process (default: 100)",
        )
        parser.add_argument(
            "--anime-id",
            type=int,
            help="Sync themes for a specific anime ID",
        )
        parser.add_argument(
            "--days",
            type=int,
            help="Only process anime created in the last N days",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Force re-sync even if anime already has themes",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be done without actually doing it",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        anime_id = options["anime_id"]
        days = options["days"]
        force = options["force"]
        dry_run = options["dry_run"]

        if anime_id:
            # Sync specific anime
            try:
                anime = Anime.objects.get(id=anime_id)
                self.stdout.write(f"Syncing themes for: {anime.title}")
                if not dry_run:
                    sync_theme_songs.delay(anime_id=anime_id)
                    self.stdout.write(
                        self.style.SUCCESS(f"Queued theme sync for anime ID {anime_id}")
                    )
                else:
                    self.stdout.write(f"[DRY RUN] Would queue theme sync for anime ID {anime_id}")
            except Anime.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"Anime with ID {anime_id} not found"))
                return
        else:
            # Get anime missing themes
            queryset = Anime.objects.filter(mal_id__isnull=False)

            if not force:
                # Only get anime without themes
                queryset = queryset.annotate(theme_count=Count("theme_songs")).filter(theme_count=0)

            if days:
                from django.utils import timezone
                from datetime import timedelta

                cutoff_date = timezone.now() - timedelta(days=days)
                queryset = queryset.filter(created_at__gte=cutoff_date)
                self.stdout.write(f"Processing anime created in the last {days} days")

            anime_list = queryset[:limit]
            count = anime_list.count()

            if count == 0:
                self.stdout.write(self.style.SUCCESS("No anime need theme sync!"))
                return

            self.stdout.write(f"Found {count} anime to sync themes for")

            if dry_run:
                self.stdout.write("\n[DRY RUN] Anime that would be processed:")
                for anime in anime_list:
                    theme_count = anime.theme_songs.count() if hasattr(anime, "theme_songs") else 0
                    self.stdout.write(
                        f"  - {anime.title} (ID: {anime.id}, MAL ID: {anime.mal_id}, Current themes: {theme_count})"
                    )
            else:
                # Queue theme sync tasks
                queued = 0
                for anime in anime_list:
                    sync_theme_songs.delay(anime_id=anime.id)
                    queued += 1
                    if queued % 10 == 0:
                        self.stdout.write(f"Queued {queued}/{count} anime...")

                self.stdout.write(
                    self.style.SUCCESS(f"\nSuccessfully queued theme sync for {queued} anime!")
                )
                self.stdout.write(
                    "Themes will be fetched in the background. Check Celery logs for progress."
                )
