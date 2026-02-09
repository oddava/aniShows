from django.core.management.base import BaseCommand
from anime.tasks import backfill_airing_dates


class Command(BaseCommand):
    help = "Backfills next_airing_date for airing anime that are missing it"

    def handle(self, *args, **options):
        self.stdout.write("Triggering backfill of missing airing dates...")
        task = backfill_airing_dates.delay()
        self.stdout.write(
            self.style.SUCCESS(
                f"Backfill task started in background. Task ID: {task.id}"
            )
        )
        self.stdout.write("Use 'make celery-logs' to monitor progress.")
        self.stdout.write("")
        self.stdout.write(
            "This will fetch fresh data from AniList for all airing anime "
            "missing next_airing_date."
        )
