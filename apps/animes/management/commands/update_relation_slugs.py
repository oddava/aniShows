"""Management command to add slugs to all anime relations.
This updates existing relations data to include the slug field for proper navigation.
"""

from django.core.management.base import BaseCommand

from ...models import Anime
from ...services.relation_links import find_related_anime, match_relation


class Command(BaseCommand):
    help = "Add slugs to all anime relations for proper navigation"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be updated without making changes",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)

        # Get all anime that have relations
        anime_with_relations = Anime.objects.exclude(relations__isnull=True).exclude(
            relations=[]
        )
        total = anime_with_relations.count()

        self.stdout.write(f"Found {total} anime with relations")

        updated_count = 0
        skipped_count = 0
        error_count = 0

        for anime in anime_with_relations:
            try:
                relations = anime.relations or []
                needs_update = False

                missing = [rel for rel in relations if not rel.get("slug")]
                found = find_related_anime(missing)
                for rel in missing:
                    related = match_relation(rel, found)
                    if related is None:
                        # Related anime not in database yet, skip
                        continue
                    rel["slug"] = related.slug
                    needs_update = True
                    if dry_run:
                        self.stdout.write(
                            f"Would update {anime.title} -> {rel.get('title')}: {related.slug}"
                        )

                if needs_update and not dry_run:
                    anime.relations = relations
                    anime.save(update_fields=["relations"])
                    updated_count += 1
                    self.stdout.write(f"✓ Updated: {anime.title}")
                elif not needs_update:
                    skipped_count += 1

            except Exception as e:
                error_count += 1
                self.stderr.write(f"✗ Error updating {anime.title}: {e}")

        if dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nDry run complete: Would update {updated_count} anime, skipped {skipped_count}, errors {error_count}"
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nComplete! Updated: {updated_count}, Skipped: {skipped_count}, Errors: {error_count}"
                )
            )
