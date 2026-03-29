import hashlib
import re
from dataclasses import dataclass

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import get_user_model
from django.db.models.functions import Lower

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
    thread = serializer.save(author=author)
    _handle_mentions(author, thread, is_thread=True)
    invalidate_thread_list_cache(thread.category.slug)
    return thread


def update_thread(serializer):
    thread = serializer.save()
    invalidate_thread_caches(thread.id, thread.category.slug)
    return thread


def delete_thread(instance):
    category_slug = instance.category.slug
    thread_id = instance.id
    instance.delete()
    invalidate_thread_caches(thread_id, category_slug)


def toggle_thread_like(thread, user) -> ForumActionResult:
    _, created = ThreadLike.objects.get_or_create(thread=thread, user=user)
    like_count = thread.likes.count()

    if not created:
        return ForumActionResult(
            payload={
                "status": "already_liked",
                "like_count": like_count,
                "is_liked": True,
            },
            status_code=200,
        )

    if thread.author != user:
        NotificationService.create_forum_like_notification(
            user=thread.author, author=user, instance=thread, is_thread=True
        )

    _broadcast_to_thread(
        thread.id,
        {
            "type": "forum.thread_liked",
            "thread_id": thread.id,
            "like_count": like_count,
        },
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
        like = ThreadLike.objects.get(thread=thread, user=user)
        like.delete()
        like_count = thread.likes.count()

        _broadcast_to_thread(
            thread.id,
            {
                "type": "forum.thread_liked",
                "thread_id": thread.id,
                "like_count": like_count,
            },
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
    thread.is_pinned = not thread.is_pinned
    thread.save(update_fields=["is_pinned"])
    invalidate_thread_caches(thread.id, thread.category.slug)
    invalidate_thread_list_cache(thread.category.slug)
    return ForumActionResult(
        payload={
            "status": "pinned" if thread.is_pinned else "unpinned",
            "is_pinned": thread.is_pinned,
        },
        status_code=200,
    )


def create_post(serializer, author):
    post = serializer.save(author=author)
    thread = serializer.validated_data["thread"]
    thread.save(update_fields=["updated_at"])

    if post.parent:
        post.depth = min(post.parent.depth + 1, 10)
        post.save(update_fields=["depth"])

    _handle_mentions(author, post, is_thread=False)

    if not post.parent and thread.author != author:
        NotificationService.create_forum_reply_notification(user=thread.author, thread=thread, post=post)

    if post.parent and post.parent.author != author:
        NotificationService.create_forum_reply_to_post_notification(user=post.parent.author, reply=post)

    invalidate_post_list_cache(thread.id)
    invalidate_thread_caches(thread.id, thread.category.slug)

    _broadcast_to_thread(
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
    )
    return post


def update_post(serializer):
    post = serializer.save()
    invalidate_post_list_cache(post.thread_id)
    return post


def delete_post(instance):
    thread_id = instance.thread_id
    thread = instance.thread
    instance.delete()
    invalidate_post_list_cache(thread_id)
    invalidate_thread_caches(thread.id, thread.category.slug)


def toggle_post_like(post, user) -> ForumActionResult:
    _, created = PostLike.objects.get_or_create(post=post, user=user)
    like_count = post.likes.count()

    if not created:
        return ForumActionResult(
            payload={
                "status": "already_liked",
                "like_count": like_count,
                "is_liked": True,
            },
            status_code=200,
        )

    if post.author != user:
        NotificationService.create_forum_like_notification(
            user=post.author, author=user, instance=post, is_thread=False
        )

    _broadcast_to_thread(
        post.thread_id,
        {
            "type": "forum.post_liked",
            "post_id": post.id,
            "like_count": like_count,
        },
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
        like = PostLike.objects.get(post=post, user=user)
        like.delete()
        like_count = post.likes.count()

        _broadcast_to_thread(
            post.thread_id,
            {
                "type": "forum.post_liked",
                "post_id": post.id,
                "like_count": like_count,
            },
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
