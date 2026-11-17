"""Re-clean stored bios with the current sanitizer (G1 P1-6, A11).

Bios saved before the ``class`` allowlist may carry arbitrary classes. Run once
after deploy; it is idempotent, so running it again changes nothing.

Usage:
    python manage.py resanitize_bios [--dry-run] [--batch-size 500]
"""

from django.core.management.base import BaseCommand

from ...models import UserProfile
from ...serializers.accounts import sanitize_bio


class Command(BaseCommand):
    help = "Re-sanitize every stored bio with the current allowlist (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count changes, save nothing")
        parser.add_argument("--batch-size", type=int, default=500)

    def handle(self, *args, **options):
        dry_run: bool = options["dry_run"]
        batch_size: int = max(1, options["batch_size"])
        profiles = (
            UserProfile.objects.exclude(bio__isnull=True)
            .exclude(bio="")
            .only("id", "bio")
            .order_by("id")
            .iterator(chunk_size=batch_size)
        )

        scanned = changed = 0
        pending: list[UserProfile] = []
        for profile in profiles:
            scanned += 1
            cleaned = sanitize_bio(profile.bio)
            if cleaned == profile.bio:
                continue
            changed += 1
            profile.bio = cleaned
            pending.append(profile)
            if len(pending) >= batch_size:
                self._flush(pending, dry_run)
        self._flush(pending, dry_run)

        verb = "would change" if dry_run else "changed"
        self.stdout.write(self.style.SUCCESS(f"Scanned {scanned} bios, {verb} {changed}."))
        return None

    @staticmethod
    def _flush(pending: list[UserProfile], dry_run: bool) -> None:
        # bulk_update sends no post_save, so public-profile caches keep the old
        # bio until they expire (5 minutes); acceptable for a one-off cleanup.
        if pending and not dry_run:
            UserProfile.objects.bulk_update(pending, ["bio"])
        pending.clear()
