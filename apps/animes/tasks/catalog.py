"""Celery entry point for the catalog engine (``apps.animes.catalog``)."""

from ...shared.celery import observed_shared_task
from ..catalog.runner import run_lane


@observed_shared_task(retry_policy="none", time_limit=20 * 60, soft_time_limit=15 * 60)
def run_catalog_lane(self, lane: str = "seasons", trigger: str = "schedule", **options):
    """Run one catalog lane. Never retried by Celery: the next scheduled run resumes."""
    return run_lane(lane, trigger=trigger, **options)
