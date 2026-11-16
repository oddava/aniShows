"""Rebuild every user's points from the votes on their reviews.

Points semantics: ``apps/users/services/points_service.py``.

Usage:
    python manage.py backfill_points [--dry-run] [--batch-size 500]
"""

from django.core.management.base import BaseCommand

from ...services.points_service import (
    BACKFILL_BATCH_SIZE,
    backfill_all_points,
    iter_points_changes,
)


class Command(BaseCommand):
    help = "Backfill points for all users based on their existing review votes"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be updated without making changes",
        )
        parser.add_argument("--batch-size", type=int, default=BACKFILL_BATCH_SIZE)

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        self.stdout.write("Calculating points for all users...")

        if not options["dry_run"]:
            updated = backfill_all_points(batch_size=batch_size)
            self.stdout.write(self.style.SUCCESS(f"\nSuccessfully updated {updated} users"))
            return

        pending = 0
        for changes in iter_points_changes(batch_size):
            for change in changes:
                self.stdout.write(
                    f"  [DRY RUN] {change.username}: {change.old_points} -> {change.new_points}"
                )
            pending += len(changes)
        self.stdout.write(self.style.WARNING(f"\n[DRY RUN] Would update {pending} users"))
