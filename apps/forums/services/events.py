"""Side effects shared by the forum services: action results, after-commit work, live events."""

from collections.abc import Callable
from dataclasses import dataclass

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from ...shared.logger import logger


@dataclass(slots=True)
class ForumActionResult:
    payload: dict
    status_code: int


def broadcast_to_thread(thread_id: int, event: dict) -> None:
    """Send ``event`` to the thread's WebSocket group (best effort)."""
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(f"forum_thread_{thread_id}", event)
    except Exception:
        logger.exception("Failed to broadcast forum event for thread %s", thread_id)


def run_after_commit(callback: Callable[[], object], log_message: str, *args) -> None:
    """Run ``callback`` once the transaction commits; log (never raise) its errors."""

    def _wrapped():
        try:
            callback()
        except Exception:
            logger.exception(log_message, *args)

    transaction.on_commit(_wrapped)


def broadcast_post_updated(post) -> None:
    run_after_commit(
        lambda: broadcast_to_thread(
            post.thread_id,
            {
                "type": "forum.post_updated",
                "post": {
                    "id": post.id,
                    "content": post.content,
                    "edited_at": post.edited_at.isoformat() if post.edited_at else None,
                },
            },
        ),
        "Failed to broadcast post update for post %s",
        post.id,
    )


def broadcast_post_restored(post) -> None:
    """A removed post is back: viewers refetch it (its author and content return)."""
    run_after_commit(
        lambda: broadcast_to_thread(
            post.thread_id, {"type": "forum.post_restored", "post_id": post.id}
        ),
        "Failed to broadcast post restore for post %s",
        post.id,
    )


def broadcast_post_removed(post) -> None:
    run_after_commit(
        lambda: broadcast_to_thread(
            post.thread_id,
            {"type": "forum.post_removed", "post_id": post.id, "removal": post.removal},
        ),
        "Failed to broadcast post removal for post %s",
        post.id,
    )
