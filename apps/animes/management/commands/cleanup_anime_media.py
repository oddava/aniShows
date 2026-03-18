"""
Find and clean up missing or unreadable anime media files.

Use this when S3/MinIO objects were pruned or failed to upload and the
database still points at broken files. The command will:
1) Detect cover/banner files that no longer exist (or can't be read).
2) Optionally delete the broken references from the database so API
   responses fall back to external URLs.
3) Optionally queue a fresh image download for each cleaned anime.

Examples:
    # Dry run – report only
    uv run python manage.py cleanup_anime_media --dry-run

    # Remove broken references and requeue downloads
    uv run python manage.py cleanup_anime_media --queue-fetch
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.animes.models import Anime
from apps.animes.tasks.images import _queue_image_fetch
from apps.shared.logger import logger

MEDIA_FIELDS = {
    "cover_image": ["cover_image_small", "cover_image_medium", "cover_image_large"],
    "banner_image": ["banner_image_small", "banner_image_medium", "banner_image_large"],
}


class Command(BaseCommand):
    help = "Clean up Anime media fields that point to missing or unreadable files"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Inspect only the first N anime (ordered by id desc)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report findings without modifying the database",
        )
        parser.add_argument(
            "--queue-fetch",
            action="store_true",
            help="After clearing broken media, queue a fresh image fetch task",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        dry_run = options["dry_run"]
        queue_fetch = options["queue_fetch"]

        queryset = Anime.objects.order_by("-id")
        if limit:
            queryset = queryset[:limit]

        inspected = 0
        cleaned = 0
        queued = 0
        storage_errors = 0

        for anime in queryset.iterator():
            inspected += 1
            cleaned_fields: list[str] = []
            storage_unreadable = False

            for field_name in MEDIA_FIELDS:
                image_field = getattr(anime, field_name, None)
                if not image_field:
                    continue

                try:
                    exists = image_field.storage.exists(image_field.name)
                except Exception as exc:  # noqa: BLE001
                    storage_unreadable = True
                    storage_errors += 1
                    logger.warning(
                        "Storage check failed for %s (%s): %s",
                        anime.title,
                        field_name,
                        exc,
                    )
                    continue

                if not exists:
                    cleaned_fields.append(field_name)

            if not cleaned_fields:
                continue

            cleaned += 1
            fields_for_update: list[str] = []

            msg_prefix = f"[{anime.id}] {anime.title}"
            self.stdout.write(
                self.style.WARNING(
                    f"{msg_prefix}: clearing missing {', '.join(cleaned_fields)}"
                )
            )

            if dry_run:
                continue

            for field_name in cleaned_fields:
                image_field = getattr(anime, field_name, None)
                if image_field:
                    # Remove broken reference without raising if file is already gone.
                    image_field.delete(save=False)
                    setattr(anime, field_name, None)
                    fields_for_update.append(field_name)

                    # Try to delete derived thumbnails; ignore failures.
                    for spec_name in MEDIA_FIELDS[field_name]:
                        spec = getattr(anime, spec_name, None)
                        spec_name_value = getattr(spec, "name", None)
                        if spec and spec_name_value:
                            try:
                                spec.storage.delete(spec_name_value)
                            except Exception:  # noqa: BLE001
                                pass

            if fields_for_update:
                anime.save(update_fields=fields_for_update)

            if queue_fetch and not storage_unreadable:
                cover_url = anime.cover_image_external_url or ""
                banner_url = anime.banner_image_external_url or ""
                # Only queue if we have something to fetch.
                if cover_url or banner_url or anime.mal_id:
                    queued += 1 if _queue_image_fetch(
                        anime_id=anime.id,
                        cover_url=cover_url,
                        banner_url=banner_url,
                        mal_id=anime.mal_id,
                        force=True,
                    ) else 0

        self.stdout.write("\n---- SUMMARY ----")
        self.stdout.write(f"Inspected: {inspected}")
        self.stdout.write(f"Cleared:   {cleaned}")
        self.stdout.write(f"Queued:    {queued if queue_fetch else 0}")
        if storage_errors:
            self.stdout.write(
                self.style.WARNING(
                    f"Storage errors during exists() checks: {storage_errors}"
                )
            )
