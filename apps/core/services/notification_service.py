from typing import Any, Dict

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.core.models import Notification, PushSubscription
from apps.shared.logger import logger
from apps.users.models import UserProfile
from apps.users.services.avatar_service import get_user_avatar_url

UNREAD_COUNT_CACHE_TTL_SECONDS = 24 * 60 * 60


class NotificationService:
    """Service for creating and managing user notifications."""

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

                unread_count = cls._increment_unread_count(user.id)

                # Broadcast via WebSocket channel layer
                cls._broadcast_notification(notification, unread_count=unread_count)

                return notification
        except Exception as e:
            logger.exception(f"Failed to create notification: {e}")
            return None

    @classmethod
    def _should_notify_user(cls, user, notification_type: str) -> bool:
        """Check if user should receive this notification type based on preferences."""
        try:
            profile = user.userprofile
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
                    "notification": {
                        "id": notification.id,
                        "notification_type": notification.notification_type,
                        "title": notification.title,
                        "message": notification.message,
                        "data": notification.data,
                        "priority": notification.priority,
                        "created_at": notification.created_at.isoformat(),
                        "is_read": False,
                    },
                    "unread_count": unread_count,
                },
            )
        except Exception:
            # Never let a broadcast failure break notification creation
            logger.exception("Failed to broadcast notification via WebSocket")

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
        updated = Notification.objects.filter(
            id=notification_id,
            user_id=user.id,
            is_read=False,
        ).update(
            is_read=True,
            read_at=timezone.now(),
        )
        if updated:
            unread_count = cls._decrement_unread_count(user.id)
            cls._broadcast_unread_count(user.id, unread_count)
            return True
        return Notification.objects.filter(id=notification_id, user_id=user.id).exists()

    @classmethod
    def mark_all_as_read(cls, user) -> int:
        """Mark all unread notifications as read for a user."""
        count = Notification.objects.filter(user=user, is_read=False).update(
            is_read=True, read_at=timezone.now()
        )
        cls._set_unread_count_cache(user.id, 0)
        cls._broadcast_unread_count(user.id, 0)
        logger.info(f"Marked {count} notifications as read for user {user.id}")
        return count

    @classmethod
    def get_unread_count(cls, user) -> int:
        """Get count of unread notifications for a user."""
        return cls.get_unread_count_for_user_id(user.id)

    @classmethod
    def cleanup_old_notifications(cls, days: int = 90) -> int:
        """Delete read notifications older than specified days."""
        from datetime import timedelta

        cutoff_date = timezone.now() - timedelta(days=days)
        deleted, _ = Notification.objects.filter(is_read=True, created_at__lt=cutoff_date).delete()
        logger.info(f"Cleaned up {deleted} old notifications")
        return deleted

    @classmethod
    def create_new_episode_notification(cls, user, anime, episode_number: int):
        """Create notification for new episode."""
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
            title="New Episode",
            message=f"Episode {episode_number} of {anime.title} is now available!",
            data={
                "anime_id": anime.id,
                "anime_slug": anime.slug,
                "anime_title": anime.title,
                "episode_number": episode_number,
            },
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
        item_type = "thread" if is_thread else "post"
        title = instance.title if is_thread else instance.thread.title
        thread_id = instance.id if is_thread else instance.thread.id

        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.FORUM_LIKE,
            title="New Like",
            message=f"{author.username} liked your {item_type} in {title}",
            data={
                "thread_id": thread_id,
                "liker_username": author.username,
                "thread_title": title,
                "is_thread": is_thread,
            },
            priority="low",
        )

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
