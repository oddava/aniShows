from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone as tz

from ...shared.errors import CACHE_ERRORS, ENQUEUE_ERRORS
from ...shared.logger import logger
from ...users.models import UserActivity, UserAnimeList
from ...users.services.cache import invalidate_user_caches
from ...users.services.list_service import invalidate_lists_summary
from ...users.services.stats_service import create_or_update_user_stats
from ...users.services.user_queryset import user_exists

User = get_user_model()


def update_user_stats_and_cache(user):
    if not user:
        return

    try:
        invalidate_user_caches(user.id, user.username, trigger_stats_update=False)

        from ...users.tasks import schedule_user_stats_refresh

        schedule_user_stats_refresh(
            user_id=user.id,
            countdown=2,
        )
        logger.debug("Invalidated cache and queued stats update for user %s", user.username)
    except ENQUEUE_ERRORS:
        # Cache or broker unavailable: refresh the stats inline instead.
        try:
            create_or_update_user_stats(user)
            invalidate_user_caches(user.id, user.username)
        except (DatabaseError, *CACHE_ERRORS):
            logger.warning("Inline stats refresh failed for user %s", user.username, exc_info=True)
        logger.exception("Failed to update stats for user %s", user.username)


def invalidate_heatmap_cache(user_id):
    from ...users.services.cache import get_user_heatmap_cache_key

    cache_key = get_user_heatmap_cache_key(user_id)
    cache.delete(cache_key)
    logger.debug("Invalidated heatmap cache for user %s", user_id)


SITE_STATUS_KEYS = ("watching", "completed", "on_hold", "dropped", "plan_to_watch")
SITE_STATUS_CACHE_TIMEOUT = 600
# A +1 within this window of the last +1 on the same anime extends that activity row.
PROGRESS_COALESCE_WINDOW = timedelta(minutes=30)


def site_status_cache_key(anime_id) -> str:
    return f"site_status:v1:{anime_id}"


def site_status_counts(anime_id) -> dict[str, int]:
    """How many aniShows users have ``anime_id`` in each list status (G3 contract for G2).

    One aggregate on ``UserAnimeList(anime_id, status)``, cached 10 minutes and dropped
    by every list change. ``Anime.status_distribution`` is left to the catalog provider
    (AniList's global counts, D-3); list writes never touch the Anime row.
    """
    empty = dict.fromkeys(SITE_STATUS_KEYS, 0)
    if not anime_id:
        return empty
    key = site_status_cache_key(anime_id)
    try:
        cached = cache.get(key)
    except CACHE_ERRORS:
        cached = None
    if cached is not None:
        return cached

    status = UserAnimeList.UserAnimeStatus
    aggregate = UserAnimeList.objects.filter(anime_id=anime_id).aggregate(
        watching=Count("id", filter=Q(status=status.watching)),
        completed=Count("id", filter=Q(status=status.completed)),
        on_hold=Count("id", filter=Q(status=status.on_hold)),
        dropped=Count("id", filter=Q(status=status.dropped)),
        plan_to_watch=Count("id", filter=Q(status=status.plan_to_watch)),
    )
    counts = {name: int(aggregate.get(name) or 0) for name in SITE_STATUS_KEYS}
    try:
        cache.set(key, counts, timeout=SITE_STATUS_CACHE_TIMEOUT)
    except CACHE_ERRORS:
        logger.warning("Could not cache site status counts for anime %s", anime_id, exc_info=True)
    return counts


def invalidate_site_status_counts(anime_ids) -> None:
    keys = [site_status_cache_key(anime_id) for anime_id in anime_ids if anime_id]
    if not keys:
        return
    try:
        cache.delete_many(keys)
    except CACHE_ERRORS:
        logger.warning("Could not drop site status counts", exc_info=True)


def _coalesce_progress(kwargs) -> bool:
    """Fold a +1 into the user's last PROGRESS row for the same anime (spec 3 P1-7).

    True when the activity was absorbed (updated or, when it nets to zero, removed),
    so binge clicks leave one feed row; the heatmap sum of episode diffs is unchanged.
    """
    now = tz.now()
    with transaction.atomic():
        latest = (
            UserActivity.objects.select_for_update()
            .filter(user=kwargs["user"], anime=kwargs["anime"])
            .order_by("-created_at", "-id")
            .first()
        )
        if (
            latest is None
            or latest.activity_type != UserActivity.ActivityType.PROGRESS
            or latest.created_at < now - PROGRESS_COALESCE_WINDOW
            or latest.created_at.date() != now.date()
        ):
            return False
        new_episodes = kwargs.get("new_episodes")
        if new_episodes == latest.old_episodes:
            latest.delete()
        else:
            latest.new_episodes = new_episodes
            latest.save(update_fields=["new_episodes"])
    return True


def _create_activity_deduped(**kwargs):
    user = kwargs.get("user")
    if not user_exists(user):
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
        if kwargs["activity_type"] == UserActivity.ActivityType.PROGRESS and _coalesce_progress(
            kwargs
        ):
            return
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
    if not user_exists(instance.user):
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
    # ``add`` is atomic: of two concurrent list changes only one schedules the task.
    if not cache.add(cache_key, True, timeout=countdown + 30):
        logger.debug(
            "Skipping duplicate recommendation task for user %s (already scheduled within %ss window)",
            user_id,
            countdown,
        )
        return

    task.apply_async(
        kwargs={"user_id": user_id},
        countdown=countdown,
    )
    logger.debug("Scheduled recommendation generation for user %s in %ss", user_id, countdown)


def handle_user_anime_list_change(instance, *, schedule_recommendations):
    if not instance or not instance.user or getattr(instance, "_skip_activity", False):
        return
    if not user_exists(instance.user):
        return

    logger.info(
        "User %s updated anime list. Updating stats and triggering recommendations.",
        instance.user.username,
    )
    update_user_stats_and_cache(instance.user)
    schedule_recommendations(instance.user.id, countdown=300)
    user_id, anime_id = instance.user.id, instance.anime_id

    def drop_derived_caches():
        # One key each, no namespace bump: the public collections stay cached.
        invalidate_site_status_counts([anime_id])
        invalidate_lists_summary(user_id)

    transaction.on_commit(drop_derived_caches)


def handle_user_favorite_change(instance, *, schedule_recommendations):
    if not instance or not instance.user:
        return
    if not user_exists(instance.user):
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
    if not user_exists(instance.user):
        return

    logger.info("User %s updated reviews. Updating stats.", instance.user.username)
    update_user_stats_and_cache(instance.user)
