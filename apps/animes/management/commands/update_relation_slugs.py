"""Management command to link anime relations to related anime imported since."""

from django.core.management.base import BaseCommand

from ...models import AnimeRelation
from ...services.relation_links import link_pending_relations


class Command(BaseCommand):
    help = "Link unlinked anime relations to local anime with a matching AniList or MAL ID"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only report how many relations are unlinked",
        )

    def handle(self, *args, **options):
        unlinked = AnimeRelation.objects.filter(to_anime__isnull=True).count()
        self.stdout.write(f"Found {unlinked} unlinked relations")
        if options.get("dry_run"):
            return

        linked = link_pending_relations()
        self.stdout.write(
            self.style.SUCCESS(f"Linked {linked}; {unlinked - linked} still point at unknown anime")
        )
