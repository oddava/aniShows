from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from .models import Anime, UserFavorite, ReviewComment
from apps.users.models import UserAnimeList
from apps.animes.tasks import enrich_metadata, generate_recommendations
from apps.core.services.notification_service import NotificationService
import logging

logger = logging.getLogger(__name__)
User = get_user_model()


@receiver(post_save, sender=Anime)
def trigger_metadata_fetch(sender, instance, created, **kwargs):
    """
    Event-driven trigger: When a new Anime is created,
    automatically queue a low-priority task to fetch deep metadata (characters, staff).
    """
    if created:
        logger.info(
            f"New Anime created: {instance.title} (ID: {instance.id}). Triggering metadata fetch."
        )
        # This task routes to 'low_priority' queue via celery config
        enrich_metadata.delay(anime_id=instance.id, mode="single")


@receiver([post_save, post_delete], sender=UserAnimeList)
def trigger_recommendations_on_list_change(sender, instance, **kwargs):
    """
    Regenerate recommendations when a user updates their anime list.
    This ensures recommendations stay fresh as users rate or status-change anime.
    """
    if instance and instance.user:
        logger.info(
            f"User {instance.user.username} updated anime list. Triggering recommendation refresh."
        )
        # Use countdown to batch rapid updates (e.g., if user updates multiple entries quickly)
        generate_recommendations.apply_async(
            kwargs={"user_id": instance.user.id},
            countdown=300,  # Wait 5 minutes for potential batch updates
        )


@receiver([post_save, post_delete], sender=UserFavorite)
def trigger_recommendations_on_favorite_change(sender, instance, **kwargs):
    """
    Regenerate recommendations when a user adds/removes favorites.
    Favorites are strong signals of user preference.
    """
    if instance and instance.user:
        logger.info(
            f"User {instance.user.username} updated favorites. Triggering recommendation refresh."
        )
        # Wait 2 minutes for potential batch updates
        generate_recommendations.apply_async(
            kwargs={"user_id": instance.user.id},
            countdown=120,
        )


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
