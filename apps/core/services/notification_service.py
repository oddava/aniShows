import logging
from typing import Optional, Dict, Any
from django.db import transaction
from django.utils import timezone
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
            logger.debug(
                f"Skipping notification for user {user.id}: preferences disabled"
            )
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
                logger.info(
                    f"Created {notification_type} notification for user {user.id}"
                )
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
        cutoff_date = timezone.now() - timezone.timedelta(days=days)
        deleted, _ = Notification.objects.filter(
            is_read=True, created_at__lt=cutoff_date
        ).delete()
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
                "follower_avatar": follower.avatar
                if hasattr(follower, "avatar")
                else None,
            },
            priority="medium",
        )
