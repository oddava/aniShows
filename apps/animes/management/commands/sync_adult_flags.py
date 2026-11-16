"""Re-read AniList's ``isAdult`` for the whole catalog (see ``apps/animes/adult_content.py``).

Run once after deploying the AniList-only adult rule (migration 0060 seeds the
flag from the Hentai genre; this replaces it with AniList's own value). The
weekly ``sync_adult_flags`` task does the same afterwards.
"""

from django.core.management.base import BaseCommand

from ...adult_content import sync_adult_flags_from_anilist


class Command(BaseCommand):
    help = "Set Anime.is_adult from AniList's Media.isAdult for every row with an AniList/MAL ID"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=None, help="Only the first N rows")

    def handle(self, *args, **options):
        totals = sync_adult_flags_from_anilist(limit=options.get("limit"))
        self.stdout.write(
            self.style.SUCCESS(
                f"Checked {totals['checked']} rows ({totals['payloads']} AniList payloads): "
                f"{totals['flagged']} newly adult, {totals['cleared']} cleared"
            )
        )
