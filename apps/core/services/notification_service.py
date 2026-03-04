import logging
from typing import Optional, Dict, Any
from django.db import transaction
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from apps.core.models import Notification, PushSubscription
from apps.users.models import UserProfile

logger = logging.getLogger(__name__)


class NotificationService:
    """Service for creating and managing user notifications."""

    @classmethod
    def create_notification(
        cls,
        user,
        notification_type: str,
        title: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
        priority: str = "medium",
    ) -> Optional[Notification]:
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

                # Broadcast via WebSocket channel layer
                cls._broadcast_notification(notification)

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
    def _broadcast_notification(cls, notification):
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
            unread_count = Notification.objects.filter(
                user_id=notification.user_id, is_read=False
            ).count()

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
    def mark_as_read(cls, notification_id: int, user) -> bool:
        """Mark a notification as read."""
        try:
            notification = Notification.objects.get(id=notification_id, user=user)
            notification.mark_as_read()
            return True
        except Notification.DoesNotExist:
            return False

    @classmethod
    def mark_all_as_read(cls, user) -> int:
        """Mark all unread notifications as read for a user."""
        count = Notification.objects.filter(user=user, is_read=False).update(
            is_read=True, read_at=timezone.now()
        )
        logger.info(f"Marked {count} notifications as read for user {user.id}")
        return count

    @classmethod
    def get_unread_count(cls, user) -> int:
        """Get count of unread notifications for a user."""
        return Notification.objects.filter(user=user, is_read=False).count()

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
            title=f"New Episode: {anime.title}",
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
            title=f"New reply to your review",
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
            title=f"New Follower",
            message=f"{follower.username} started following you",
            data={
                "follower_id": follower.id,
                "follower_username": follower.username,
                "follower_avatar": follower.avatar if hasattr(follower, "avatar") else None,
            },
            priority="medium",
        )

    @classmethod
    def create_forum_reply_notification(cls, user, thread, post):
        """Create notification for forum reply."""
        return cls.create_notification(
            user=user,
            notification_type=Notification.NotificationType.FORUM_REPLY,
            title=f"New reply to your thread",
            message=f"{post.author.username} replied to your thread '{thread.title}'",
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
            title=f"New reply to your post",
            message=f"{reply.author.username} replied to your post in '{reply.thread.title}'",
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
            title=f"You were mentioned",
            message=f"{author.username} mentioned you in a {item_type} in '{title}'",
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
            title=f"New Like",
            message=f"{author.username} liked your {item_type} in '{title}'",
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
            title=f"New Badge: {badge.name}",
            message=f"You've been awarded the '{badge.name}' badge!",
            data={
                "badge_id": badge.id,
                "badge_name": badge.name,
                "badge_slug": badge.slug,
                "granted_by_username": granted_by.username if granted_by else "System",
            },
            priority="high",
        )
