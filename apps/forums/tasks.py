from ..shared.celery import observed_shared_task, retry_on_error
from .services import subscriptions


@observed_shared_task(retry_policy="quick")
def notify_thread_subscribers(self, post_id: int) -> int:
    """Fan a new post out to its thread's subscribers (queued on commit by ``create_post``)."""
    with retry_on_error(self, "Forum subscriber fan-out failed", extra={"post_id": post_id}):
        return subscriptions.notify_thread_subscribers(post_id)
