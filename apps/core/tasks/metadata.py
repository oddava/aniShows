"""Celery task wrappers for social-link metadata enrichment."""

from __future__ import annotations

from ...shared.celery import observed_shared_task, retry_on_error
from ..services.celery_tasks import CoreTaskService


@observed_shared_task(retry_policy="standard")
def fetch_link_metadata_async(self, url: str, user_id: int, link_index: int | None = None):
    with retry_on_error(
        self,
        "Async social link metadata fetch failed",
        extra={"url": url, "user_id": user_id, "link_index": link_index},
    ):
        return CoreTaskService.fetch_link_metadata(url=url, user_id=user_id, link_index=link_index)


@observed_shared_task(retry_policy="quick")
def fetch_multiple_link_metadata(self, urls: list, user_id: int):
    with retry_on_error(
        self,
        "Batch social link metadata fetch failed",
        extra={"user_id": user_id, "url_count": len(urls or [])},
        countdown=30,
    ):
        return CoreTaskService.fetch_multiple_link_metadata(urls=urls, user_id=user_id)
