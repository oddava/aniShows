from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone as tz

from apps.animes.models import Anime
from apps.shared.logger import logger
from apps.users.models import UserActivity, UserAnimeList
from apps.users.services.cache import invalidate_user_caches
from apps.users.services.stats_service import create_or_update_user_stats

User = get_user_model()


def _user_exists(user):
    if not user or not user.pk:
        return False
    return User.objects.filter(pk=user.pk).exists()


def update_user_stats_and_cache(user):
    if not user:
        return

    try:
        invalidate_user_caches(user.id, user.username)

        from apps.users.tasks import update_user_stats

        update_user_stats.apply_async(
            kwargs={"user_id": user.id},
            countdown=2,
            queue="default",
        )
        logger.debug("Invalidated cache and queued stats update for user %s", user.username)
    except Exception as exc:
        try:
            create_or_update_user_stats(user)
            invalidate_user_caches(user.id, user.username)
        except Exception:
            pass
        logger.exception("Failed to update stats for user %s: %s", user.username, exc)


def invalidate_heatmap_cache(user_id):
    from apps.users.services.cache import get_user_heatmap_cache_key

    cache_key = get_user_heatmap_cache_key(user_id)
    cache.delete(cache_key)
    logger.debug("Invalidated heatmap cache for user %s", user_id)


def update_anime_status_distribution(anime_id):
    if not anime_id:
        return

    distribution = UserAnimeList.objects.filter(anime_id=anime_id).aggregate(
        watching=Count(
            "id",
            filter=Q(status=UserAnimeList.UserAnimeStatus.watching),
        ),
        completed=Count(
            "id",
            filter=Q(status=UserAnimeList.UserAnimeStatus.completed),
        ),
        on_hold=Count(
            "id",
            filter=Q(status=UserAnimeList.UserAnimeStatus.on_hold),
        ),
        dropped=Count(
            "id",
            filter=Q(status=UserAnimeList.UserAnimeStatus.dropped),
        ),
        plan_to_watch=Count(
            "id",
            filter=Q(status=UserAnimeList.UserAnimeStatus.plan_to_watch),
        ),
    )
    normalized_distribution = {
        key: int(distribution.get(key, 0) or 0)
        for key in ("watching", "completed", "on_hold", "dropped", "plan_to_watch")
    }

    try:
        anime = Anime.objects.get(pk=anime_id)
    except Anime.DoesNotExist:
        return

    if anime.status_distribution != normalized_distribution:
        anime.status_distribution = normalized_distribution
        anime.save(update_fields=["status_distribution"])


def _create_activity_deduped(**kwargs):
    user = kwargs.get("user")
    if not _user_exists(user):
        return

    cutoff = tz.now() - timedelta(seconds=2)
    dedupe_fields = {
        "old_status": kwargs.get("old_status"),
        "new_status": kwargs.get("new_status"),
        "old_episodes": kwargs.get("old_episodes"),
        "new_episodes": kwargs.get("new_episodes"),
        "old_score": kwargs.get("old_score"),
        "new_score": kwargs.get("new_score"),
        "notes": kwargs.get("notes", ""),
    }

    if UserActivity.objects.filter(
        user=user,
        anime=kwargs["anime"],
        activity_type=kwargs["activity_type"],
        created_at__gte=cutoff,
        **dedupe_fields,
    ).exists():
        logger.debug(
            "Skipping duplicate activity %s for user %s",
            kwargs["activity_type"],
            kwargs["user"].username,
        )
        return

    try:
        UserActivity.objects.create(**kwargs)
    except IntegrityError:
        logger.debug("Skipping activity creation for deleted user", exc_info=True)


def build_user_activity_kwargs(instance, *, created: bool):
    if created:
        activity_type = UserActivity.ActivityType.ADDED
        if instance.status == UserAnimeList.UserAnimeStatus.completed:
            activity_type = UserActivity.ActivityType.COMPLETED

        return {
            "user": instance.user,
            "anime": instance.anime,
            "activity_type": activity_type,
            "new_status": instance.status,
            "new_episodes": instance.episodes_watched,
            "new_score": instance.score if instance.score else None,
            "notes": instance.notes or "",
        }

    old_status = getattr(instance, "_old_status", None)
    old_episodes = getattr(instance, "_old_episodes", None)
    old_is_rewatching = getattr(instance, "_old_is_rewatching", None)

    if instance.is_rewatching and not old_is_rewatching:
        return {
            "user": instance.user,
            "anime": instance.anime,
            "activity_type": UserActivity.ActivityType.REWATCHING,
            "old_status": old_status,
            "new_status": instance.status,
            "old_episodes": old_episodes,
            "new_episodes": instance.episodes_watched,
            "notes": instance.notes or "",
        }
    if (
        instance.status == UserAnimeList.UserAnimeStatus.completed
        and old_status != UserAnimeList.UserAnimeStatus.completed
    ):
        return {
            "user": instance.user,
            "anime": instance.anime,
            "activity_type": UserActivity.ActivityType.COMPLETED,
            "old_status": old_status,
            "new_status": instance.status,
            "old_episodes": old_episodes,
            "new_episodes": instance.episodes_watched,
            "new_score": instance.score if instance.score else None,
            "notes": instance.notes or "",
        }
    if old_status and instance.status != old_status:
        return {
            "user": instance.user,
            "anime": instance.anime,
            "activity_type": UserActivity.ActivityType.STATUS_CHANGE,
            "old_status": old_status,
            "new_status": instance.status,
            "notes": instance.notes or "",
        }
    if old_episodes is not None and instance.episodes_watched != old_episodes:
        return {
            "user": instance.user,
            "anime": instance.anime,
            "activity_type": UserActivity.ActivityType.PROGRESS,
            "old_episodes": old_episodes,
            "new_episodes": instance.episodes_watched,
            "notes": instance.notes or "",
        }
    return None


def log_user_activity(instance, *, created: bool):
    if not instance or not instance.user or getattr(instance, "_skip_activity", False):
        return

    activity_kwargs = build_user_activity_kwargs(instance, created=created)
    if not activity_kwargs:
        return

    transaction.on_commit(lambda kw=activity_kwargs: _create_activity_deduped(**kw))
    transaction.on_commit(lambda: invalidate_heatmap_cache(instance.user.id))


def log_user_activity_on_delete(instance):
    if not instance or not instance.user or getattr(instance, "_skip_activity", False):
        return
    if not _user_exists(instance.user):
        return

    activity_kwargs = {
        "user": instance.user,
        "anime": instance.anime,
        "activity_type": UserActivity.ActivityType.REMOVED,
        "old_status": instance.status,
        "notes": instance.notes or "",
    }
    transaction.on_commit(lambda kw=activity_kwargs: _create_activity_deduped(**kw))
    transaction.on_commit(lambda: invalidate_heatmap_cache(instance.user.id))


def schedule_recommendations_debounced(user_id, *, task, countdown=300):
    cache_key = f"reco_pending:{user_id}"
    if cache.get(cache_key):
        logger.debug(
            "Skipping duplicate recommendation task for user %s (already scheduled within %ss window)",
            user_id,
            countdown,
        )
        return

    cache.set(cache_key, True, timeout=countdown + 30)

    task.apply_async(
        kwargs={"user_id": user_id},
        countdown=countdown,
    )
    logger.debug("Scheduled recommendation generation for user %s in %ss", user_id, countdown)


def handle_user_anime_list_change(instance, *, schedule_recommendations):
    if not instance or not instance.user or getattr(instance, "_skip_activity", False):
        return
    if not _user_exists(instance.user):
        return

    logger.info(
        "User %s updated anime list. Updating stats and triggering recommendations.",
        instance.user.username,
    )
    update_user_stats_and_cache(instance.user)
    schedule_recommendations(instance.user.id, countdown=300)
    transaction.on_commit(
        lambda anime_id=instance.anime_id: update_anime_status_distribution(anime_id)
    )


def handle_user_favorite_change(instance, *, schedule_recommendations):
    if not instance or not instance.user:
        return
    if not _user_exists(instance.user):
        return

    logger.info(
        "User %s updated favorites. Updating stats and triggering recommendations.",
        instance.user.username,
    )
    update_user_stats_and_cache(instance.user)
    schedule_recommendations(instance.user.id, countdown=120)


def handle_review_change(instance):
    if not instance or not instance.user:
        return
    if not _user_exists(instance.user):
        return

    logger.info("User %s updated reviews. Updating stats.", instance.user.username)
    update_user_stats_and_cache(instance.user)
