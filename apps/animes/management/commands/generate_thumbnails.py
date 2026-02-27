"""
Pre-generate all ImageKit thumbnails for Anime, Character, and Staff models.

This ensures all thumbnails exist in S3/MinIO storage so the first page load
is fast. The generation is idempotent — already-generated thumbnails are
skipped via Redis cache check (sub-millisecond).

Usage:
    docker compose exec web uv run python manage.py generate_thumbnails
    docker compose exec web uv run python manage.py generate_thumbnails --model anime
    docker compose exec web uv run python manage.py generate_thumbnails --dry-run
"""

import time
from django.core.management.base import BaseCommand
from imagekit.cachefiles import ImageCacheFile

from apps.animes.models import Anime, Character, Staff


# Map of model -> (source_field, [spec_field_names])
MODEL_SPECS = {
    "anime": (
        Anime,
        "cover_image",
        ["cover_image_small", "cover_image_medium", "cover_image_large"],
    ),
    "anime_banner": (
        Anime,
        "banner_image",
        ["banner_image_small", "banner_image_medium", "banner_image_large"],
    ),
    "character": (
        Character,
        "image",
        ["image_small", "image_medium"],
    ),
    "staff": (
        Staff,
        "image",
        ["image_small", "image_medium"],
    ),
}


class Command(BaseCommand):
    help = "Pre-generate all ImageKit thumbnails for Anime, Character, and Staff models"

    def add_arguments(self, parser):
        parser.add_argument(
            "--model",
            type=str,
            choices=["anime", "character", "staff", "all"],
            default="all",
            help="Which model to generate thumbnails for (default: all)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be generated without actually generating",
        )

    def handle(self, *args, **options):
        model_filter = options["model"]
        dry_run = options["dry_run"]

        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN — no thumbnails will be generated\n"))

        total_generated = 0
        total_skipped = 0
        total_failed = 0
        start_time = time.time()

        for key, (model_class, source_field, spec_fields) in MODEL_SPECS.items():
            # Filter by model if specified
            if model_filter != "all":
                if model_filter == "anime" and key not in ("anime", "anime_banner"):
                    continue
                if model_filter == "character" and key != "character":
                    continue
                if model_filter == "staff" and key != "staff":
                    continue

            model_name = model_class.__name__
            self.stdout.write(f"\n{'=' * 50}")
            self.stdout.write(f"Processing {model_name} — {source_field}")
            self.stdout.write(f"{'=' * 50}")

            # Only fetch objects that have the source image
            queryset = model_class.objects.exclude(**{source_field: ""}).exclude(
                **{f"{source_field}__isnull": True}
            )

            count = queryset.count()
            self.stdout.write(f"Found {count} {model_name} objects with {source_field}")

            for i, obj in enumerate(queryset.iterator(), 1):
                obj_label = getattr(obj, "title", None) or getattr(obj, "name", str(obj))

                for spec_name in spec_fields:
                    spec = getattr(obj, spec_name, None)
                    if spec is None:
                        continue

                    if not isinstance(spec, ImageCacheFile):
                        continue

                    if dry_run:
                        self.stdout.write(
                            f"  [{i}/{count}] Would generate: {obj_label} -> {spec_name}"
                        )
                        total_generated += 1
                        continue

                    try:
                        spec.generate()
                        total_generated += 1
                    except Exception as e:
                        self.stdout.write(
                            self.style.ERROR(
                                f"  [{i}/{count}] FAILED: {obj_label} -> {spec_name}: {e}"
                            )
                        )
                        total_failed += 1
                        continue

                if not dry_run and i % 10 == 0:
                    self.stdout.write(f"  Processed {i}/{count}...")

            self.stdout.write(self.style.SUCCESS(f"  Done with {model_name} {source_field}"))

        elapsed = time.time() - start_time

        self.stdout.write(f"\n{'=' * 50}")
        self.stdout.write("SUMMARY")
        self.stdout.write(f"{'=' * 50}")
        self.stdout.write(self.style.SUCCESS(f"Generated: {total_generated}"))
        self.stdout.write(f"Skipped (no source): {total_skipped}")
        if total_failed:
            self.stdout.write(self.style.ERROR(f"Failed: {total_failed}"))
        self.stdout.write(f"Time: {elapsed:.1f}s")

        if dry_run:
            self.stdout.write(
                self.style.WARNING("\nThis was a dry run. Run without --dry-run to generate.")
            )
