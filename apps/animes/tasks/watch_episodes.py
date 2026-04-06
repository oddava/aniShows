from django.db.models import Q

from apps.animes.models import Anime
from apps.animes.services.watch_episodes import AnimeWatchEpisodeService
from apps.shared.celery import observed_shared_task
from apps.shared.logger import logger

from .base import BaseTask


class WatchEpisodeSyncTask(BaseTask):
    """Warm watch-episode cache for a single anime."""

    enable_deduplication = True
    idempotency_ttl = 60 * 30

    def execute(self, anime_id: int, force: bool = False):
        self.metrics.start()

        try:
            anime = Anime.public_queryset().get(id=anime_id)
        except Anime.DoesNotExist:
            return {
                "anime_id": anime_id,
                "status": "not_found",
                "episodes": 0,
            }

        if not (anime.mal_id or anime.anilist_id):
            return {
                "anime_id": anime.id,
                "title": anime.title,
                "status": "missing_ids",
                "episodes": 0,
            }

        service = AnimeWatchEpisodeService()

        try:
            if force:
                service.invalidate_for_anime(anime)

            episodes = service.get_for_anime(anime)
        except Exception as exc:
            logger.error(
                "Watch episode sync failed for anime %s",
                anime.id,
                exc_info=True,
            )
            raise self.retry(exc=exc, countdown=60)

        self.metrics.record_records(len(episodes))
        return {
            "anime_id": anime.id,
            "title": anime.title,
            "status": "success" if episodes else "empty",
            "episodes": len(episodes),
            "forced": force,
        }


class WatchEpisodeBatchSyncTask(BaseTask):
    """Warm watch-episode caches for a batch of anime."""

    enable_deduplication = True
    idempotency_ttl = 60 * 10
    enable_locking = True
    lock_timeout = 60 * 60 * 2

    def execute(
        self,
        anime_ids: list[int] | None = None,
        statuses: list[str] | None = None,
        batch_size: int | None = None,
        force: bool = False,
    ):
        self.metrics.start()

        queryset = Anime.public_queryset().filter(
            Q(mal_id__isnull=False) | Q(anilist_id__isnull=False)
        )
        if anime_ids:
            queryset = queryset.filter(id__in=anime_ids)
        if statuses:
            queryset = queryset.filter(status__in=statuses)

        ordered_queryset = queryset.order_by("-member_count", "id")
        if batch_size:
            ordered_queryset = ordered_queryset[:batch_size]
        anime_list = list(ordered_queryset)

        service = AnimeWatchEpisodeService()
        warmed = 0
        empty = 0
        failed = 0
        processed_ids: list[int] = []
        failed_anime_ids: list[int] = []

        for anime in anime_list:
            processed_ids.append(anime.id)
            try:
                if force:
                    service.invalidate_for_anime(anime)

                episodes = service.get_for_anime(anime)
                if episodes:
                    warmed += 1
                    self.metrics.record_records(len(episodes))
                else:
                    empty += 1
            except Exception:
                failed += 1
                failed_anime_ids.append(anime.id)
                logger.error(
                    "Watch episode batch sync failed for anime %s",
                    anime.id,
                    exc_info=True,
                )

        return {
            "processed": len(anime_list),
            "warmed": warmed,
            "empty": empty,
            "failed": failed,
            "failed_anime_ids": failed_anime_ids,
            "forced": force,
            "statuses": statuses or [],
            "anime_ids": processed_ids,
        }


@observed_shared_task(
    base=WatchEpisodeSyncTask,
    retry_policy="external_api",
    time_limit=1800,
    soft_time_limit=1500,
)
def sync_watch_episodes_for_anime(self, anime_id: int, force: bool = False):
    return self.execute(anime_id=anime_id, force=force)


@observed_shared_task(
    base=WatchEpisodeBatchSyncTask,
    retry_policy="long",
    time_limit=7200,
    soft_time_limit=6900,
)
def sync_watch_episodes_batch(
    self,
    anime_ids: list[int] | None = None,
    statuses: list[str] | None = None,
    batch_size: int | None = None,
    force: bool = False,
):
    return self.execute(
        anime_ids=anime_ids,
        statuses=statuses,
        batch_size=batch_size,
        force=force,
    )
