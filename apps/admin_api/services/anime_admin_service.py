from dataclasses import dataclass

from django.db import transaction
from django.db.models import Avg, Count, OuterRef, Subquery

from ...animes.models import (
    Anime,
    Character,
    Genre,
    OfflineAnimeSyncState,
    Review,
    Staff,
    Studio,
    UserFavorite,
)
from ...animes.services.offline_sync import OfflineSyncService
from ...core.models import AuditLog
from ...core.services.celery_admin_service import enqueue_tracked_task
from ...shared.errors import ENQUEUE_ERRORS
from ...shared.logger import logger
from ...users.models import UserAnimeList
from .audit import record_admin_action
from .query_helpers import related_count

METADATA_TASK = "apps.animes.tasks.metadata.enrich_metadata"
IMAGES_TASK = "apps.animes.tasks.images.fetch_anime_images"


class AnimeTaskError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class AdminAnimeActionResult:
    payload: dict
    status_code: int


def get_admin_anime_queryset(*, detail: bool = False):
    # Correlated subqueries: two joined Counts would multiply each other (A13).
    queryset = Anime.objects.prefetch_related("genres", Anime.studios_prefetch())
    if detail:
        queryset = queryset.select_related("offline_sync_state").annotate(
            list_entries_count=related_count(UserAnimeList, "anime")
        )
    return queryset.annotate(
        favorites_count=related_count(UserFavorite, "anime"),
        reviews_count=related_count(Review, "anime"),
        avg_review_rating=Subquery(
            Review.objects.filter(anime=OuterRef("pk"))
            .order_by()
            .values("anime")
            .annotate(avg=Avg("rating"))
            .values("avg")[:1]
        ),
    )


def get_admin_genre_queryset():
    return Genre.objects.annotate(anime_count=Count("anime")).order_by("name")


def delete_genre(genre, force) -> AdminAnimeActionResult:
    if genre.anime_count > 0 and not force:
        return AdminAnimeActionResult(
            payload={
                "detail": (
                    f"Cannot delete genre with {genre.anime_count} associated anime. "
                    "Use ?force=true to delete anyway."
                ),
                "anime_count": genre.anime_count,
            },
            status_code=400,
        )

    name = genre.name
    genre.delete()
    return AdminAnimeActionResult(
        payload={"message": f"Genre '{name}' deleted successfully."},
        status_code=200,
    )


def get_admin_studio_queryset():
    return Studio.objects.annotate(anime_count=Count("anime")).order_by("name")


def delete_studio(studio, force) -> AdminAnimeActionResult:
    if studio.anime_count > 0 and not force:
        return AdminAnimeActionResult(
            payload={
                "detail": (
                    f"Cannot delete studio with {studio.anime_count} associated anime. "
                    "Use ?force=true to delete anyway."
                ),
                "anime_count": studio.anime_count,
            },
            status_code=400,
        )

    name = studio.name
    studio.delete()
    return AdminAnimeActionResult(
        payload={"message": f"Studio '{name}' deleted successfully."},
        status_code=200,
    )


def get_admin_character_queryset():
    return Character.objects.annotate(anime_count=Count("animes", distinct=True))


def get_admin_staff_queryset():
    return Staff.objects.annotate(anime_count=Count("animes", distinct=True))


def get_admin_offline_sync_state_queryset(query_params, ordering):
    queryset = OfflineAnimeSyncState.objects.select_related("anime")
    quarantined = query_params.get("quarantined", "true").strip().lower()
    if quarantined in {"1", "true", "yes", "on"}:
        queryset = queryset.filter(quarantined=True)
    elif quarantined in {"0", "false", "no", "off"}:
        queryset = queryset.filter(quarantined=False)

    reason = query_params.get("reason")
    if reason:
        queryset = queryset.filter(quarantine_reason=reason)

    stage = query_params.get("stage")
    stage_status = query_params.get("status")
    if stage in {"metadata", "franchise"} and stage_status:
        queryset = queryset.filter(**{f"{stage}_status": stage_status})

    return queryset.order_by(*ordering)


def set_ids_and_retry(state, anilist_id, mal_id) -> AdminAnimeActionResult:
    if anilist_id is None and mal_id is None:
        return AdminAnimeActionResult(
            payload={"detail": "Provide at least one of anilist_id or mal_id."},
            status_code=400,
        )

    anime = state.anime
    with transaction.atomic():
        anime = Anime.objects.select_for_update().get(id=anime.id)

        if anilist_id is not None:
            conflict = Anime.objects.filter(anilist_id=anilist_id).exclude(id=anime.id).first()
            if conflict:
                return AdminAnimeActionResult(
                    payload={
                        "detail": f"AniList ID {anilist_id} already belongs to anime #{conflict.id}."
                    },
                    status_code=400,
                )
            anime.anilist_id = anilist_id

        if mal_id is not None:
            conflict = Anime.objects.filter(mal_id=mal_id).exclude(id=anime.id).first()
            if conflict:
                return AdminAnimeActionResult(
                    payload={"detail": f"MAL ID {mal_id} already belongs to anime #{conflict.id}."},
                    status_code=400,
                )
            anime.mal_id = mal_id

        anime.save(update_fields=["anilist_id", "mal_id", "updated_at"])

    OfflineSyncService().reset_for_retry(state)
    state.refresh_from_db()
    return AdminAnimeActionResult(payload={"state": state}, status_code=200)


def mark_merge_target(state, target_anime_id) -> AdminAnimeActionResult:
    if target_anime_id is None:
        return AdminAnimeActionResult(
            payload={"detail": "target_anime_id is required."},
            status_code=400,
        )

    if target_anime_id == state.anime_id:
        return AdminAnimeActionResult(
            payload={"detail": "target_anime_id must be different from current anime."},
            status_code=400,
        )

    if not Anime.objects.filter(id=target_anime_id).exists():
        return AdminAnimeActionResult(
            payload={"detail": f"Target anime #{target_anime_id} was not found."},
            status_code=404,
        )

    OfflineSyncService().mark_skipped(state, reason=f"merged_into:{target_anime_id}")
    OfflineAnimeSyncState.objects.filter(id=state.id).update(
        quarantine_context={
            "manual": True,
            "action": "merge_target",
            "target_anime_id": target_anime_id,
        }
    )
    state.refresh_from_db()
    return AdminAnimeActionResult(payload={"state": state}, status_code=200)


def _queue_anime_task(request, anime, *, task_path: str, kwargs: dict, operation: str) -> dict:
    try:
        job = enqueue_tracked_task(task_path=task_path, user=request.user, kwargs=kwargs)
    except ENQUEUE_ERRORS:
        logger.exception("Queueing an anime task failed", extra={"anime_id": anime.id})
        raise AnimeTaskError("Failed to queue the task.", 503) from None
    record_admin_action(
        request,
        action=AuditLog.ActionType.TRIGGER,
        entity_type="Anime",
        entity_id=anime.id,
        entity_repr=f"{operation}: {anime.title}",
        metadata={"operation": operation, "task": task_path, "task_id": job.task_id},
    )
    return {"task_id": job.task_id, "job_id": job.id}


def queue_anime_refresh(request, anime) -> dict:
    """Re-read this anime's metadata from AniList (the enrichment task, single mode)."""
    if not anime.anilist_id:
        raise AnimeTaskError("This anime has no AniList ID to refresh from.", 400)
    queued = _queue_anime_task(
        request,
        anime,
        task_path=METADATA_TASK,
        kwargs={"anime_id": anime.id, "mode": "single"},
        operation="refresh",
    )
    return {"message": f"Refresh of '{anime.title}' queued.", **queued}


def queue_anime_image_refetch(request, anime) -> dict:
    """Download the cover and banner again, replacing the stored files."""
    cover, banner = anime.cover_image_external_url, anime.banner_image_external_url
    if not cover and not banner:
        raise AnimeTaskError("This anime has no external image URLs.", 400)
    queued = _queue_anime_task(
        request,
        anime,
        task_path=IMAGES_TASK,
        kwargs={
            "anime_id": anime.id,
            "cover_url": cover or "",
            "banner_url": banner or "",
            "force_replace": True,
        },
        operation="refetch_images",
    )
    return {"message": f"Images of '{anime.title}' queued for download.", **queued}
