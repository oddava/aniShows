"""
Backfill external image URLs for existing anime.

This command fetches external image URLs from AniList for anime
that have anilist_id but no external image URLs stored.
"""

import asyncio
from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.anime.models import Anime
from apps.anime.services.anilist import AniListService


class Command(BaseCommand):
    help = "Backfill external image URLs for existing anime from AniList"

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=50,
            help="Number of anime to process in each batch (default: 50)",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Maximum number of anime to process (default: all)",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Force update even if external URLs already exist",
        )
        parser.add_argument(
            "--anilist-id",
            type=int,
            default=None,
            help="Process only a specific anime by AniList ID",
        )

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        limit = options["limit"]
        force = options["force"]
        anilist_id = options["anilist_id"]

        # Build query
        if anilist_id:
            queryset = Anime.objects.filter(anilist_id=anilist_id)
            self.stdout.write(f"Processing anime with AniList ID: {anilist_id}")
        else:
            # Find anime that need external URLs
            queryset = Anime.objects.filter(
                anilist_id__isnull=False,
            )

            if not force:
                queryset = queryset.filter(
                    Q(cover_image_external_url="")
                    | Q(cover_image_external_url__isnull=True)
                )

            self.stdout.write(f"Found {queryset.count()} anime to process")

        if limit:
            queryset = queryset[:limit]
            self.stdout.write(f"Limited to first {limit} anime")

        # Run async processing
        asyncio.run(self._process_anime(queryset, batch_size))

    async def _process_anime(self, queryset, batch_size):
        from asgiref.sync import sync_to_async

        service = AniListService(enable_caching=False, enable_rate_limiting=True)

        # Fetch list synchronously before entering async context
        anime_list = await sync_to_async(list)(queryset)
        total = len(anime_list)

        # Create sync wrapper for save
        async def save_anime(anime, fields):
            await sync_to_async(anime.save)(update_fields=fields)

        if total == 0:
            self.stdout.write(self.style.SUCCESS("No anime to process!"))
            return

        updated = 0
        failed = 0
        skipped = 0

        self.stdout.write(f"Processing {total} anime...")

        for i in range(0, total, batch_size):
            batch = anime_list[i : i + batch_size]

            for idx, anime in enumerate(batch, start=i + 1):
                try:
                    # Fetch from AniList
                    data = await service.get_anime_by_id(anime.anilist_id)

                    if not data:
                        self.stdout.write(
                            self.style.WARNING(
                                f"[{idx}/{total}] No data: {anime.title}"
                            )
                        )
                        failed += 1
                        continue

                    # Extract image URLs
                    cover_url = data.get("coverImage", {}).get(
                        "extraLarge"
                    ) or data.get("coverImage", {}).get("large")
                    banner_url = data.get("bannerImage")

                    # Update anime
                    needs_save = False

                    if cover_url and (
                        not anime.cover_image_external_url
                        or anime.cover_image_external_url != cover_url
                    ):
                        anime.cover_image_external_url = cover_url
                        needs_save = True

                    if banner_url and (
                        not anime.banner_image_external_url
                        or anime.banner_image_external_url != banner_url
                    ):
                        anime.banner_image_external_url = banner_url
                        needs_save = True

                    if needs_save:
                        await save_anime(
                            anime,
                            ["cover_image_external_url", "banner_image_external_url"],
                        )
                        updated += 1
                        self.stdout.write(
                            self.style.SUCCESS(
                                f"[{idx}/{total}] Updated: {anime.title}"
                            )
                        )
                    else:
                        skipped += 1

                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(
                            f"[{idx}/{total}] Error processing '{anime.title}': {e}"
                        )
                    )
                    failed += 1

            # Small delay between batches to respect rate limits
            if i + batch_size < total:
                await asyncio.sleep(1)

        await service.close()

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Updated: {updated}"))
        self.stdout.write(self.style.WARNING(f"Skipped: {skipped}"))
        self.stdout.write(self.style.ERROR(f"Failed: {failed}"))
        self.stdout.write(self.style.SUCCESS("Backfill complete!"))
