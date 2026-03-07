"""
Management command to populate UserStats for all users.
Run: python manage.py populate_user_stats
"""

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from apps.users.services.stats_service import create_or_update_user_stats
from apps.users.models import UserStats

User = get_user_model()

class Command(BaseCommand):
    help = "Populate UserStats for all users who do not have stats yet"

    def add_arguments(self, parser):
        parser.add_argument(
            "--all",
            action="store_true",
            help="Update stats for all users, even if they already have stats",
        )
        parser.add_argument(
            "--user",
            type=str,
            help="Update stats for a specific username only",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=100,
            help="Number of users to process in each batch (default: 100)",
        )

    def handle(self, *args, **options):
        update_all = options["all"]
        specific_user = options["user"]
        batch_size = options["batch_size"]

        if specific_user:
            # Update specific user
            try:
                user = User.objects.get(username=specific_user)
                self.stdout.write(f"Updating stats for {user.username}...")
                stats = create_or_update_user_stats(user)
                self.stdout.write(
                    self.style.SUCCESS(
                        f"✓ Updated: {stats.anime_count} anime, "
                        f"{stats.days_watched} days watched, "
                        f"{stats.reviews_count} reviews"
                    )
                )
            except User.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"User '{specific_user}' not found"))
            return

        # Get users to process
        if update_all:
            users = User.objects.all()
            self.stdout.write(f"Updating stats for ALL {users.count()} users...")
        else:
            # Only users without stats
            users = User.objects.filter(stats__isnull=True)
            count = users.count()
            if count == 0:
                self.stdout.write(
                    self.style.SUCCESS(
                        "All users already have stats! Use --all to update existing stats."
                    )
                )
                return
            self.stdout.write(f"Found {count} users without stats")

        # Process in batches
        processed = 0
        created = 0
        updated = 0
        errors = 0

        for user in users.iterator():
            try:
                stats = create_or_update_user_stats(user)

                # Check if this was a create or update
                if stats._state.adding:
                    created += 1
                else:
                    updated += 1

                processed += 1

                # Progress indicator
                if processed % 10 == 0:
                    self.stdout.write(f"  Progress: {processed} users processed...", ending="\r")

            except Exception as e:
                self.stdout.write(self.style.ERROR(f"\n✗ Failed for {user.username}: {e}"))
                errors += 1

        self.stdout.write("")  # New line after progress indicator

        # Summary
        self.stdout.write("\n" + "=" * 50)
        self.stdout.write("SUMMARY:")
        self.stdout.write(f"  Total processed: {processed}")
        self.stdout.write(f"  Created: {created}")
        self.stdout.write(f"  Updated: {updated}")
        if errors > 0:
            self.stdout.write(self.style.ERROR(f"  Errors: {errors}"))
        self.stdout.write("=" * 50)

        if errors == 0:
            self.stdout.write(self.style.SUCCESS("\n✓ All done!"))
        else:
            self.stdout.write(self.style.WARNING(f"\n⚠ Completed with {errors} errors"))
