from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from .models import Anime, UserFavorite
from users.models import UserAnimeList
from .tasks import fetch_deep_metadata, generate_recommendations_for_user
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
        fetch_deep_metadata.delay(instance.id)


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
        generate_recommendations_for_user.apply_async(
            args=[instance.user.id],
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
        generate_recommendations_for_user.apply_async(
            args=[instance.user.id],
            countdown=120,
        )
