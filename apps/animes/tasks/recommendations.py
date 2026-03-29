from apps.shared.logger import logger

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

from django.contrib.auth import get_user_model

from apps.animes.services.recommendations import RecommendationService
from apps.shared.celery import observed_shared_task

from .base import BaseTask

User = get_user_model()

class RecommendationTask(BaseTask):
    """Unified task for generating anime recommendations.

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
        user_id: int | None = None,
        limit: int = 10,
        algorithm: str = "hybrid",
    ):
        """Run recommendation generation.

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
    ) -> dict:
        """Generate recommendations for a single user."""
        try:
            user = User.objects.get(id=user_id)
            service = RecommendationService()

            # Generate recommendations
            recs = service.generate_for_user(user, limit=limit)

            # Record Prometheus metric
            try:
                from apps.animes.services.metrics import RECOMMENDATIONS_GENERATED

                RECOMMENDATIONS_GENERATED.labels(algorithm=algorithm).inc(len(recs))
            except Exception:
                pass

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
    ) -> dict:
        """Generate recommendations for all active users."""
        try:
            service = RecommendationService()
            result = service.generate_for_all_users()
            total = result.get("total_users", 0)
            total_recs = result.get("total_recommendations", 0)

            # Record Prometheus metric
            try:
                from apps.animes.services.metrics import RECOMMENDATIONS_GENERATED

                RECOMMENDATIONS_GENERATED.labels(algorithm=algorithm).inc(total_recs)
            except Exception:
                pass

            logger.info(
                f"Batch complete: {result.get('processed', 0)}/{total} users, "
                f"{total_recs} recommendations, {result.get('failed', 0)} errors"
            )

            return {
                "mode": "batch",
                "total_users": total,
                "processed": result.get("processed", 0),
                "recommendations_created": total_recs,
                "errors": result.get("failed", 0),
                "algorithm": algorithm,
            }

        except Exception as e:
            logger.exception("Error in batch recommendation generation")
            raise self.retry(exc=e)

@observed_shared_task(
    base=RecommendationTask,
    retry_policy="long",
    time_limit=7200,  # 2 hours for all users
    soft_time_limit=6900,
)
def generate_recommendations(
    self,
    user_id: int | None = None,
    limit: int = 10,
    algorithm: str = "hybrid",
):
    """Generate anime recommendations.

    Args:
        user_id: Specific user ID (None for all users)
        limit: Maximum recommendations per user
        algorithm: Recommendation algorithm

    Returns:
        Dict with generation results
    """
    return self.execute(user_id, limit, algorithm)
