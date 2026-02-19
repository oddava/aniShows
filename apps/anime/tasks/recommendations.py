"""
Unified recommendation generation task.

Consolidates:
- generate_user_recommendations (for all users)
- generate_recommendations_for_user (for specific user)

With support for:
- Batch processing for all users
- Single user generation
- Configurable limits and algorithms
"""

import logging
from typing import Dict, List, Optional
from asgiref.sync import sync_to_async
from celery import shared_task
from django.contrib.auth import get_user_model

from apps.anime.recommendations import RecommendationService
from .base import BaseTask

logger = logging.getLogger(__name__)
User = get_user_model()


class RecommendationTask(BaseTask):
    """
    Unified task for generating anime recommendations.

    Supports:
    - Batch generation for all active users
    - Single user generation
    - Configurable recommendation limits

    Usage:
        # Generate for all users
        generate_recommendations.delay()

        # Generate for specific user
        generate_recommendations.delay(user_id=123)

        # Generate with custom limit
        generate_recommendations.delay(user_id=123, limit=20)
    """

    def execute(
        self,
        user_id: Optional[int] = None,
        limit: int = 10,
        algorithm: str = "hybrid",
    ):
        """
        Run recommendation generation.

        Args:
            user_id: Specific user ID (None for all users)
            limit: Maximum recommendations per user
            algorithm: Recommendation algorithm ('hybrid', 'content', 'collaborative')

        Returns:
            Dict with generation results
        """
        self.metrics.start()

        if user_id:
            return self._generate_for_user(user_id, limit, algorithm)
        else:
            return self._generate_for_all(limit, algorithm)

    def _generate_for_user(
        self,
        user_id: int,
        limit: int,
        algorithm: str,
    ) -> Dict:
        """Generate recommendations for a single user."""
        try:
            user = User.objects.get(id=user_id)
            service = RecommendationService()

            # Generate recommendations
            recs = service.generate_for_user(user)

            logger.info(f"Generated {len(recs)} recommendations for {user.username}")

            return {
                "mode": "single",
                "user_id": user_id,
                "username": user.username,
                "recommendations_count": len(recs),
                "algorithm": algorithm,
            }

        except User.DoesNotExist:
            logger.error(f"User {user_id} not found")
            return {
                "mode": "single",
                "user_id": user_id,
                "status": "error",
                "reason": "user_not_found",
            }
        except Exception as e:
            logger.exception(f"Error generating recommendations for user {user_id}")
            raise self.retry(exc=e)

    def _generate_for_all(
        self,
        limit: int,
        algorithm: str,
    ) -> Dict:
        """Generate recommendations for all active users."""
        try:
            service = RecommendationService()

            # Get active users (with anime in their list or favorites)
            active_user_ids = self._get_active_user_ids()
            total = len(active_user_ids)

            if total == 0:
                logger.info("No active users found for recommendations")
                return {
                    "mode": "batch",
                    "total_users": 0,
                    "processed": 0,
                    "recommendations_created": 0,
                }

            logger.info(f"Generating recommendations for {total} active users")

            processed = 0
            errors = 0
            total_recs = 0

            for user_id in active_user_ids:
                try:
                    user = User.objects.get(id=user_id)
                    recs = service.generate_for_user(user)
                    total_recs += len(recs)
                    processed += 1

                    if processed % 10 == 0 or processed == total:
                        logger.info(f"Progress: {processed}/{total} users processed")

                except Exception as e:
                    logger.error(f"Error for user {user_id}: {e}")
                    errors += 1
                    continue

            self.metrics.stop()

            logger.info(
                f"Batch complete: {processed}/{total} users, "
                f"{total_recs} recommendations, {errors} errors"
            )

            return {
                "mode": "batch",
                "total_users": total,
                "processed": processed,
                "recommendations_created": total_recs,
                "errors": errors,
                "algorithm": algorithm,
            }

        except Exception as e:
            logger.exception("Error in batch recommendation generation")
            raise self.retry(exc=e)

    def _get_active_user_ids(self) -> List[int]:
        """Get IDs of users with anime activity."""
        from apps.users.models import UserAnimeList

        # Users with anime in their list
        active_ids = UserAnimeList.objects.values_list("user_id", flat=True).distinct()

        return list(active_ids)


@shared_task(
    bind=True,
    base=RecommendationTask,
    max_retries=2,
    default_retry_delay=300,
    retry_backoff=True,
    retry_backoff_max=900,
    retry_jitter=True,
    time_limit=7200,  # 2 hours for all users
    soft_time_limit=6900,
)
def generate_recommendations(
    self,
    user_id: Optional[int] = None,
    limit: int = 10,
    algorithm: str = "hybrid",
):
    """
    Generate anime recommendations.

    Args:
        user_id: Specific user ID (None for all users)
        limit: Maximum recommendations per user
        algorithm: Recommendation algorithm

    Returns:
        Dict with generation results
    """
    return self.execute(user_id, limit, algorithm)
