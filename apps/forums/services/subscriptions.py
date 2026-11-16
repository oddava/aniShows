"""Thread subscriptions and the new-post fan-out (spec 5 P1-3)."""

from django.conf import settings

from ...core.services.notification_service import notify_many
from ..models import Post, ThreadSubscription
from .mentions import resolve_mentioned_users


def subscribe(user, thread) -> None:
    """Subscribe ``user`` to ``thread`` (idempotent)."""
    ThreadSubscription.objects.bulk_create(
        [ThreadSubscription(user=user, thread=thread)], ignore_conflicts=True
    )


def unsubscribe(user, thread) -> None:
    ThreadSubscription.objects.filter(user=user, thread=thread).delete()


def subscribe_on_first_post(post: Post) -> None:
    """Subscribe a replier the first time they post in someone else's thread.

    Later posts leave the subscription alone, so an unsubscribe sticks.
    """
    thread = post.thread
    if post.author_id == thread.author_id:
        return
    has_earlier_post = (
        Post.objects.filter(thread=thread, author_id=post.author_id).exclude(pk=post.pk).exists()
    )
    if not has_earlier_post:
        subscribe(post.author, thread)


def _directly_notified_user_ids(post: Post) -> set[int]:
    """Users the post's own notifications reach (reply target and mentions)."""
    reply_target_author_id = post.thread.author_id if post.parent is None else post.parent.author_id
    mentioned = resolve_mentioned_users(post.content, author=post.author)
    return {reply_target_author_id, *(user.id for user in mentioned)}


def notify_thread_subscribers(post_id: int) -> int:
    """Notify the subscribers of a new post's thread; return how many were notified.

    Skips the post author and everyone the post already notified directly, stops at
    ``FORUM_SUBSCRIPTION_FANOUT_CAP`` recipients, and sends nothing for removed
    posts or removed or locked threads.
    """
    post = Post.objects.select_related("thread", "parent", "author").filter(pk=post_id).first()
    if post is None or post.is_removed or post.thread.is_removed or post.thread.is_locked:
        return 0
    excluded = {post.author_id} | _directly_notified_user_ids(post)
    recipient_ids = list(
        ThreadSubscription.objects.filter(thread_id=post.thread_id, user__is_active=True)
        .exclude(user_id__in=excluded)
        .order_by("created_at", "id")
        .values_list("user_id", flat=True)[: settings.FORUM_SUBSCRIPTION_FANOUT_CAP]
    )
    if not recipient_ids:
        return 0
    return notify_many(
        recipient_ids,
        "forum_reply",
        actor=post.author,
        data={"thread_id": post.thread_id, "post_id": post.id, "reason": "subscription"},
        dedupe_key=f"forum_reply:{post.id}",
    )
