"""
Celery tasks for social links metadata fetching.
Runs in background to avoid blocking profile saves.
"""

from celery import shared_task
import logging
from django.core.cache import cache
from apps.core.services.metadata_service import MetadataService
from apps.users.models import UserProfile

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def fetch_link_metadata_async(self, url: str, user_id: int, link_index: int = None):
    """
    Fetch metadata for a social link asynchronously.
    Updates the user's social_links with fetched metadata.

    Args:
        url: The URL to fetch metadata for
        user_id: The user's ID
        link_index: Optional index of the link in the array (for targeted updates)
    """
    try:
        # Check cache first
        cache_key = f"link_metadata:{url}"
        cached = cache.get(cache_key)

        if cached:
            metadata = cached
        else:
            # Fetch fresh metadata
            service = MetadataService()
            metadata = service.fetch_metadata(url)

        # Update user's social links
        try:
            profile = UserProfile.objects.get(user_id=user_id)
            social_links = profile.social_links or []

            # Find and update the matching link
            updated = False
            for link in social_links:
                if link.get("url") == url or link.get("value") == url:
                    link["metadata"] = metadata
                    updated = True
                    break

            if updated:
                profile.social_links = social_links
                profile.save(update_fields=["social_links"])
                logger.info(f"Updated metadata for {url} for user {user_id}")

        except UserProfile.DoesNotExist:
            logger.warning(f"UserProfile not found for user {user_id}")

    except Exception as exc:
        logger.error(f"Failed to fetch metadata for {url}: {exc}")
        # Retry on failure
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def fetch_multiple_link_metadata(self, urls: list, user_id: int):
    """
    Fetch metadata for multiple URLs in batch.
    More efficient than individual tasks for multiple links.
    """
    try:
        service = MetadataService()
        profile = UserProfile.objects.get(user_id=user_id)
        social_links = profile.social_links or []

        updated = False
        for url in urls:
            try:
                metadata = service.fetch_metadata(url)

                # Update matching link
                for link in social_links:
                    if link.get("url") == url or link.get("value") == url:
                        link["metadata"] = metadata
                        updated = True
                        break

            except Exception as e:
                logger.warning(f"Failed to fetch metadata for {url}: {e}")
                continue

        if updated:
            profile.social_links = social_links
            profile.save(update_fields=["social_links"])
            logger.info(f"Batch updated metadata for user {user_id}")

    except UserProfile.DoesNotExist:
        logger.warning(f"UserProfile not found for user {user_id}")
    except Exception as exc:
        logger.error(f"Batch metadata fetch failed: {exc}")
        raise self.retry(exc=exc)
