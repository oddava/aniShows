from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from ..shared.public_cache import invalidate_public_cache_keys
from ..users.models import UserAnimeList
from .models import Anime, Review, UserFavorite
from .services.public_anime_service import AnimePublicPayloadService
from .services.user_list_side_effects import (
    handle_review_change as handle_review_change_service,
)
from .services.user_list_side_effects import (
    handle_user_anime_list_change as handle_user_anime_list_change_service,
)
from .services.user_list_side_effects import (
    handle_user_favorite_change as handle_user_favorite_change_service,
)
from .services.user_list_side_effects import (
    log_user_activity as log_user_activity_service,
)
from .services.user_list_side_effects import (
    log_user_activity_on_delete as log_user_activity_on_delete_service,
)
from .services.user_list_side_effects import (
    schedule_recommendations_debounced,
)
from .services.watch_episodes import AnimeWatchEpisodeService
from .tasks import (
    enrich_metadata,
    generate_recommendations,
    sync_watch_episodes_for_anime,
)


def _watch_episode_auto_sync_enabled() -> bool:
    return getattr(settings, "ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED", True)


def _queue_watch_episode_sync(anime_id: int, *, force: bool = False) -> None:
    sync_watch_episodes_for_anime.apply_async(kwargs={"anime_id": anime_id, "force": force})


def _schedule_recommendations_debounced(user_id, countdown=300):
    schedule_recommendations_debounced(user_id, task=generate_recommendations, countdown=countdown)


def _invalidate_anime_public_caches(slug: str) -> None:
    current = AnimePublicPayloadService.PUBLIC_CACHE_VERSION
    invalidate_public_cache_keys(
        f"anime_detail_base:{current}:{slug}",
        f"anime_detail_base:v6:{slug}",
        f"anime_detail_base:v5:{slug}",
        f"anime_detail_base:v4:{slug}",
        f"anime_detail_base:v3:{slug}",
        f"anime_detail_base:v2:{slug}",
        f"anime_detail_base:{slug}",
        f"anime_trending:{current}",
        f"anime_top_rated:{current}",
        f"anime_related:{current}:{slug}",
        f"anime_recommendations:{current}:{slug}",
        f"anime_related:v2:{slug}",
    )


@receiver(pre_save, sender=Anime)
def capture_old_anime_watch_identity(sender, instance, **kwargs):
    if not instance.pk:
        instance._old_watch_sync_identity = None
        return

    old = (
        Anime.objects.filter(pk=instance.pk)
        .only("title", "slug", "mal_id", "anilist_id", "updated_at")
        .first()
    )
    if old is None:
        instance._old_watch_sync_identity = None
        return

    instance._old_watch_sync_identity = {
        "title": old.title,
        "slug": old.slug,
        "mal_id": old.mal_id,
        "anilist_id": old.anilist_id,
        "updated_at": old.updated_at,
    }


@receiver(post_save, sender=Anime)
def trigger_metadata_fetch(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(lambda: enrich_metadata.delay(anime_id=instance.id, mode="single"))


@receiver(post_save, sender=Anime)
def trigger_watch_episode_sync(sender, instance, created, **kwargs):
    old_identity = getattr(instance, "_old_watch_sync_identity", None) or {}
    identity_changed = created or any(
        old_identity.get(field) != getattr(instance, field)
        for field in ("title", "slug", "mal_id", "anilist_id")
    )

    if old_identity.get("updated_at") and identity_changed:
        AnimeWatchEpisodeService.invalidate_for_anime_version(instance.id, old_identity["updated_at"])

    if not _watch_episode_auto_sync_enabled():
        return
    if not identity_changed or not (instance.mal_id or instance.anilist_id):
        return

    transaction.on_commit(lambda: _queue_watch_episode_sync(instance.id, force=not created))


@receiver(post_save, sender=Anime)
def invalidate_anime_detail_cache(sender, instance, **kwargs):
    _invalidate_anime_public_caches(instance.slug)


@receiver(post_delete, sender=Anime)
def invalidate_deleted_anime_detail_cache(sender, instance, **kwargs):
    _invalidate_anime_public_caches(instance.slug)
    AnimeWatchEpisodeService().invalidate_for_anime(instance)


@receiver(pre_save, sender=UserAnimeList)
def capture_old_anime_list_state(sender, instance, **kwargs):
    if instance.pk:
        try:
            old = UserAnimeList.objects.get(pk=instance.pk)
            instance._old_status = old.status
            instance._old_episodes = old.episodes_watched
            instance._old_score = old.score
            instance._old_is_rewatching = old.is_rewatching
            instance._old_notes = old.notes
        except UserAnimeList.DoesNotExist:
            instance._old_status = None
            instance._old_episodes = None
            instance._old_score = None
            instance._old_is_rewatching = None
            instance._old_notes = None
    else:
        instance._old_status = None
        instance._old_episodes = None
        instance._old_score = None
        instance._old_is_rewatching = None
        instance._old_notes = None


@receiver(post_save, sender=UserAnimeList)
def log_user_activity(sender, instance, created, **kwargs):
    log_user_activity_service(instance, created=created)


@receiver(post_delete, sender=UserAnimeList)
def log_user_activity_on_delete(sender, instance, **kwargs):
    log_user_activity_on_delete_service(instance)


@receiver([post_save, post_delete], sender=UserAnimeList)
def handle_user_anime_list_change(sender, instance, **kwargs):
    handle_user_anime_list_change_service(
        instance,
        schedule_recommendations=_schedule_recommendations_debounced,
    )


@receiver([post_save, post_delete], sender=UserFavorite)
def handle_user_favorite_change(sender, instance, **kwargs):
    handle_user_favorite_change_service(
        instance,
        schedule_recommendations=_schedule_recommendations_debounced,
    )


@receiver([post_save, post_delete], sender=Review)
def handle_review_change(sender, instance, **kwargs):
    handle_review_change_service(instance)
