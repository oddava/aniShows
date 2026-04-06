import hashlib
import re
from dataclasses import dataclass

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.functions import Lower
from django.utils import timezone

from apps.core.services.notification_service import NotificationService
from apps.forums.cache_utils import (
    invalidate_post_list_cache,
    invalidate_thread_caches,
    invalidate_thread_list_cache,
)
from apps.forums.models import PostLike, ThreadLike
from apps.shared.logger import logger

User = get_user_model()


@dataclass(slots=True)
class ForumActionResult:
    payload: dict
    status_code: int


def _broadcast_to_thread(thread_id, event):
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        group_name = f"forum_thread_{thread_id}"
        async_to_sync(channel_layer.group_send)(group_name, event)
    except Exception:
        logger.exception("Failed to broadcast forum event for thread %s", thread_id)


def _run_after_commit(callback, log_message: str, *args):
    def _wrapped():
        try:
            callback()
        except Exception:
            logger.exception(log_message, *args)

    transaction.on_commit(_wrapped)


def _handle_mentions(author, instance, *, is_thread=False):
    pattern = r"(?<=^|(?<=[^a-zA-Z0-9-_\.]))@([A-Za-z0-9_]+)"
    usernames = {username.lower() for username in re.findall(pattern, instance.content)}
    usernames.discard(author.username.lower())
    if not usernames:
        return

    mentioned_users = User.objects.annotate(_username_lower=Lower("username")).filter(
        _username_lower__in=usernames
    )
    for mentioned_user in mentioned_users:
        NotificationService.create_forum_mention_notification(
            user=mentioned_user, author=author, instance=instance, is_thread=is_thread
        )


def hash_viewer_identifier(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def create_thread(serializer, author):
    with transaction.atomic():
        thread = serializer.save(author=author)
        _run_after_commit(
            lambda: _handle_mentions(author, thread, is_thread=True),
            "Failed to process thread mentions for thread %s",
            thread.id,
        )
        _run_after_commit(
            lambda: invalidate_thread_list_cache(thread.category.slug),
            "Failed to invalidate thread list cache for category %s",
            thread.category.slug,
        )
    return thread


def update_thread(serializer):
    with transaction.atomic():
        thread = serializer.save()
        _run_after_commit(
            lambda: invalidate_thread_caches(thread.id, thread.category.slug),
            "Failed to invalidate thread caches for thread %s",
            thread.id,
        )
    return thread


def delete_thread(instance):
    category_slug = instance.category.slug
    thread_id = instance.id
    with transaction.atomic():
        instance.delete()
        _run_after_commit(
            lambda: invalidate_thread_caches(thread_id, category_slug),
            "Failed to invalidate deleted thread caches for thread %s",
            thread_id,
        )


def toggle_thread_like(thread, user) -> ForumActionResult:
    with transaction.atomic():
        locked_thread = thread.__class__.objects.select_for_update().get(pk=thread.pk)
        locked_user = User.objects.select_for_update().get(pk=user.pk)
        existing_like = ThreadLike.objects.select_for_update().filter(
            thread=locked_thread,
            user=locked_user,
        ).first()
        if existing_like:
            like_count = locked_thread.likes.count()
            return ForumActionResult(
                payload={
                    "status": "already_liked",
                    "like_count": like_count,
                    "is_liked": True,
                },
                status_code=200,
            )

        ThreadLike.objects.create(thread=locked_thread, user=locked_user)
        like_count = locked_thread.likes.count()

        if locked_thread.author_id != locked_user.id:
            _run_after_commit(
                lambda: NotificationService.create_forum_like_notification(
                    user=locked_thread.author,
                    author=locked_user,
                    instance=locked_thread,
                    is_thread=True,
                ),
                "Failed to create thread like notification for thread %s",
                locked_thread.id,
            )

        _run_after_commit(
            lambda: _broadcast_to_thread(
                locked_thread.id,
                {
                    "type": "forum.thread_liked",
                    "thread_id": locked_thread.id,
                    "like_count": like_count,
                },
            ),
            "Failed to broadcast thread like for thread %s",
            locked_thread.id,
        )
    return ForumActionResult(
        payload={
            "status": "liked",
            "like_count": like_count,
            "is_liked": True,
        },
        status_code=201,
    )


def unlike_thread(thread, user) -> ForumActionResult:
    try:
        with transaction.atomic():
            locked_thread = thread.__class__.objects.select_for_update().get(pk=thread.pk)
            locked_user = User.objects.select_for_update().get(pk=user.pk)
            like = ThreadLike.objects.select_for_update().get(thread=locked_thread, user=locked_user)
            like.delete()
            like_count = locked_thread.likes.count()

            _run_after_commit(
                lambda: _broadcast_to_thread(
                    locked_thread.id,
                    {
                        "type": "forum.thread_liked",
                        "thread_id": locked_thread.id,
                        "like_count": like_count,
                    },
                ),
                "Failed to broadcast thread unlike for thread %s",
                locked_thread.id,
            )
        return ForumActionResult(
            payload={
                "status": "unliked",
                "like_count": like_count,
                "is_liked": False,
            },
            status_code=200,
        )
    except ThreadLike.DoesNotExist:
        return ForumActionResult(
            payload={
                "status": "not_liked",
                "like_count": thread.likes.count(),
                "is_liked": False,
            },
            status_code=200,
        )


def toggle_thread_pin(thread) -> ForumActionResult:
    with transaction.atomic():
        locked_thread = thread.__class__.objects.select_for_update().get(pk=thread.pk)
        locked_thread.is_pinned = not locked_thread.is_pinned
        locked_thread.save(update_fields=["is_pinned"])
        _run_after_commit(
            lambda: invalidate_thread_caches(locked_thread.id, locked_thread.category.slug),
            "Failed to invalidate pinned thread caches for thread %s",
            locked_thread.id,
        )
        _run_after_commit(
            lambda: invalidate_thread_list_cache(locked_thread.category.slug),
            "Failed to invalidate thread list cache for category %s",
            locked_thread.category.slug,
        )
    return ForumActionResult(
        payload={
            "status": "pinned" if locked_thread.is_pinned else "unpinned",
            "is_pinned": locked_thread.is_pinned,
        },
        status_code=200,
    )


def create_post(serializer, author):
    with transaction.atomic():
        thread = serializer.validated_data["thread"].__class__.objects.select_for_update().get(
            pk=serializer.validated_data["thread"].pk
        )
        parent = serializer.validated_data.get("parent")
        if parent is not None:
            parent = parent.__class__.objects.select_for_update().get(pk=parent.pk)
        locked_author = User.objects.select_for_update().get(pk=author.pk)

        post = serializer.save(author=locked_author, thread=thread, parent=parent)
        thread.updated_at = timezone.now()
        thread.save(update_fields=["updated_at"])

        if post.parent:
            post.depth = min(post.parent.depth + 1, 10)
            post.save(update_fields=["depth"])

        _run_after_commit(
            lambda: _handle_mentions(locked_author, post, is_thread=False),
            "Failed to process post mentions for post %s",
            post.id,
        )

        if not post.parent and thread.author_id != locked_author.id:
            _run_after_commit(
                lambda: NotificationService.create_forum_reply_notification(
                    user=thread.author,
                    thread=thread,
                    post=post,
                ),
                "Failed to create thread reply notification for thread %s",
                thread.id,
            )

        if post.parent and post.parent.author_id != locked_author.id:
            _run_after_commit(
                lambda: NotificationService.create_forum_reply_to_post_notification(
                    user=post.parent.author,
                    reply=post,
                ),
                "Failed to create post reply notification for post %s",
                post.parent_id,
            )

        _run_after_commit(
            lambda: invalidate_post_list_cache(thread.id),
            "Failed to invalidate post list cache for thread %s",
            thread.id,
        )
        _run_after_commit(
            lambda: invalidate_thread_caches(thread.id, thread.category.slug),
            "Failed to invalidate thread caches for thread %s",
            thread.id,
        )
        _run_after_commit(
            lambda: _broadcast_to_thread(
                thread.id,
                {
                    "type": "forum.new_post",
                    "post": {
                        "id": post.id,
                        "thread_id": thread.id,
                        "parent_id": post.parent_id,
                        "author": {
                            "id": post.author.id,
                            "username": post.author.username,
                        },
                        "content": post.content,
                        "depth": post.depth,
                        "like_count": 0,
                        "created_at": post.created_at.isoformat(),
                    },
                },
            ),
            "Failed to broadcast new post for thread %s",
            thread.id,
        )
    return post


def update_post(serializer):
    with transaction.atomic():
        post = serializer.save()
        _run_after_commit(
            lambda: invalidate_post_list_cache(post.thread_id),
            "Failed to invalidate post list cache for thread %s",
            post.thread_id,
        )
    return post


def delete_post(instance):
    thread_id = instance.thread_id
    thread = instance.thread
    with transaction.atomic():
        instance.delete()
        _run_after_commit(
            lambda: invalidate_post_list_cache(thread_id),
            "Failed to invalidate post list cache for thread %s",
            thread_id,
        )
        _run_after_commit(
            lambda: invalidate_thread_caches(thread.id, thread.category.slug),
            "Failed to invalidate thread caches for thread %s",
            thread.id,
        )


def toggle_post_like(post, user) -> ForumActionResult:
    with transaction.atomic():
        locked_post = post.__class__.objects.select_for_update().get(pk=post.pk)
        locked_user = User.objects.select_for_update().get(pk=user.pk)
        existing_like = PostLike.objects.select_for_update().filter(
            post=locked_post,
            user=locked_user,
        ).first()
        if existing_like:
            like_count = locked_post.likes.count()
            return ForumActionResult(
                payload={
                    "status": "already_liked",
                    "like_count": like_count,
                    "is_liked": True,
                },
                status_code=200,
            )

        PostLike.objects.create(post=locked_post, user=locked_user)
        like_count = locked_post.likes.count()

        if locked_post.author_id != locked_user.id:
            _run_after_commit(
                lambda: NotificationService.create_forum_like_notification(
                    user=locked_post.author,
                    author=locked_user,
                    instance=locked_post,
                    is_thread=False,
                ),
                "Failed to create post like notification for post %s",
                locked_post.id,
            )

        _run_after_commit(
            lambda: _broadcast_to_thread(
                locked_post.thread_id,
                {
                    "type": "forum.post_liked",
                    "post_id": locked_post.id,
                    "like_count": like_count,
                },
            ),
            "Failed to broadcast post like for post %s",
            locked_post.id,
        )
    return ForumActionResult(
        payload={
            "status": "liked",
            "like_count": like_count,
            "is_liked": True,
        },
        status_code=201,
    )


def unlike_post(post, user) -> ForumActionResult:
    try:
        with transaction.atomic():
            locked_post = post.__class__.objects.select_for_update().get(pk=post.pk)
            locked_user = User.objects.select_for_update().get(pk=user.pk)
            like = PostLike.objects.select_for_update().get(post=locked_post, user=locked_user)
            like.delete()
            like_count = locked_post.likes.count()

            _run_after_commit(
                lambda: _broadcast_to_thread(
                    locked_post.thread_id,
                    {
                        "type": "forum.post_liked",
                        "post_id": locked_post.id,
                        "like_count": like_count,
                    },
                ),
                "Failed to broadcast post unlike for post %s",
                locked_post.id,
            )
        return ForumActionResult(
            payload={
                "status": "unliked",
                "like_count": like_count,
                "is_liked": False,
            },
            status_code=200,
        )
    except PostLike.DoesNotExist:
        return ForumActionResult(
            payload={
                "status": "not_liked",
                "like_count": post.likes.count(),
                "is_liked": False,
            },
            status_code=200,
        )
