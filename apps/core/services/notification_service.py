from typing import Any, Dict

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from ...shared.logger import logger
from ...shared.media_urls import normalize_media_url
from ...users.models import UserProfile
from ...users.services.avatar_service import get_user_avatar_url
from ..models import Notification

UNREAD_COUNT_CACHE_TTL_SECONDS = 24 * 60 * 60

class NotificationService:
    """Service for creating and managing user notifications."""

    @staticmethod
    def _serialize_notification(notification: Notification) -> Dict[str, Any]:
        """Serialize a notification for websocket delivery."""
        return {
            "id": notification.id,
            "notification_type": notification.notification_type,
            "title": notification.title,
            "message": notification.message,
            "data": notification.data,
            "priority": notification.priority,
            "created_at": notification.created_at.isoformat(),
            "is_read": notification.is_read,
        }

    @staticmethod
    def _field_url(field) -> str | None:
        try:
            url = field.url
        except Exception:
            return None
        return normalize_media_url(url)

    @classmethod
    def get_anime_cover_payload(cls, anime) -> Dict[str, str | None]:
        """Return lightweight cover URLs safe to embed in notification payloads."""
        if anime is None:
            return {}

        external_cover = getattr(anime, "cover_image_external_url", None) or None
        cover = cls._field_url(getattr(anime, "cover_image", None)) or external_cover
        small = cls._field_url(getattr(anime, "cover_image_small", None)) or cover
        medium = cls._field_url(getattr(anime, "cover_image_medium", None)) or cover

        return {
            "anime_cover_image_small": small,
            "anime_cover_image_medium": medium,
            "anime_cover_image": cover,
        }

    @staticmethod
    def _actor_summary(primary_username: str, actor_count: int) -> str:
        if actor_count <= 1:
            return primary_username
        if actor_count == 2:
            return f"{primary_username} and 1 other"
        return f"{primary_username} and {actor_count - 1} others"

    @staticmethod
    def _coerce_actor_id(value) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @classmethod
    def _merge_actor_payload(
        cls,
        *,
        existing_data: Dict[str, Any],
        base_data: Dict[str, Any],
        actor,
        username_key: str,
        usernames_key: str,
        user_ids_key: str,
        count_key: str,
    ) -> Dict[str, Any]:
        actor_id = cls._coerce_actor_id(getattr(actor, "id", None))
        actor_username = getattr(actor, "username", "")

        existing_usernames = [
            username
            for username in existing_data.get(usernames_key, [])
            if isinstance(username, str) and username
        ]
        if (
            not existing_usernames
            and isinstance(existing_data.get(username_key), str)
            and existing_data.get(username_key)
        ):
            existing_usernames = [existing_data[username_key]]

        existing_user_ids = [
            user_id
            for value in existing_data.get(user_ids_key, [])
            if (user_id := cls._coerce_actor_id(value)) is not None
        ]

        merged_usernames = [actor_username] + [
            username for username in existing_usernames if username != actor_username
        ]
        merged_user_ids = []
        if actor_id is not None:
            merged_user_ids.append(actor_id)
        merged_user_ids.extend(user_id for user_id in existing_user_ids if user_id != actor_id)

        actor_count = len(merged_user_ids) if merged_user_ids else len(merged_usernames)

        return {
            **existing_data,
            **base_data,
            username_key: merged_usernames[0],
            usernames_key: merged_usernames,
            user_ids_key: merged_user_ids,
            count_key: actor_count,
        }

    @classmethod
    def create_notification(
        cls,
        user,
        notification_type: str,
        title: str,
        message: str,
        data: Dict[str, Any] | None = None,
        priority: str = "medium",
    ) -> Notification | None:
        """Create a notification for a user.

        Args:
            user: The user to notify
            notification_type: Type of notification (new_episode, review_reply, etc.)
            title: Notification title
            message: Notification message
            data: Additional data (anime_id, review_id, etc.)
            priority: Priority level (low, medium, high)

        Returns:
            Notification object or None if user has disabled this notification type
        """
        # Check user preferences
        if not cls._should_notify_user(user, notification_type):
            logger.debug(f"Skipping notification for user {user.id}: preferences disabled")
            return None

        try:
            with transaction.atomic():
                notification = Notification.objects.create(
                    user=user,
                    notification_type=notification_type,
                    title=title,
                    message=message,
                    data=data or {},
                    priority=priority,
                )
                logger.info(f"Created {notification_type} notification for user {user.id}")

                def notify_after_commit():
                    unread_count = cls._increment_unread_count(user.id)
                    cls._broadcast_notification(notification, unread_count=unread_count)

                transaction.on_commit(notify_after_commit)

                return notification
        except Exception as e:
            logger.exception(f"Failed to create notification: {e}")
            return None

    @classmethod
    def _should_notify_user(cls, user, notification_type: str) -> bool:
        """Check if user should receive this notification type based on preferences."""
        try:
            _ = user.userprofile
        except UserProfile.DoesNotExist:
            return True  # Default to allowing if no profile

        # For in-app notifications, we always create them
        # Email/push preferences are checked when sending
        return True

    @classmethod
    def _broadcast_notification(cls, notification, unread_count: int | None = None):
        """Push a notification to the user's WebSocket channel group.

        This is called synchronously from Django views/services. It uses
        ``async_to_sync`` to send a message to the channel layer which
        Daphne then delivers to the connected WebSocket consumer.
        """
        try:
            channel_layer = get_channel_layer()
            if channel_layer is None:
                return

            group_name = f"notifications_user_{notification.user_id}"
            if unread_count is None:
                unread_count = cls.get_unread_count_for_user_id(notification.user_id)

            async_to_sync(channel_layer.group_send)(
                group_name,
                {
                    "type": "notification.new",
                    "notification": cls._serialize_notification(notification),
                    "unread_count": unread_count,
                },
            )
        except Exception:
            # Never let a broadcast failure break notification creation
            logger.exception("Failed to broadcast notification via WebSocket")

    @classmethod
    def _broadcast_notification_update(cls, notification):
        """Push an updated notification payload to active websocket clients."""
        try:
            channel_layer = get_channel_layer()
            if channel_layer is None:
                return

            group_name = f"notifications_user_{notification.user_id}"
            async_to_sync(channel_layer.group_send)(
                group_name,
                {
                    "type": "notification.updated",
                    "notification": cls._serialize_notification(notification),
                },
            )
        except Exception:
            logger.exception("Failed to broadcast notification update via WebSocket")

    @classmethod
    def _broadcast_notification_deleted(
        cls,
        user_id: int,
        notification_id: int,
        unread_count: int | None = None,
    ):
        """Push a deletion/retraction event to active websocket clients."""
        try:
            channel_layer = get_channel_layer()
            if channel_layer is None:
                return

            group_name = f"notifications_user_{user_id}"
            async_to_sync(channel_layer.group_send)(
                group_name,
                {
                    "type": "notification.deleted",
                    "notification_id": notification_id,
                    "unread_count": unread_count,
                },
            )
        except Exception:
            logger.exception("Failed to broadcast notification deletion via WebSocket")

    @classmethod
    def _broadcast_unread_count(cls, user_id: int, count: int):
        """Push unread-count updates to all active WebSocket sessions for a user."""
        try:
            channel_layer = get_channel_layer()
            if channel_layer is None:
                return

            group_name = f"notifications_user_{user_id}"
            async_to_sync(channel_layer.group_send)(
                group_name,
                {
                    "type": "notification.count_update",
                    "count": max(int(count), 0),
                },
            )
        except Exception:
            logger.exception("Failed to broadcast unread count via WebSocket")

    @classmethod
    def _unread_count_cache_key(cls, user_id: int) -> str:
        return f"notifications:unread_count:{user_id}"

    @classmethod
    def _unread_count_ttl(cls) -> int:
        ttl = getattr(settings, "NOTIFICATION_UNREAD_CACHE_TTL", UNREAD_COUNT_CACHE_TTL_SECONDS)
        try:
            return max(int(ttl), 60)
        except (TypeError, ValueError):
            return UNREAD_COUNT_CACHE_TTL_SECONDS

    @classmethod
    def _set_unread_count_cache(cls, user_id: int, count: int) -> None:
        try:
            cache.set(
                cls._unread_count_cache_key(user_id),
                max(int(count), 0),
                timeout=cls._unread_count_ttl(),
            )
        except Exception:
            logger.debug("Failed to set unread notification count cache for user %s", user_id)

    @classmethod
    def _increment_unread_count(cls, user_id: int, delta: int = 1) -> int:
        key = cls._unread_count_cache_key(user_id)
        try:
            cache.add(key, 0, timeout=cls._unread_count_ttl())
            return int(cache.incr(key, delta))
        except ValueError:
            # Cache key contains invalid data, rebuild from source of truth.
            count = Notification.objects.filter(user_id=user_id, is_read=False).count()
            cls._set_unread_count_cache(user_id, count)
            return count
        except Exception:
            return Notification.objects.filter(user_id=user_id, is_read=False).count()

    @classmethod
    def _decrement_unread_count(cls, user_id: int, delta: int = 1) -> int:
        key = cls._unread_count_cache_key(user_id)
        try:
            cache.add(key, 0, timeout=cls._unread_count_ttl())
            value = int(cache.decr(key, delta))
            if value < 0:
                cls._set_unread_count_cache(user_id, 0)
                return 0
            return value
        except ValueError:
            count = Notification.objects.filter(user_id=user_id, is_read=False).count()
            cls._set_unread_count_cache(user_id, count)
            return count
        except Exception:
            return Notification.objects.filter(user_id=user_id, is_read=False).count()

    @classmethod
    def get_unread_count_for_user_id(cls, user_id: int) -> int:
        key = cls._unread_count_cache_key(user_id)
        try:
            cached = cache.get(key)
            if cached is not None:
                return max(int(cached), 0)
        except (TypeError, ValueError):
            pass
        except Exception:
            logger.debug("Failed to read unread notification count cache for user %s", user_id)

        count = Notification.objects.filter(user_id=user_id, is_read=False).count()
        cls._set_unread_count_cache(user_id, count)
        return count

    @classmethod
    def mark_as_read(cls, notification_id: int, user) -> bool:
        """Mark a notification as read."""
        queryset = Notification.objects.filter(
            id=notification_id,
            user_id=user.id,
            is_read=False,
        )
        updated = queryset.update(
            is_read=True,
            read_at=timezone.now(),
        )
        if updated:
            unread_count = cls._decrement_unread_count(user.id)
            cls._broadcast_unread_count(user.id, unread_count)
            return True
        exists_queryset = Notification.objects.filter(id=notification_id, user_id=user.id)
        return exists_queryset.exists()

    @classmethod
    def mark_all_as_read(cls, user) -> int:
        """Mark all unread notifications as read for a user."""
        queryset = Notification.objects.filter(user=user, is_read=False)
        count = queryset.update(
            is_read=True, read_at=timezone.now()
        )
        cls._set_unread_count_cache(user.id, 0)
        cls._broadcast_unread_count(user.id, 0)
        logger.info(f"Marked {count} notifications as read for user {user.id}")
        return count

    @classmethod
    def delete_notification(cls, notification_id: int, user) -> bool:
        """Delete a notification and keep unread counters in sync."""
        try:
            with transaction.atomic():
                notification = (
                    Notification.objects.select_for_update()
                    .only("id", "user_id", "is_read")
                    .get(id=notification_id, user_id=user.id)
                )
                was_unread = not notification.is_read
                notification.delete()

                def notify_after_commit():
                    unread_count = None
                    if was_unread:
                        unread_count = cls._decrement_unread_count(user.id)
                        cls._broadcast_unread_count(user.id, unread_count)
                    cls._broadcast_notification_deleted(user.id, notification_id, unread_count)

                transaction.on_commit(notify_after_commit)
                return True
        except Notification.DoesNotExist:
            return False

    @classmethod
    def get_unread_count(cls, user) -> int:
        """Get count of unread notifications for a user."""
        return cls.get_unread_count_for_user_id(user.id)

    @classmethod
    def cleanup_old_notifications(cls, days: int = 90) -> int:
        """Delete read notifications older than specified days."""
        from datetime import timedelta

        cutoff_date = timezone.now() - timedelta(days=days)
        queryset = Notification.objects.filter(is_read=True, created_at__lt=cutoff_date)
        deleted, _ = queryset.delete()
        logger.info(f"Cleaned up {deleted} old notifications")
        return deleted

    @classmethod
    def create_new_episode_notification(cls, user, anime, episode_number: int, aired_at=None):
        """Create notification for new episode."""
        data = {
            "anime_id": anime.id,
            "anime_slug": anime.slug,
            "anime_title": anime.title,
            "episode_number": episode_number,
            **cls.get_anime_cover_payload(anime),
        }
        if aired_at is not None:
            data["aired_at"] = aired_at.isoformat()

        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
            title="New Episode",
            message=f"Episode {episode_number} of {anime.title} aired.",
            data=data,
            priority="medium",
        )

    @classmethod
    def create_review_reply_notification(cls, user, review, comment):
        """Create notification for review reply."""
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.REVIEW_REPLY,
            title="Review Reply",
            message=f"{comment.user.username} replied to your review of {review.anime.title}",
            data={
                "review_id": review.id,
                "comment_id": comment.id,
                "anime_id": review.anime.id,
                "anime_slug": review.anime.slug,
                "anime_title": review.anime.title,
                **cls.get_anime_cover_payload(review.anime),
                "replier_username": comment.user.username,
                "replier_id": comment.user.id,
            },
            priority="medium",
        )

    @classmethod
    def create_new_follower_notification(cls, user, follower):
        """Create notification for new follower."""
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.NEW_FOLLOWER,
            title="New Follower",
            message=f"{follower.username} started following you",
            data={
                "follower_id": follower.id,
                "follower_username": follower.username,
                "follower_avatar": get_user_avatar_url(follower),
            },
            priority="medium",
        )

    @classmethod
    def create_forum_reply_notification(cls, user, thread, post):
        """Create notification for forum reply."""
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.FORUM_REPLY,
            title="Forum Reply",
            message=f"{post.author.username} replied to your thread {thread.title}",
            data={
                "thread_id": thread.id,
                "post_id": post.id,
                "replier_username": post.author.username,
                "thread_title": thread.title,
            },
            priority="medium",
        )

    @classmethod
    def create_forum_reply_to_post_notification(cls, user, reply):
        """Create notification for reply to a specific post (threaded reply)."""
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.FORUM_REPLY,
            title="Forum Reply",
            message=f"{reply.author.username} replied to your post in {reply.thread.title}",
            data={
                "thread_id": reply.thread.id,
                "post_id": reply.id,
                "parent_post_id": reply.parent.id,
                "replier_username": reply.author.username,
                "thread_title": reply.thread.title,
                "is_threaded_reply": True,
            },
            priority="medium",
        )

    @classmethod
    def create_forum_mention_notification(cls, user, author, instance, is_thread=False):
        """Create notification for user mention."""
        item_type = "thread" if is_thread else "post"
        title = instance.title if is_thread else instance.thread.title
        thread_id = instance.id if is_thread else instance.thread.id

        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.FORUM_MENTION,
            title="Mentioned",
            message=f"{author.username} mentioned you in a {item_type} in {title}",
            data={
                "thread_id": thread_id,
                "mentioner_username": author.username,
                "thread_title": title,
                "is_thread": is_thread,
            },
            priority="medium",
        )

    @classmethod
    def create_forum_like_notification(cls, user, author, instance, is_thread=False):
        """Create notification for forum like."""
        title = instance.title if is_thread else instance.thread.title
        thread_id = instance.id if is_thread else instance.thread.id
        post_id = None if is_thread else instance.id

        def _build_message(primary_username: str, liker_count: int) -> str:
            target_label = "thread" if is_thread else "post"
            suffix = f": {title}" if is_thread else f" in {title}"
            return f"{cls._actor_summary(primary_username, liker_count)} liked your {target_label}{suffix}"

        base_data = {
            "thread_id": thread_id,
            "liker_username": author.username,
            "liker_usernames": [author.username],
            "liker_user_ids": [author.id],
            "liker_count": 1,
            "thread_title": title,
            "is_thread": is_thread,
        }
        if post_id is not None:
            base_data["post_id"] = post_id

        message = _build_message(author.username, 1)

        # Merge likes for the same target into a single unread notification.
        filters = {
            "user": user,
            "notification_type": Notification.NotificationType.FORUM_LIKE,
            "is_read": False,
            "data__thread_id": thread_id,
            "data__is_thread": is_thread,
        }
        if post_id is not None:
            filters["data__post_id"] = post_id

        try:
            with transaction.atomic():
                existing = (
                    Notification.objects.select_for_update()
                    .filter(**filters)
                    .order_by("-created_at")
                    .first()
                )

                if existing:
                    merged_data = cls._merge_actor_payload(
                        existing_data=existing.data or {},
                        base_data=base_data,
                        actor=author,
                        username_key="liker_username",
                        usernames_key="liker_usernames",
                        user_ids_key="liker_user_ids",
                        count_key="liker_count",
                    )
                    if post_id is None:
                        merged_data.pop("post_id", None)

                    existing.message = _build_message(
                        merged_data["liker_username"], merged_data["liker_count"]
                    )
                    existing.data = merged_data
                    existing.created_at = timezone.now()
                    existing.save(update_fields=["message", "data", "created_at"])

                    transaction.on_commit(lambda: cls._broadcast_notification_update(existing))
                    logger.info(
                        "Updated aggregated forum_like notification %s for user %s",
                        existing.id,
                        user.id,
                    )
                    return existing
        except Exception as e:
            logger.exception(f"Failed to update aggregated forum_like notification: {e}")

        # Fallback to creating a fresh notification if no unread aggregate exists.
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.FORUM_LIKE,
            title="New Like",
            message=message,
            data=base_data,
            priority="low",
        )

    @classmethod
    def create_review_like_notification(cls, user, author, review):
        """Create or update an aggregated notification for review likes."""
        if user.id == author.id:
            return None

        def _build_message(primary_username: str, liker_count: int) -> str:
            actor_summary = cls._actor_summary(primary_username, liker_count)
            return f"{actor_summary} liked your review of {review.anime.title}"

        base_data = {
            "review_id": review.id,
            "anime_id": review.anime.id,
            "anime_slug": review.anime.slug,
            "anime_title": review.anime.title,
            **cls.get_anime_cover_payload(review.anime),
            "liker_username": author.username,
            "liker_usernames": [author.username],
            "liker_user_ids": [author.id],
            "liker_count": 1,
        }

        try:
            with transaction.atomic():
                existing = (
                    Notification.objects.select_for_update()
                    .filter(
                        user=user,
                        notification_type=Notification.NotificationType.REVIEW_LIKE,
                        is_read=False,
                        data__review_id=review.id,
                    )
                    .order_by("-created_at")
                    .first()
                )

                if existing:
                    merged_data = cls._merge_actor_payload(
                        existing_data=existing.data or {},
                        base_data=base_data,
                        actor=author,
                        username_key="liker_username",
                        usernames_key="liker_usernames",
                        user_ids_key="liker_user_ids",
                        count_key="liker_count",
                    )
                    existing.message = _build_message(
                        merged_data["liker_username"], merged_data["liker_count"]
                    )
                    existing.data = merged_data
                    existing.created_at = timezone.now()
                    existing.save(update_fields=["message", "data", "created_at"])
                    transaction.on_commit(lambda: cls._broadcast_notification_update(existing))
                    return existing
        except Exception as e:
            logger.exception(f"Failed to update aggregated review_like notification: {e}")

        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.REVIEW_LIKE,
            title="Review Like",
            message=_build_message(author.username, 1),
            data=base_data,
            priority="low",
        )

    @classmethod
    def remove_review_like_from_notification(cls, user, author, review):
        """Remove a user from an unread review-like aggregate after an unlike."""
        try:
            with transaction.atomic():
                existing = (
                    Notification.objects.select_for_update()
                    .filter(
                        user=user,
                        notification_type=Notification.NotificationType.REVIEW_LIKE,
                        is_read=False,
                        data__review_id=review.id,
                    )
                    .order_by("-created_at")
                    .first()
                )
                if not existing:
                    return None

                existing_data = existing.data or {}
                actor_id = cls._coerce_actor_id(author.id)
                actor_username = author.username
                usernames = [
                    username
                    for username in existing_data.get("liker_usernames", [])
                    if isinstance(username, str) and username and username != actor_username
                ]
                user_ids = [
                    user_id
                    for value in existing_data.get("liker_user_ids", [])
                    if (user_id := cls._coerce_actor_id(value)) is not None and user_id != actor_id
                ]

                liker_count = len(user_ids) if user_ids else len(usernames)
                if liker_count <= 0:
                    notification_id = existing.id
                    user_id = existing.user_id
                    existing.delete()

                    def notify_after_commit():
                        unread_count = cls._decrement_unread_count(user_id)
                        cls._broadcast_unread_count(user_id, unread_count)
                        cls._broadcast_notification_deleted(user_id, notification_id, unread_count)

                    transaction.on_commit(notify_after_commit)
                    return None

                primary_username = usernames[0]
                existing_data.update(
                    {
                        "liker_username": primary_username,
                        "liker_usernames": usernames,
                        "liker_user_ids": user_ids,
                        "liker_count": liker_count,
                    }
                )
                existing.message = (
                    f"{cls._actor_summary(primary_username, liker_count)} "
                    f"liked your review of {review.anime.title}"
                )
                existing.data = existing_data
                existing.save(update_fields=["message", "data"])
                transaction.on_commit(lambda: cls._broadcast_notification_update(existing))
                return existing
        except Exception as e:
            logger.exception(f"Failed to remove actor from review_like notification: {e}")
            return None

    @classmethod
    def create_badge_awarded_notification(cls, user, badge, granted_by):
        """Create notification for badge award."""
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.BADGE_AWARDED,
            title="Badge Awarded",
            message=f"You've been awarded the {badge.name} badge!",
            data={
                "badge_id": badge.id,
                "badge_name": badge.name,
                "badge_slug": badge.slug,
                "granted_by_username": granted_by.username if granted_by else "System",
            },
            priority="high",
        )
