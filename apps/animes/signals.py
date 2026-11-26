from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from ..shared.public_cache import invalidate_public_cache_keys
from ..users.models import UserAnimeList
from .adult_content import drop_public_caches_or_keep_for_replay
from .catalog.hooks import in_bulk_catalog_write, request_hydrate
from .models import Anime, Genre, Review, Studio, UserFavorite
from .services.public_anime_service import AnimePublicPayloadService, invalidate_anime_detail
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
    generate_recommendations,
    sync_watch_episodes_for_anime,
)


def _watch_episode_auto_sync_enabled() -> bool:
    return settings.ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED


def _queue_watch_episode_sync(anime_id: int, *, force: bool = False) -> None:
    sync_watch_episodes_for_anime.apply_async(kwargs={"anime_id": anime_id, "force": force})


def _schedule_recommendations_debounced(user_id, countdown=300):
    schedule_recommendations_debounced(user_id, task=generate_recommendations, countdown=countdown)


def _invalidate_anime_public_caches(slug: str, *, bump_namespace: bool = True) -> None:
    """Drop ``slug``'s cached detail payload and, unless told not to, every collection.

    Every list, shelf, browse-rows, schedule, related and recommendations key
    carries the collection namespace, so the bump is what invalidates those.
    Runs now; the receivers below defer it to the commit.
    """
    if bump_namespace:
        AnimePublicPayloadService.bump_collection_cache_namespace()
    invalidate_anime_detail(slug)


def _invalidate_browse_filter_cache(
    cache_key: str, *, bump_namespace: bool = True, using: str | None = None
) -> None:
    """After the commit, drop a filter-option list (and, unless told not to, every collection).

    Cards show genre and studio names, so a rename or delete reaches every
    collection; a new genre or studio is on no card yet.
    """

    def invalidate() -> None:
        if bump_namespace:
            AnimePublicPayloadService.bump_collection_cache_namespace()
        invalidate_public_cache_keys(cache_key)

    transaction.on_commit(invalidate, using=using)


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
    """A row created one at a time (a list import, an admin) asks for its details.

    Queued for the details lane, not fetched here: it batches 25 titles per request.
    Rows a catalog lane creates in bulk are left to that lane's own priorities.
    """
    if not created or not settings.ANIME_METADATA_AUTO_ENRICH_ENABLED:
        return
    if in_bulk_catalog_write() or instance.hydrated_at:
        return
    anime_id = instance.id
    transaction.on_commit(lambda: request_hydrate([anime_id]))


@receiver(post_save, sender=Anime)
def trigger_watch_episode_sync(sender, instance, created, **kwargs):
    old_identity = getattr(instance, "_old_watch_sync_identity", None) or {}
    identity_changed = created or any(
        old_identity.get(field) != getattr(instance, field)
        for field in ("title", "slug", "mal_id", "anilist_id")
    )

    if old_identity.get("updated_at") and identity_changed:
        AnimeWatchEpisodeService.invalidate_for_anime_version(
            instance.id, old_identity["updated_at"]
        )

    if not _watch_episode_auto_sync_enabled() or in_bulk_catalog_write():
        return
    if not identity_changed or not (instance.mal_id or instance.anilist_id):
        return

    transaction.on_commit(lambda: _queue_watch_episode_sync(instance.id, force=not created))


@receiver(post_save, sender=Anime)
def invalidate_anime_detail_cache(sender, instance, update_fields=None, using=None, **kwargs):
    """After the commit, drop what the save changed (B2).

    A save of detail-only fields (a list change recounting ``status_distribution``,
    a synopsis fix) drops that anime's detail payload; any other save also bumps
    the collection namespace. Deferred so a reader cannot cache the old row again
    between the invalidation and the commit.
    """
    detail_only = bool(update_fields) and (
        set(update_fields) <= AnimePublicPayloadService.DETAIL_ONLY_FIELDS
    )
    slugs = {instance.slug}
    # A renamed slug leaves its old detail payload behind (pre_save captured it).
    old_slug = (getattr(instance, "_old_watch_sync_identity", None) or {}).get("slug")
    if old_slug:
        slugs.add(old_slug)

    def invalidate() -> None:
        # A cache error keeps the slugs for a replay (a save can flag a title
        # adult: AniList's isAdult), then still raises.
        drop_public_caches_or_keep_for_replay(slugs, bump_namespace=not detail_only, using=using)

    transaction.on_commit(invalidate, using=using)


@receiver(post_delete, sender=Anime)
def invalidate_deleted_anime_detail_cache(sender, instance, using=None, **kwargs):
    slug = instance.slug
    transaction.on_commit(
        lambda: drop_public_caches_or_keep_for_replay([slug], using=using), using=using
    )
    AnimeWatchEpisodeService().invalidate_for_anime(instance)


@receiver([post_save, post_delete], sender=Genre)
def invalidate_genre_cache(sender, instance, created=False, using=None, **kwargs):
    _invalidate_browse_filter_cache("anime_genres:v1", bump_namespace=not created, using=using)


@receiver([post_save, post_delete], sender=Studio)
def invalidate_studio_cache(sender, instance, created=False, using=None, **kwargs):
    # ``StudioViewSet.CACHE_KEY`` (signals must not import the views).
    _invalidate_browse_filter_cache("anime_studios:v2", bump_namespace=not created, using=using)


@receiver(pre_save, sender=UserAnimeList)
def capture_old_anime_list_state(sender, instance, **kwargs):
    if instance.pk:
        try:
            old = UserAnimeList.objects.get(pk=instance.pk)
            instance._old_status = old.status
            instance._old_episodes = old.episodes_watched
            instance._old_score = old.score
            instance._old_is_rewatching = old.is_rewatching
            instance._old_total_rewatches = old.total_rewatches
            instance._old_notes = old.notes
        except UserAnimeList.DoesNotExist:
            instance._old_status = None
            instance._old_episodes = None
            instance._old_score = None
            instance._old_is_rewatching = None
            instance._old_total_rewatches = None
            instance._old_notes = None
    else:
        instance._old_status = None
        instance._old_episodes = None
        instance._old_score = None
        instance._old_is_rewatching = None
        instance._old_total_rewatches = None
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


# --- G5 Community: review stats cache (spec 5 P1-7) ---------------------------

from .services.reviews import invalidate_review_stats


def _review_anime_slug(review: Review) -> str | None:
    if Review.anime.is_cached(review):
        return review.anime.slug
    return Anime.objects.filter(pk=review.anime_id).values_list("slug", flat=True).first()


@receiver([post_save, post_delete], sender=Review)
def invalidate_review_stats_cache(sender, instance, **kwargs):
    anime_slug = _review_anime_slug(instance)
    if anime_slug:
        transaction.on_commit(lambda: invalidate_review_stats(anime_slug))
