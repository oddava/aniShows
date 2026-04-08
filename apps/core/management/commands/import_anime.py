from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Legacy command removed. Anime catalog ingestion must not call AniList directly at runtime."
    )

    def handle(self, *args, **options):
        raise CommandError(
            "The legacy AniList-backed import command is disabled. "
            "Use `manage.py sync_anime` for local catalog refreshes or the offline catalog import "
            "workflow for ingesting catalog data."
        )
