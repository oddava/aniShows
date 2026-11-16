"""Recommendation generation task.

One task, two modes:
- ``generate_recommendations(user_id=123)``: one user. Queued (debounced) after list
  and favourite changes, after imports, by POST /recommendations/refresh/ and by a read
  that finds stale or missing rows. Failures retry.
- ``generate_recommendations()``: the daily batch (beat, 05:00). It refreshes active
  users with week-old rows, logs and skips a user that fails, and never retries the
  whole batch.
"""

from typing import Any

from celery.exceptions import SoftTimeLimitExceeded
from django.contrib.auth import get_user_model

from ...shared.celery import observed_shared_task
from ...shared.logger import logger
from ..services.recommendations import RecommendationService
from .base import BaseTask

User = get_user_model()

# The Home shelf shows 12 and the beat entry asks for 10 (its kwargs are pinned by the
# beat snapshot), so keep at least this many rows: the shelf stays full after dismissals.
STORED_RECOMMENDATIONS_MIN = 24
METRIC_ALGORITHM_LABEL = "content"

_deprecations_logged: set[str] = set()


def _log_algorithm_deprecation(algorithm: str | None) -> None:
    """``algorithm`` is accepted for old callers and ignored; say so once per process."""
    if algorithm is None or "algorithm" in _deprecations_logged:
        return
    _deprecations_logged.add("algorithm")
    logger.warning(
        "generate_recommendations(algorithm=%r) is deprecated and ignored: "
        "there is one content-based engine.",
        algorithm,
    )


def _record_metric(count: int) -> None:
    # Metric objects swallow their own failures.
    from ..services.metrics import RECOMMENDATIONS_GENERATED

    RECOMMENDATIONS_GENERATED.labels(algorithm=METRIC_ALGORITHM_LABEL).inc(count)


class RecommendationTask(BaseTask):
    """Generate stored recommendations for one user or for the daily batch."""

    enable_locking = True
    lock_timeout = 60 * 60 * 2

    def execute(
        self,
        user_id: int | None = None,
        limit: int = 10,
        algorithm: str | None = None,
    ) -> dict[str, Any]:
        """Run one user (``user_id``) or the batch; ``algorithm`` is ignored."""
        self.metrics.start()
        _log_algorithm_deprecation(algorithm)
        per_user = max(limit, STORED_RECOMMENDATIONS_MIN)

        if user_id:
            return self._generate_for_user(user_id, per_user)
        return self._generate_for_all(per_user)

    def _generate_for_user(self, user_id: int, limit: int) -> dict[str, Any]:
        """Generate for one user; an error retries the task (retry_policy "long")."""
        try:
            user = User.objects.only("id", "username").get(id=user_id)
        except User.DoesNotExist:
            logger.error("User %s not found", user_id)
            return {
                "mode": "single",
                "user_id": user_id,
                "status": "error",
                "reason": "user_not_found",
            }

        try:
            recs = RecommendationService().generate_for_user(user, limit=limit)
        except SoftTimeLimitExceeded:
            raise  # out of time: a retry would only hit the limit again
        except Exception as exc:
            logger.exception("Error generating recommendations for user %s", user_id)
            raise self.retry(exc=exc) from exc

        _record_metric(len(recs))
        return {
            "mode": "single",
            "user_id": user_id,
            "username": user.username,
            "recommendations_count": len(recs),
        }

    def _generate_for_all(self, limit: int) -> dict[str, Any]:
        """Run the batch. Per-user failures are logged and skipped inside the service;
        anything else fails this run without a retry (tomorrow's run starts fresh).
        """
        result = RecommendationService().generate_for_all_users(limit=limit)
        _record_metric(result["total_recommendations"])
        logger.info(
            "Batch complete: %s/%s users, %s recommendations, %s errors",
            result["processed"],
            result["total_users"],
            result["total_recommendations"],
            result["failed"],
        )
        return {
            "mode": "batch",
            "total_users": result["total_users"],
            "processed": result["processed"],
            "recommendations_created": result["total_recommendations"],
            "errors": result["failed"],
            "failed_user_ids": result["failed_user_ids"],
        }


@observed_shared_task(
    base=RecommendationTask,
    # Applies to the single-user path only: batch mode never calls self.retry().
    retry_policy="long",
    time_limit=7200,  # 2 hours for all users
    soft_time_limit=6900,
)
def generate_recommendations(
    self,
    user_id: int | None = None,
    limit: int = 10,
    algorithm: str | None = None,
) -> dict[str, Any]:
    """Generate anime recommendations.

    Args:
        user_id: Specific user ID (None for the daily batch)
        limit: Recommendations per user (at least ``STORED_RECOMMENDATIONS_MIN`` are kept)
        algorithm: Deprecated and ignored

    Returns:
        Dict with generation results
    """
    return self.execute(user_id, limit, algorithm)
