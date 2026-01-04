from django.core.management.base import BaseCommand
from anime.tasks import backfill_metadata_task

class Command(BaseCommand):
    help = 'Backfills metadata for existing anime using a background Celery task'

    def handle(self, *args, **options):
        self.stdout.write("Triggering background metadata backfill...")
        task = backfill_metadata_task.delay()
        self.stdout.write(self.style.SUCCESS(f"Backfill task started in background. Task ID: {task.id}"))
        self.stdout.write("Use 'make celery-logs' to monitor progress.")
