from django.conf import settings
from django.db import transaction
from django.db.models.signals import m2m_changed, post_delete, post_save, pre_delete, pre_save
from django.dispatch import receiver

from ..shared.public_cache import invalidate_public_cache_keys
from ..users.models import UserAnimeList
from .adult_content import ADULT_GENRE_SLUGS, refresh_adult_flags
from .models import Anime, Genre, Review, Studio, UserFavorite
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
    return settings.ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED


def _queue_watch_episode_sync(anime_id: int, *, force: bool = False) -> None:
    sync_watch_episodes_for_anime.apply_async(kwargs={"anime_id": anime_id, "force": force})


def _schedule_recommendations_debounced(user_id, countdown=300):
    schedule_recommendations_debounced(user_id, task=generate_recommendations, countdown=countdown)


def _invalidate_anime_public_caches(slug: str) -> None:
    current = AnimePublicPayloadService.PUBLIC_CACHE_VERSION
    AnimePublicPayloadService.bump_collection_cache_namespace()
    invalidate_public_cache_keys(
        f"anime_detail_base:{current}:{slug}",
        f"anime_detail_base:v6:{slug}",
        f"anime_detail_base:v5:{slug}",
        f"anime_detail_base:v4:{slug}",
        f"anime_detail_base:v3:{slug}",
        f"anime_detail_base:v2:{slug}",
        f"anime_detail_base:{slug}",
        *(
            f"{key}:adult:{flag}"
            for key in (
                f"anime_trending:{current}",
                f"anime_top_rated:{current}",
                f"anime_browse_rows:{current}",
                f"anime_related:{current}:{slug}",
                f"anime_recommendations:{current}:{slug}",
            )
            for flag in (0, 1)
        ),
        f"anime_related:v2:{slug}",
    )


def _invalidate_browse_filter_cache(cache_key: str) -> None:
    AnimePublicPayloadService.bump_collection_cache_namespace()
    invalidate_public_cache_keys(cache_key)


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
    if created and settings.ANIME_METADATA_AUTO_ENRICH_ENABLED:
        transaction.on_commit(lambda: enrich_metadata.delay(anime_id=instance.id, mode="single"))


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


@receiver([post_save, post_delete], sender=Genre)
def invalidate_genre_cache(sender, instance, **kwargs):
    _invalidate_browse_filter_cache("anime_genres:v1")


# --- Anime.is_adult (D5): genre changes re-derive the flag --------------------


def _adult_genre_anime_ids(genre, using) -> list[int]:
    return list(
        Anime.genres.through.objects.using(using)
        .filter(genre_id=genre.pk)
        .values_list("anime_id", flat=True)
    )


@receiver(m2m_changed, sender=Anime.genres.through)
def sync_adult_flag_on_genre_change(sender, instance, action, reverse, pk_set, using, **kwargs):
    if not reverse:  # anime.genres.add/remove/set/clear
        if action == "post_clear" or (
            action in ("post_add", "post_remove")
            and pk_set
            and Genre.objects.using(using)
            .filter(pk__in=pk_set, slug__in=ADULT_GENRE_SLUGS)
            .exists()
        ):
            refresh_adult_flags([instance.pk], using=using)
        return

    # genre.anime.add/remove/clear: only an adult genre changes any flag.
    if instance.slug not in ADULT_GENRE_SLUGS:
        return
    if action == "pre_clear":
        instance._adult_flag_anime_ids = _adult_genre_anime_ids(instance, using)
    elif action == "post_clear":
        refresh_adult_flags(getattr(instance, "_adult_flag_anime_ids", ()), using=using)
    elif action in ("post_add", "post_remove"):
        refresh_adult_flags(pk_set or (), using=using)


@receiver(pre_save, sender=Genre)
def capture_old_genre_slug(sender, instance, raw=False, using=None, **kwargs):
    instance._previous_slug = (
        Genre.objects.using(using).filter(pk=instance.pk).values_list("slug", flat=True).first()
        if instance.pk and not raw
        else None
    )


@receiver(post_save, sender=Genre)
def sync_adult_flag_on_genre_rename(sender, instance, created, raw=False, using=None, **kwargs):
    previous = getattr(instance, "_previous_slug", None)
    if created or raw or previous is None or previous == instance.slug:
        return
    if previous in ADULT_GENRE_SLUGS or instance.slug in ADULT_GENRE_SLUGS:
        refresh_adult_flags(_adult_genre_anime_ids(instance, using), using=using)


@receiver(pre_delete, sender=Genre)
def capture_adult_genre_anime(sender, instance, using=None, **kwargs):
    if instance.slug in ADULT_GENRE_SLUGS:
        # The cascade removes the links without an m2m_changed signal.
        instance._adult_flag_anime_ids = _adult_genre_anime_ids(instance, using)


@receiver(post_delete, sender=Genre)
def sync_adult_flag_on_genre_delete(sender, instance, using=None, **kwargs):
    refresh_adult_flags(getattr(instance, "_adult_flag_anime_ids", ()), using=using)


@receiver([post_save, post_delete], sender=Studio)
def invalidate_studio_cache(sender, instance, **kwargs):
    _invalidate_browse_filter_cache("anime_studios:v1")


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
