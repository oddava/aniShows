from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.animes.models import Anime
from apps.animes.services.watch_episodes import AnimeWatchEpisodeService
from apps.animes.tasks import sync_watch_episodes_batch


class Command(BaseCommand):
    help = "Warm cached watch-episode payloads for existing anime detail pages"

    def add_arguments(self, parser):
        parser.add_argument(
            "--anime-id",
            type=int,
            help="Warm watch episodes for a specific anime ID",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Limit how many anime to process",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Invalidate any existing watch-episode cache before warming",
        )
        parser.add_argument(
            "--async",
            action="store_true",
            dest="run_async",
            help="Queue the warm operation as a Celery task",
        )
        parser.add_argument(
            "--queue",
            default=None,
            choices=[
                "critical",
                "high_priority",
                "default",
                "batch",
                "images",
                "notifications",
                "analytics",
                "low_priority",
            ],
            help="Optional queue override for async execution",
        )

    def handle(self, *args, **options):
        anime_id = options.get("anime_id")
        limit = options.get("limit")
        force = options.get("force", False)
        run_async = options.get("run_async", False)
        queue = options.get("queue")

        queryset = Anime.public_queryset().filter(
            Q(mal_id__isnull=False) | Q(anilist_id__isnull=False)
        )
        if anime_id:
            queryset = queryset.filter(id=anime_id)

        queryset = queryset.order_by("-member_count", "id")
        if limit:
            queryset = queryset[:limit]

        anime_list = list(queryset)
        total = len(anime_list)
        if total == 0:
            self.stdout.write(self.style.WARNING("No anime found for watch-episode warming."))
            return

        if run_async:
            task = sync_watch_episodes_batch.s(
                anime_ids=[anime.id for anime in anime_list],
                force=force,
            )
            kwargs = {"queue": queue} if queue else {}
            result = task.apply_async(**kwargs)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Queued watch-episode warm for {total} anime. Task ID: {result.id}"
                )
            )
            return

        service = AnimeWatchEpisodeService()
        warmed = 0
        empty = 0
        failed = 0

        self.stdout.write(f"Warming watch-episode cache for {total} anime...")

        for index, anime in enumerate(anime_list, start=1):
            try:
                if force:
                    service.invalidate_for_anime(anime)
                episodes = service.get_for_anime(anime)
                if episodes:
                    warmed += 1
                    message = f"[{index}/{total}] Warmed {len(episodes)} episodes for {anime.title}"
                    self.stdout.write(self.style.SUCCESS(message))
                else:
                    empty += 1
                    message = f"[{index}/{total}] No episode payload available for {anime.title}"
                    self.stdout.write(self.style.WARNING(message))
            except Exception as exc:
                failed += 1
                message = f"[{index}/{total}] Failed {anime.title}: {exc}"
                self.stdout.write(self.style.ERROR(message))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Warmed: {warmed}"))
        self.stdout.write(self.style.WARNING(f"Empty: {empty}"))
        self.stdout.write(self.style.ERROR(f"Failed: {failed}"))
