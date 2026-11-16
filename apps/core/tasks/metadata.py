"""Celery task wrappers for social-link metadata enrichment."""

from __future__ import annotations

from django.contrib.auth import get_user_model

from ...shared.celery import observed_shared_task, retry_on_error
from ..services.celery_tasks import CoreTaskService
from ..services.social_links_service import SocialLinksService


def _invalidate_profile_caches(user_id: int) -> None:
    """Drop the owner's cached /users/me/ too, not just the public profile (A34).

    The post_save signal only bumps the public version, so Settings kept showing
    metadata_pending for up to 5 minutes after the metadata was stored.
    """
    from ...users.services.cache import invalidate_user_caches

    username = (
        get_user_model().objects.filter(pk=user_id).values_list("username", flat=True).first()
    )
    if username is not None:
        invalidate_user_caches(user_id, username, trigger_stats_update=False)


@observed_shared_task(retry_policy="standard")
def fetch_link_metadata_async(self, url: str, user_id: int, link_index: int | None = None):
    with retry_on_error(
        self,
        "Async social link metadata fetch failed",
        extra={"url": url, "user_id": user_id, "link_index": link_index},
    ):
        result = CoreTaskService.fetch_link_metadata(
            url=url, user_id=user_id, link_index=link_index
        )
        _invalidate_profile_caches(user_id)
        return result


@observed_shared_task(retry_policy="quick")
def fetch_multiple_link_metadata(self, urls: list, user_id: int):
    """Run the slow reputation checks for newly saved links, then fetch metadata.

    Links that fail (WHOIS age, Safe Browsing) are flagged suspicious and not
    fetched; the rest get their metadata (A16).
    """
    with retry_on_error(
        self,
        "Batch social link metadata fetch failed",
        extra={"user_id": user_id, "url_count": len(urls or [])},
        countdown=30,
    ):
        service = SocialLinksService()
        problems = service.reputation_problems(list(urls or []))
        result = CoreTaskService.fetch_multiple_link_metadata(
            urls=[url for url in urls or [] if url not in problems], user_id=user_id
        )
        flagged = service.flag_suspicious_links(user_id, problems)
        _invalidate_profile_caches(user_id)
        return {**result, "flagged": flagged}
