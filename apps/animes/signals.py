from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone as tz

from apps.animes.tasks import enrich_metadata, generate_recommendations
from apps.core.services.notification_service import NotificationService
from apps.shared.logger import logger
from apps.users.models import UserActivity, UserAnimeList
from apps.users.services.cache import invalidate_user_caches
from apps.users.services.stats_service import create_or_update_user_stats

from .models import Anime, Review, ReviewComment, UserFavorite

User = get_user_model()


def _user_exists(user):
    """Check if a user still exists in the database (not mid-cascade-delete)."""
    if not user or not user.pk:
        return False
    return User.objects.filter(pk=user.pk).exists()


def update_user_stats_and_cache(user):
    """Update user stats asynchronously and invalidate caches immediately.
    Stats are offloaded to Celery to avoid blocking the request.
    Cache invalidation happens synchronously so stale data is never served.
    """
    if not user:
        return

    try:
        # Invalidate caches immediately so stale data is never served
        invalidate_user_caches(user.id, user.username)

        # Offload stats computation to Celery (non-blocking)
        from apps.users.tasks import update_user_stats

        update_user_stats.apply_async(
            kwargs={"user_id": user.id},
            countdown=2,  # Small delay to batch rapid updates
            queue="default",
        )

        logger.debug(f"Invalidated cache and queued stats update for user {user.username}")
    except Exception as e:
        # Fallback: try synchronous update if Celery is unavailable
        try:
            create_or_update_user_stats(user)
            invalidate_user_caches(user.id, user.username)
        except Exception:
            pass
        logger.exception(f"Failed to update stats for user {user.username}: {e}")


@receiver(post_save, sender=Anime)
def trigger_metadata_fetch(sender, instance, created, **kwargs):
    """Event-driven trigger: When a new Anime is created,
    automatically queue a low-priority task to fetch deep metadata (characters, staff).
    """
    if created:
        logger.info(
            f"New Anime created: {instance.title} (ID: {instance.id}). Triggering metadata fetch."
        )
        # This task routes to 'low_priority' queue via celery config
        enrich_metadata.delay(anime_id=instance.id, mode="single")


@receiver(post_save, sender=Anime)
def invalidate_anime_detail_cache(sender, instance, **kwargs):
    """Invalidate cached anime detail payload when anime fields change."""
    cache.delete(f"anime_detail_base:{instance.slug}")


@receiver(post_delete, sender=Anime)
def invalidate_deleted_anime_detail_cache(sender, instance, **kwargs):
    """Invalidate cached anime detail payload on delete."""
    cache.delete(f"anime_detail_base:{instance.slug}")


# =============================================================================
# ACTIVITY LOGGING SIGNALS
# =============================================================================


def invalidate_heatmap_cache(user_id):
    """Invalidate heatmap cache for a user when their activity changes."""
    from apps.users.services.cache import get_user_heatmap_cache_key

    cache_key = get_user_heatmap_cache_key(user_id)
    cache.delete(cache_key)
    logger.debug(f"Invalidated heatmap cache for user {user_id}")


@receiver(pre_save, sender=UserAnimeList)
def capture_old_anime_list_state(sender, instance, **kwargs):
    """Capture state before save for activity diff comparison."""
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


def _create_activity_deduped(**kwargs):
    """Create activity record with deduplication guard.

    Prevents duplicate activities within 2 seconds (e.g. from rapid auto-saves).
    """
    user = kwargs.get("user")
    if not _user_exists(user):
        return

    cutoff = tz.now() - timedelta(seconds=2)
    if UserActivity.objects.filter(
        user=user,
        anime=kwargs["anime"],
        activity_type=kwargs["activity_type"],
        created_at__gte=cutoff,
    ).exists():
        logger.debug(
            f"Skipping duplicate activity {kwargs['activity_type']} "
            f"for user {kwargs['user'].username}"
        )
        return

    try:
        UserActivity.objects.create(**kwargs)
    except IntegrityError:
        logger.debug("Skipping activity creation for deleted user", exc_info=True)


@receiver(post_save, sender=UserAnimeList)
def log_user_activity(sender, instance, created, **kwargs):
    """Create UserActivity record based on what changed.

    Uses transaction.on_commit for atomicity and dedup guard for rapid saves.
    """
    if not instance or not instance.user:
        return

    # Skip activity logging during bulk imports
    if getattr(instance, "_skip_activity", False):
        return

    try:
        activity_kwargs = None

        if created:
            # Determine activity type for new entries
            activity_type = UserActivity.ActivityType.ADDED
            if instance.status == UserAnimeList.UserAnimeStatus.completed:
                activity_type = UserActivity.ActivityType.COMPLETED

            activity_kwargs = {
                "user": instance.user,
                "anime": instance.anime,
                "activity_type": activity_type,
                "new_status": instance.status,
                "new_episodes": instance.episodes_watched,
                "new_score": instance.score if instance.score else None,
                "notes": instance.notes or "",
            }
        else:
            # For updates, determine the most significant change
            old_status = getattr(instance, "_old_status", None)
            old_episodes = getattr(instance, "_old_episodes", None)
            old_is_rewatching = getattr(instance, "_old_is_rewatching", None)

            # Check for rewatching toggle
            if instance.is_rewatching and not old_is_rewatching:
                activity_kwargs = {
                    "user": instance.user,
                    "anime": instance.anime,
                    "activity_type": UserActivity.ActivityType.REWATCHING,
                    "old_status": old_status,
                    "new_status": instance.status,
                    "old_episodes": old_episodes,
                    "new_episodes": instance.episodes_watched,
                    "notes": instance.notes or "",
                }
            # Check for completion
            elif (
                instance.status == UserAnimeList.UserAnimeStatus.completed
                and old_status != UserAnimeList.UserAnimeStatus.completed
            ):
                activity_kwargs = {
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
            # Check for status change
            elif old_status and instance.status != old_status:
                activity_kwargs = {
                    "user": instance.user,
                    "anime": instance.anime,
                    "activity_type": UserActivity.ActivityType.STATUS_CHANGE,
                    "old_status": old_status,
                    "new_status": instance.status,
                    "notes": instance.notes or "",
                }
            # Check for episode progress
            elif old_episodes is not None and instance.episodes_watched != old_episodes:
                activity_kwargs = {
                    "user": instance.user,
                    "anime": instance.anime,
                    "activity_type": UserActivity.ActivityType.PROGRESS,
                    "old_episodes": old_episodes,
                    "new_episodes": instance.episodes_watched,
                    "notes": instance.notes or "",
                }
            # Note: Score-only changes are intentionally NOT logged as per test requirements
            # Notes-only updates are also NOT logged to avoid noise

        if activity_kwargs:
            transaction.on_commit(lambda kw=activity_kwargs: _create_activity_deduped(**kw))
            # Invalidate heatmap cache since activity changed
            transaction.on_commit(lambda: invalidate_heatmap_cache(instance.user.id))
    except Exception as e:
        logger.exception(f"Failed to log activity for user {instance.user.username}: {e}")


@receiver(post_delete, sender=UserAnimeList)
def log_user_activity_on_delete(sender, instance, **kwargs):
    """Log REMOVED activity when anime is deleted from user's list."""
    if not instance or not instance.user:
        return

    # Skip activity logging during bulk imports
    if getattr(instance, "_skip_activity", False):
        return

    # Skip if user is being deleted (cascade deletion)
    if not _user_exists(instance.user):
        return

    try:
        activity_kwargs = {
            "user": instance.user,
            "anime": instance.anime,
            "activity_type": UserActivity.ActivityType.REMOVED,
            "old_status": instance.status,
            "notes": instance.notes or "",
        }
        transaction.on_commit(lambda kw=activity_kwargs: _create_activity_deduped(**kw))
        transaction.on_commit(lambda: invalidate_heatmap_cache(instance.user.id))
    except Exception as e:
        logger.exception(f"Failed to log removal activity for user {instance.user.username}: {e}")


def _schedule_recommendations_debounced(user_id, countdown=300):
    """Schedule recommendation generation with cache-based deduplication.

    Prevents duplicate Celery tasks when a user rapidly updates their list
    (e.g., bulk imports). Uses a cache key with TTL matching the countdown
    so only one task runs per window.
    """
    cache_key = f"reco_pending:{user_id}"
    if cache.get(cache_key):
        logger.debug(
            f"Skipping duplicate recommendation task for user {user_id} "
            f"(already scheduled within {countdown}s window)"
        )
        return

    # Set the dedup key with TTL = countdown + small buffer
    cache.set(cache_key, True, timeout=countdown + 30)

    generate_recommendations.apply_async(
        kwargs={"user_id": user_id},
        countdown=countdown,
    )
    logger.debug(f"Scheduled recommendation generation for user {user_id} in {countdown}s")


@receiver([post_save, post_delete], sender=UserAnimeList)
def handle_user_anime_list_change(sender, instance, **kwargs):
    """Update stats and regenerate recommendations when a user updates their anime list."""
    if instance and instance.user:
        # Skip if user is being deleted (cascade deletion)
        if not _user_exists(instance.user):
            return

        logger.info(
            f"User {instance.user.username} updated anime list. Updating stats and triggering recommendations."
        )

        # Update stats immediately for real-time feedback
        update_user_stats_and_cache(instance.user)

        # Schedule recommendations with dedup (5-minute window)
        _schedule_recommendations_debounced(instance.user.id, countdown=300)


@receiver([post_save, post_delete], sender=UserFavorite)
def handle_user_favorite_change(sender, instance, **kwargs):
    """Update stats and regenerate recommendations when a user adds/removes favorites."""
    if instance and instance.user:
        # Skip if user is being deleted (cascade deletion)
        if not _user_exists(instance.user):
            return

        logger.info(
            f"User {instance.user.username} updated favorites. Updating stats and triggering recommendations."
        )

        # Update stats immediately for real-time feedback
        update_user_stats_and_cache(instance.user)

        # Schedule recommendations with dedup (2-minute window)
        _schedule_recommendations_debounced(instance.user.id, countdown=120)


@receiver([post_save, post_delete], sender=Review)
def handle_review_change(sender, instance, **kwargs):
    """Update stats when a user creates/updates/deletes a review."""
    if instance and instance.user:
        # Skip if user is being deleted (cascade deletion)
        if not _user_exists(instance.user):
            return

        logger.info(f"User {instance.user.username} updated reviews. Updating stats.")

        # Update stats immediately for real-time feedback
        update_user_stats_and_cache(instance.user)


@receiver(post_save, sender=ReviewComment)
def handle_review_comment_created(sender, instance, created, **kwargs):
    """Send notification when a comment is created on a review."""
    if not created:
        return

    # Don't notify if user commented on their own review
    if instance.user == instance.review.user:
        logger.debug(f"Skipping self-reply notification for user {instance.user.id}")
        return

    try:
        NotificationService.create_review_reply_notification(
            user=instance.review.user, review=instance.review, comment=instance
        )
        logger.info(
            f"Created review reply notification for user {instance.review.user.id} "
            f"from comment by {instance.user.id}"
        )
    except Exception as e:
        logger.exception(f"Failed to create review reply notification: {e}")
