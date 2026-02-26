import logging
from celery import shared_task
from django.utils import timezone
from django.conf import settings
from apps.core.models import Notification
from apps.core.services.notification_service import NotificationService
from apps.core.services.push_service import PushService
from apps.users.models import UserProfile
from apps.animes.models import Anime, ReviewComment
from apps.users.services.email_service import send_email_task

logger = logging.getLogger(__name__)


@shared_task
def send_pending_notifications():
    """Send pending notifications via email and push."""
    # Get unsent notifications (last 24 hours only)
    from datetime import timedelta

    cutoff = timezone.now() - timedelta(hours=24)

    notifications = Notification.objects.filter(
        is_email_sent=False, created_at__gte=cutoff
    ).select_related("user", "user__userprofile")

    for notification in notifications:
        try:
            profile = notification.user.userprofile

            # Send email if enabled
            if _should_send_email(notification, profile):
                _send_notification_email(notification)
                notification.is_email_sent = True

            # Send push if enabled
            if _should_send_push(notification, profile):
                sent = PushService.send_to_user(
                    user=notification.user,
                    title=notification.title,
                    message=notification.message,
                    data=notification.data,
                )
                if sent > 0:
                    notification.is_push_sent = True

            notification.save(update_fields=["is_email_sent", "is_push_sent"])

        except UserProfile.DoesNotExist:
            # User doesn't have a profile, skip
            pass
        except Exception as e:
            logger.exception(f"Failed to send notification {notification.id}: {e}")


def _should_send_email(notification, profile):
    """Check if email should be sent for this notification."""
    # Only send emails for new episodes, not for social interactions
    if notification.notification_type == Notification.NotificationType.NEW_EPISODE:
        return profile.email_new_episodes
    # All other types (review_reply, new_follower, forum_reply, forum_mention,
    # forum_like, system) do not send emails.
    return False


def _should_send_push(notification, profile):
    """Check if push should be sent for this notification."""
    if notification.notification_type == Notification.NotificationType.NEW_EPISODE:
        return profile.push_new_episodes
    elif notification.notification_type == Notification.NotificationType.REVIEW_REPLY:
        return profile.push_review_replies
    elif notification.notification_type == Notification.NotificationType.NEW_FOLLOWER:
        return profile.push_new_follower
    return True


def _send_notification_email(notification):
    """Send email for a notification. Currently only NEW_EPISODE is supported."""
    # Build email content — only new episode emails are sent
    if notification.notification_type == Notification.NotificationType.NEW_EPISODE:
        html_message = _build_new_episode_email(notification)
    else:
        # Shouldn't reach here; _should_send_email guards this
        logger.warning(
            f"_send_notification_email called for unsupported type: "
            f"{notification.notification_type}"
        )
        return

    send_email_task.delay(
        subject=notification.title,
        message=notification.message,
        recipient_list=[notification.user.email],
        html_message=html_message,
    )


def _build_new_episode_email(notification):
    """Build HTML email for new episode notification."""
    data = notification.data
    anime_title = data.get("anime_title", "Unknown Anime")
    episode_number = data.get("episode_number", "?")
    anime_slug = data.get("anime_slug", "")

    anime_url = f"{settings.FRONTEND_URL}/anime/{anime_slug}"

    return f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a1a2e; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">aniShows</h1>
        </div>
        <div style="padding: 20px; background: #f5f5f5;">
            <h2 style="color: #333;">{notification.title}</h2>
            <p style="color: #666; font-size: 16px;">{notification.message}</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{anime_url}" 
                   style="background: #e94560; color: white; padding: 12px 30px; 
                          text-decoration: none; border-radius: 5px; display: inline-block;">
                    Watch Now
                </a>
            </div>
        </div>
        <div style="background: #333; color: #999; padding: 15px; text-align: center; font-size: 12px;">
            <p>You're receiving this because you have this anime in your list.</p>
            <p><a href="{settings.FRONTEND_URL}/settings/notifications" style="color: #999;">
               Manage notification preferences</a></p>
        </div>
    </body>
    </html>
    """


@shared_task
def check_new_episodes():
    """Check for newly aired episodes and create notifications."""
    logger.info("Checking for new episodes...")

    # Find anime that have aired recently (in the last 24 hours)
    from datetime import timedelta as td

    yesterday = timezone.now() - td(hours=24)

    recently_aired = Anime.objects.filter(
        status=Anime.AnimeStatus.airing,
        next_airing_date__lte=timezone.now(),
        next_airing_date__gte=yesterday,
        next_airing_episode__isnull=False,
    )

    notifications_created = 0

    for anime in recently_aired:
        # Find users with this anime in their list (watching or plan_to_watch)
        from apps.users.models import UserAnimeList

        interested_users = UserAnimeList.objects.filter(
            anime=anime,
            status__in=[
                UserAnimeList.UserAnimeStatus.watching,
                UserAnimeList.UserAnimeStatus.plan_to_watch,
            ],
        ).select_related("user")

        for user_anime in interested_users:
            # Check if we already sent a notification for this episode
            existing = Notification.objects.filter(
                user=user_anime.user,
                notification_type=Notification.NotificationType.NEW_EPISODE,
                data__anime_id=anime.id,
                data__episode_number=anime.next_airing_episode,
                created_at__gte=yesterday,
            ).exists()

            if not existing:
                notification = NotificationService.create_new_episode_notification(
                    user=user_anime.user,
                    anime=anime,
                    episode_number=anime.next_airing_episode,
                )
                if notification:
                    notifications_created += 1

    logger.info(f"Created {notifications_created} new episode notifications")
    return notifications_created


@shared_task
def cleanup_old_notifications_task(days: int = 90):
    """Cleanup old read notifications."""
    deleted = NotificationService.cleanup_old_notifications(days)
    logger.info(f"Cleaned up {deleted} old notifications")
    return deleted
