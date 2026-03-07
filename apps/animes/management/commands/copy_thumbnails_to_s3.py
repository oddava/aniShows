from apps.shared.logger import logger
"""
Copy existing ImageKit thumbnails from local CACHE to MinIO/S3 storage.

This script transfers thumbnails that were generated locally to the configured
remote storage (MinIO/S3) so they can be served properly.

Usage:
    docker compose exec web uv run python manage.py copy_thumbnails_to_s3
"""

import os
from pathlib import Path
from django.core.management.base import BaseCommand
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.conf import settings

class Command(BaseCommand):
    help = "Copy existing ImageKit thumbnails from local CACHE to MinIO/S3 storage"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be copied without actually copying",
        )
        parser.add_argument(
            "--delete-local",
            action="store_true",
            help="Delete local files after successful upload",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        delete_local = options["delete_local"]

        # Check if using S3/MinIO storage
        if not settings.USE_S3:
            self.stdout.write(
                self.style.WARNING(
                    "Not using S3/MinIO storage (USE_S3=False). "
                    "Thumbnails are already stored locally."
                )
            )
            return

        cache_dir = Path(settings.BASE_DIR) / "CACHE" / "images"

        if not cache_dir.exists():
            self.stdout.write(
                self.style.WARNING(f"CACHE directory not found: {cache_dir}")
            )
            return

        self.stdout.write(f"Scanning for thumbnails in: {cache_dir}")

        # Find all webp files in CACHE directory
        webp_files = list(cache_dir.rglob("*.webp"))

        if not webp_files:
            self.stdout.write(
                self.style.WARNING("No .webp files found in CACHE directory")
            )
            return

        self.stdout.write(f"Found {len(webp_files)} thumbnail files")

        uploaded = 0
        skipped = 0
        failed = 0

        for file_path in webp_files:
            # Calculate the relative path from CACHE/images
            relative_path = file_path.relative_to(cache_dir)
            storage_path = str(relative_path)

            # Check if file already exists in storage
            if default_storage.exists(storage_path):
                self.stdout.write(f"  Skip (exists): {storage_path}")
                skipped += 1
                if delete_local and not dry_run:
                    file_path.unlink()
                continue

            if dry_run:
                self.stdout.write(f"  Would upload: {storage_path}")
                uploaded += 1
                continue

            try:
                # Read local file and save to storage
                with open(file_path, "rb") as f:
                    content = f.read()

                # Wrap bytes in ContentFile - Django storage expects file-like object
                content_file = ContentFile(content)

                # Save to default storage (MinIO/S3)
                saved_path = default_storage.save(storage_path, content_file)

                self.stdout.write(self.style.SUCCESS(f"  Uploaded: {storage_path}"))
                uploaded += 1

                # Optionally delete local file
                if delete_local:
                    file_path.unlink()
                    self.stdout.write(f"    Deleted local file: {file_path}")

            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f"  Failed to upload {storage_path}: {e}")
                )
                failed += 1

        # Summary
        self.stdout.write("\n" + "=" * 50)
        self.stdout.write("UPLOAD SUMMARY")
        self.stdout.write("=" * 50)
        self.stdout.write(f"Total files: {len(webp_files)}")
        self.stdout.write(self.style.SUCCESS(f"Uploaded: {uploaded}"))
        self.stdout.write(f"Skipped (already exist): {skipped}")
        if failed > 0:
            self.stdout.write(self.style.ERROR(f"Failed: {failed}"))

        if dry_run:
            self.stdout.write(
                "\n"
                + self.style.WARNING(
                    "This was a dry run. No files were actually copied."
                )
            )
            self.stdout.write("Run without --dry-run to perform the actual copy.")