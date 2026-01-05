from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Anime
from .tasks import fetch_deep_metadata
import logging

logger = logging.getLogger(__name__)

@receiver(post_save, sender=Anime)
def trigger_metadata_fetch(sender, instance, created, **kwargs):
    """
    Event-driven trigger: When a new Anime is created, 
    automatically queue a low-priority task to fetch deep metadata (characters, staff).
    """
    if created:
        logger.info(f"New Anime created: {instance.title} (ID: {instance.id}). Triggering metadata fetch.")
        # This task routes to 'low_priority' queue via celery config
        fetch_deep_metadata.delay(instance.id)
