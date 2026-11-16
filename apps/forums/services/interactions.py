import hashlib

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, ValidationError

from ...core.services.notification_service import notify
from .. import messages
from ..cache_utils import (
    invalidate_category_detail_cache,
    invalidate_post_list_cache,
    invalidate_thread_caches,
)
from ..models import Category, Post, PostLike, Thread, ThreadLike
from . import subscriptions
from .events import (
    ForumActionResult,
    broadcast_post_updated,
    broadcast_to_thread,
    run_after_commit,
)
from .mentions import notify_mentions
from .moderation import lock_thread_then_post, mark_post_removed, record_thread_move


class ThreadHasRepliesError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Threads with replies can only be removed by a moderator."
    default_code = "thread_has_replies"


def hash_viewer_identifier(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def _edit_marker(instance, validated_data: dict, fields: tuple[str, ...]) -> dict:
    """``{"edited_at": now}`` when the update changes one of ``fields``, else ``{}``."""
    changed = any(
        name in validated_data and validated_data[name] != getattr(instance, name)
        for name in fields
    )
    return {"edited_at": timezone.now()} if changed else {}


def create_thread(serializer, author) -> Thread:
    """Create a thread and subscribe its author (counters and caches: ``signals``)."""
    with transaction.atomic():
        thread = serializer.save(author=author)
        subscriptions.subscribe(author, thread)
        thread.is_subscribed = True
        run_after_commit(
            lambda: notify_mentions(author, thread),
            "Failed to process thread mentions for thread %s",
            thread.id,
        )
    return thread


def _move_thread(thread: Thread, from_category_id: int) -> None:
    """Move ``thread``'s count from its old category to its new one."""
    old_category = Category.objects.get(pk=from_category_id)
    if not thread.is_removed:
        old_category.adjust_thread_count(-1)
        thread.category.adjust_thread_count(1)
    run_after_commit(
        lambda: invalidate_category_detail_cache(old_category.slug),
        "Failed to invalidate the old category of moved thread %s",
        thread.id,
    )


def update_thread(serializer, *, request) -> Thread:
    """Apply an edit (author) or a category move (staff, audited).

    The row is locked and re-read first, so the save starts from the current state:
    a lock, removal or move that landed after validation is never written back.
    """
    with transaction.atomic():
        thread = Thread.objects.select_for_update().get(pk=serializer.instance.pk)
        if thread.is_removed and not request.user.is_staff:
            raise NotFound(messages.THREAD_NOT_FOUND)
        previous_content = thread.content
        previous_category_id = thread.category_id
        edit = _edit_marker(thread, serializer.validated_data, ("title", "content"))
        serializer.instance = thread
        thread = serializer.save(**edit)
        if thread.category_id != previous_category_id:
            _move_thread(thread, previous_category_id)
            record_thread_move(request, thread, from_category_id=previous_category_id)
        if thread.content != previous_content:
            run_after_commit(
                lambda: notify_mentions(thread.author, thread, previous_text=previous_content),
                "Failed to process thread mentions for thread %s",
                thread.id,
            )

        def _invalidate():
            invalidate_thread_caches(thread.id)
            invalidate_category_detail_cache(thread.category.slug)

        run_after_commit(_invalidate, "Failed to invalidate caches for thread %s", thread.id)
    return thread


def delete_thread(instance: Thread) -> None:
    """Hard-delete an author's thread unless someone else replied to it (409)."""
    thread_id = instance.id
    with transaction.atomic():
        # The lock keeps a reply from landing between the check and the delete.
        locked = Thread.objects.select_for_update().get(pk=thread_id)
        if locked.posts.exclude(author_id=locked.author_id).exists():
            raise ThreadHasRepliesError()
        locked.delete()
        run_after_commit(
            lambda: invalidate_post_list_cache(thread_id),
            "Failed to invalidate post list cache for deleted thread %s",
            thread_id,
        )


def _liked_payload(status_name: str, like_count: int, *, is_liked: bool) -> dict:
    return {"status": status_name, "like_count": like_count, "is_liked": is_liked}


def _create_like(model, **fields) -> bool:
    """Create a like row; ``False`` if it already exists (unique constraint)."""
    try:
        with transaction.atomic():
            model.objects.create(**fields)
    except IntegrityError:
        return False
    return True


def toggle_thread_like(thread: Thread, user) -> ForumActionResult:
    with transaction.atomic():
        # The thread lock serializes like_count updates for this thread.
        locked_thread = Thread.objects.select_for_update().get(pk=thread.pk)
        if not _create_like(ThreadLike, thread=locked_thread, user=user):
            return ForumActionResult(
                payload=_liked_payload("already_liked", locked_thread.like_count, is_liked=True),
                status_code=200,
            )
        like_count = locked_thread.like_count + 1

        if locked_thread.author_id != user.id:
            run_after_commit(
                lambda: notify(
                    locked_thread.author_id,
                    "forum_like",
                    actor=user,
                    data={"thread_id": locked_thread.id},
                    group_key=f"forum_like:t:{locked_thread.id}",
                ),
                "Failed to create thread like notification for thread %s",
                locked_thread.id,
            )
        _broadcast_thread_like_count(locked_thread.id, like_count)
    return ForumActionResult(
        payload=_liked_payload("liked", like_count, is_liked=True), status_code=201
    )


def unlike_thread(thread: Thread, user) -> ForumActionResult:
    with transaction.atomic():
        locked_thread = Thread.objects.select_for_update().get(pk=thread.pk)
        deleted, _ = ThreadLike.objects.filter(thread=locked_thread, user=user).delete()
        if not deleted:
            return ForumActionResult(
                payload=_liked_payload("not_liked", locked_thread.like_count, is_liked=False),
                status_code=200,
            )
        like_count = max(locked_thread.like_count - 1, 0)
        _broadcast_thread_like_count(locked_thread.id, like_count)
    return ForumActionResult(
        payload=_liked_payload("unliked", like_count, is_liked=False), status_code=200
    )


def _broadcast_thread_like_count(thread_id: int, like_count: int) -> None:
    run_after_commit(
        lambda: broadcast_to_thread(
            thread_id,
            {"type": "forum.thread_liked", "thread_id": thread_id, "like_count": like_count},
        ),
        "Failed to broadcast thread like count for thread %s",
        thread_id,
    )


def toggle_thread_pin(thread: Thread) -> ForumActionResult:
    with transaction.atomic():
        locked_thread = Thread.objects.select_for_update().get(pk=thread.pk)
        locked_thread.is_pinned = not locked_thread.is_pinned
        locked_thread.save(update_fields=["is_pinned"])
        run_after_commit(
            lambda: invalidate_thread_caches(locked_thread.id),
            "Failed to invalidate pinned thread caches for thread %s",
            locked_thread.id,
        )
    return ForumActionResult(
        payload={
            "status": "pinned" if locked_thread.is_pinned else "unpinned",
            "is_pinned": locked_thread.is_pinned,
        },
        status_code=200,
    )


def _notify_reply_target(post: Post, author) -> None:
    """Tell the thread author (top-level reply) or the parent's author (nested reply)."""
    data: dict[str, int | str] = {"thread_id": post.thread_id, "post_id": post.id}
    if post.parent is None:
        recipient_id = post.thread.author_id
        data["reason"] = "thread"
    else:
        recipient_id = post.parent.author_id
        data.update(parent_post_id=post.parent.pk, reason="parent")
    if recipient_id != author.id:
        notify(
            recipient_id,
            "forum_reply",
            actor=author,
            data=data,
            dedupe_key=f"forum_reply:{post.id}",
        )


def _enqueue_subscriber_fanout(post_id: int) -> None:
    # Imported here: the tasks module imports this package.
    from ..tasks import notify_thread_subscribers

    notify_thread_subscribers.delay(post_id)


def _broadcast_new_post(post: Post) -> None:
    run_after_commit(
        lambda: broadcast_to_thread(
            post.thread_id,
            {
                "type": "forum.new_post",
                "post": {
                    "id": post.id,
                    "thread_id": post.thread_id,
                    "parent_id": post.parent_id,
                    "author": {"id": post.author.id, "username": post.author.username},
                    "content": post.content,
                    "depth": post.depth,
                    "like_count": 0,
                    "created_at": post.created_at.isoformat(),
                },
            },
        ),
        "Failed to broadcast new post for thread %s",
        post.thread_id,
    )


def _lock_reply_targets(serializer, author) -> tuple[Thread, Post | None]:
    """Lock the thread, then the parent (always in that order), and re-check their state.

    The serializer validated rows read before the locks; a staff lock or removal may
    have landed since, so the checks that matter run again on the locked rows.
    """
    is_staff = author.is_staff
    thread = Thread.objects.select_for_update().get(pk=serializer.validated_data["thread"].pk)
    if thread.is_removed and not is_staff:
        raise ValidationError({"thread": messages.THREAD_NOT_FOUND})
    if thread.is_locked and not is_staff:
        raise ValidationError({"thread": messages.THREAD_LOCKED})
    parent = serializer.validated_data.get("parent")
    if parent is None:
        return thread, None
    # Locked so the parent can't be deleted or removed while the reply is written.
    parent = Post.objects.select_for_update().filter(pk=parent.pk).first()
    if parent is None:
        raise ValidationError({"parent": messages.PARENT_NOT_FOUND})
    if parent.is_removed:
        raise ValidationError({"parent": messages.PARENT_REMOVED})
    return thread, parent


def create_post(serializer, author) -> Post:
    """Create a reply (reply count and caches: ``signals``) and queue its notifications."""
    with transaction.atomic():
        thread, parent = _lock_reply_targets(serializer, author)

        post = serializer.save(
            author=author,
            thread=thread,
            parent=parent,
            depth=parent.depth + 1 if parent is not None else 0,
        )
        thread.updated_at = timezone.now()
        thread.save(update_fields=["updated_at"])
        subscriptions.subscribe_on_first_post(post)

        run_after_commit(
            lambda: notify_mentions(author, post),
            "Failed to process post mentions for post %s",
            post.id,
        )
        run_after_commit(
            lambda: _notify_reply_target(post, author),
            "Failed to create reply notification for post %s",
            post.id,
        )
        run_after_commit(
            lambda: _enqueue_subscriber_fanout(post.id),
            "Failed to queue the subscriber fan-out for post %s",
            post.id,
        )
        # A removed thread is staff-only: its live channel carries no new content.
        if not thread.is_removed:
            _broadcast_new_post(post)
    return post


def update_post(serializer) -> Post:
    """Apply an author's edit; a changed text gets ``edited_at`` and a live update.

    The post is locked and re-read first: a removal that landed after validation must
    not be undone by saving the stale instance.
    """
    with transaction.atomic():
        post = Post.objects.select_for_update().get(pk=serializer.instance.pk)
        if post.is_removed:
            raise ValidationError({"content": messages.POST_REMOVED})
        previous_content = post.content
        edit = _edit_marker(post, serializer.validated_data, ("content",))
        serializer.instance = post
        post = serializer.save(**edit)
        if edit:
            run_after_commit(
                lambda: invalidate_post_list_cache(post.thread_id),
                "Failed to invalidate post list cache for thread %s",
                post.thread_id,
            )
            run_after_commit(
                lambda: notify_mentions(post.author, post, previous_text=previous_content),
                "Failed to process post mentions for post %s",
                post.id,
            )
            if not post.thread.is_removed:
                broadcast_post_updated(post)
    return post


def delete_post(instance: Post, *, actor) -> None:
    """Author delete: soft-remove a post that has replies, hard-delete a leaf."""
    with transaction.atomic():
        post = lock_thread_then_post(instance)
        if not post.replies.exists():
            post.delete()
        elif not post.is_removed:
            mark_post_removed(post, removed_by=actor, by_author=True)


def toggle_post_like(post: Post, user) -> ForumActionResult:
    with transaction.atomic():
        # The post lock serializes like_count updates for this post.
        locked_post = Post.objects.select_for_update().get(pk=post.pk)
        if not _create_like(PostLike, post=locked_post, user=user):
            return ForumActionResult(
                payload=_liked_payload("already_liked", locked_post.like_count, is_liked=True),
                status_code=200,
            )
        like_count = locked_post.like_count + 1

        if locked_post.author_id != user.id:
            run_after_commit(
                lambda: notify(
                    locked_post.author_id,
                    "forum_like",
                    actor=user,
                    data={"thread_id": locked_post.thread_id, "post_id": locked_post.id},
                    group_key=f"forum_like:p:{locked_post.id}",
                ),
                "Failed to create post like notification for post %s",
                locked_post.id,
            )
        _broadcast_post_like_count(locked_post, like_count)
    return ForumActionResult(
        payload=_liked_payload("liked", like_count, is_liked=True), status_code=201
    )


def unlike_post(post: Post, user) -> ForumActionResult:
    with transaction.atomic():
        locked_post = Post.objects.select_for_update().get(pk=post.pk)
        deleted, _ = PostLike.objects.filter(post=locked_post, user=user).delete()
        if not deleted:
            return ForumActionResult(
                payload=_liked_payload("not_liked", locked_post.like_count, is_liked=False),
                status_code=200,
            )
        like_count = max(locked_post.like_count - 1, 0)
        _broadcast_post_like_count(locked_post, like_count)
    return ForumActionResult(
        payload=_liked_payload("unliked", like_count, is_liked=False), status_code=200
    )


def _broadcast_post_like_count(post: Post, like_count: int) -> None:
    run_after_commit(
        lambda: broadcast_to_thread(
            post.thread_id,
            {"type": "forum.post_liked", "post_id": post.id, "like_count": like_count},
        ),
        "Failed to broadcast post like count for post %s",
        post.id,
    )
