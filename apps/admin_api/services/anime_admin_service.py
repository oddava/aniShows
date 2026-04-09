from dataclasses import dataclass

from django.db import transaction
from django.db.models import Avg, Count

from ...animes.models import Anime, Character, Genre, OfflineAnimeSyncState, Staff, Studio
from ...animes.services.offline_sync import OfflineSyncService


@dataclass(slots=True)
class AdminAnimeActionResult:
    payload: dict
    status_code: int


def get_admin_anime_queryset():
    return Anime.objects.prefetch_related("genres").select_related("studio").annotate(
        favorites_count=Count("favorites"),
        reviews_count=Count("reviews"),
        avg_review_rating=Avg("reviews__rating"),
    )


def get_admin_genre_queryset():
    return Genre.objects.annotate(anime_count=Count("anime")).order_by("name")


def apply_default_genre_slug(serializer):
    name = serializer.validated_data.get("name")
    slug = serializer.validated_data.get("slug")
    if not slug and name:
        serializer.validated_data["slug"] = name.lower().replace(" ", "-")


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
    if stage in {"metadata", "franchise", "themes"} and stage_status:
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
                    payload={"detail": f"AniList ID {anilist_id} already belongs to anime #{conflict.id}."},
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
