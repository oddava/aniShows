"""Staff moderation of forum threads and posts (spec 5 P1-1).

Removal is soft: the row stays, ``is_removed`` hides it (threads 404 for non-staff,
posts become a placeholder) and the counters drop it. Every staff action that
changes state writes one audit row; repeating an action is a no-op.
"""

from django.db import transaction
from django.utils import timezone

from ...admin_api.services.audit import record_admin_action
from ...core.models import AuditLog
from ..cache_utils import invalidate_category_detail_cache, invalidate_thread_caches
from ..models import Post, Thread
from .events import (
    ForumActionResult,
    broadcast_post_removed,
    broadcast_post_updated,
    run_after_commit,
)

_REMOVAL_FIELDS = ["is_removed", "removed_by", "removed_at", "removal_reason"]


def _audit(
    request,
    *,
    action: str,
    entity: Thread | Post,
    operation: str,
    previous: dict,
    new: dict,
    reason: str = "",
) -> None:
    is_thread = isinstance(entity, Thread)
    record_admin_action(
        request,
        action=action,
        entity_type="forum_thread" if is_thread else "forum_post",
        entity_id=entity.pk,
        entity_repr=entity.title if is_thread else f"Post {entity.pk} in thread {entity.thread_id}",
        previous=previous,
        new=new,
        metadata={"operation": operation},
        reason=reason,
    )


def _set_removed(instance: Thread | Post, *, removed_by, reason: str) -> None:
    instance.is_removed = True
    instance.removed_by = removed_by
    instance.removed_at = timezone.now()
    instance.removal_reason = reason
    instance.save(update_fields=_REMOVAL_FIELDS)


def _clear_removed(instance: Thread | Post) -> None:
    instance.is_removed = False
    instance.removed_by = None
    instance.removed_at = None
    instance.removal_reason = ""
    instance.save(update_fields=_REMOVAL_FIELDS)


def _lock_thread(thread: Thread) -> Thread:
    return (
        Thread.objects.select_related("category").select_for_update(of=("self",)).get(pk=thread.pk)
    )


def _lock_post(post: Post) -> Post:
    return Post.objects.select_related("thread").select_for_update(of=("self",)).get(pk=post.pk)


def _invalidate_thread_everywhere(thread: Thread) -> None:
    """Thread detail, its posts, every thread list and the category caches."""

    def _invalidate():
        invalidate_thread_caches(thread.id)
        invalidate_category_detail_cache(thread.category.slug)

    run_after_commit(_invalidate, "Failed to invalidate caches for moderated thread %s", thread.id)


def toggle_thread_lock(thread: Thread, *, request) -> ForumActionResult:
    with transaction.atomic():
        locked = _lock_thread(thread)
        locked.is_locked = not locked.is_locked
        locked.save(update_fields=["is_locked"])
        _audit(
            request,
            action=AuditLog.ActionType.UPDATE,
            entity=locked,
            operation="forum.thread.lock" if locked.is_locked else "forum.thread.unlock",
            previous={"is_locked": not locked.is_locked},
            new={"is_locked": locked.is_locked},
        )
        _invalidate_thread_everywhere(locked)
    return ForumActionResult(
        payload={
            "status": "locked" if locked.is_locked else "unlocked",
            "is_locked": locked.is_locked,
        },
        status_code=200,
    )


def remove_thread(thread: Thread, *, request, reason: str = "") -> ForumActionResult:
    with transaction.atomic():
        locked = _lock_thread(thread)
        if not locked.is_removed:
            _set_removed(locked, removed_by=request.user, reason=reason)
            locked.category.adjust_thread_count(-1)
            _audit(
                request,
                action=AuditLog.ActionType.DELETE,
                entity=locked,
                operation="forum.thread.remove",
                previous={"is_removed": False},
                new={"is_removed": True},
                reason=reason,
            )
            _invalidate_thread_everywhere(locked)
    return ForumActionResult(payload={"status": "removed", "is_removed": True}, status_code=200)


def restore_thread(thread: Thread, *, request) -> ForumActionResult:
    with transaction.atomic():
        locked = _lock_thread(thread)
        if locked.is_removed:
            _clear_removed(locked)
            locked.category.adjust_thread_count(1)
            _audit(
                request,
                action=AuditLog.ActionType.UPDATE,
                entity=locked,
                operation="forum.thread.restore",
                previous={"is_removed": True},
                new={"is_removed": False},
            )
            _invalidate_thread_everywhere(locked)
    return ForumActionResult(payload={"status": "restored", "is_removed": False}, status_code=200)


def mark_post_removed(post: Post, *, removed_by, reason: str = "") -> None:
    """Soft-remove a post the caller has locked: placeholder, counters, caches, live event."""
    _set_removed(post, removed_by=removed_by, reason=reason)
    post.thread.adjust_reply_count(-1)
    run_after_commit(
        lambda: invalidate_thread_caches(post.thread_id),
        "Failed to invalidate caches for removed post %s",
        post.id,
    )
    broadcast_post_removed(post)


def remove_post(post: Post, *, request, reason: str = "") -> ForumActionResult:
    with transaction.atomic():
        locked = _lock_post(post)
        if not locked.is_removed:
            mark_post_removed(locked, removed_by=request.user, reason=reason)
            _audit(
                request,
                action=AuditLog.ActionType.DELETE,
                entity=locked,
                operation="forum.post.remove",
                previous={"is_removed": False},
                new={"is_removed": True},
                reason=reason,
            )
    return ForumActionResult(payload={"status": "removed", "is_removed": True}, status_code=200)


def restore_post(post: Post, *, request) -> ForumActionResult:
    with transaction.atomic():
        locked = _lock_post(post)
        if locked.is_removed:
            _clear_removed(locked)
            locked.thread.adjust_reply_count(1)
            _audit(
                request,
                action=AuditLog.ActionType.UPDATE,
                entity=locked,
                operation="forum.post.restore",
                previous={"is_removed": True},
                new={"is_removed": False},
            )
            run_after_commit(
                lambda: invalidate_thread_caches(locked.thread_id),
                "Failed to invalidate caches for restored post %s",
                locked.id,
            )
            broadcast_post_updated(locked)
    return ForumActionResult(payload={"status": "restored", "is_removed": False}, status_code=200)


def record_thread_move(request, thread: Thread, *, from_category_id: int) -> None:
    """Audit a staff category move (``update_thread`` adjusts the counters)."""
    _audit(
        request,
        action=AuditLog.ActionType.UPDATE,
        entity=thread,
        operation="forum.thread.move",
        previous={"category_id": from_category_id},
        new={"category_id": thread.category_id},
    )
