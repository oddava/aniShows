from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from apps.animes.models import Anime
from apps.core.models import Notification
from apps.core.services.notification_service import NotificationService
from apps.core.services.push_service import PushService
from apps.shared.logger import logger
from apps.users.models import UserProfile
from apps.users.services.email_service import send_email_task

NEW_EPISODE_LOOKBACK_HOURS = 24
NEW_EPISODE_DEDUP_LOOKBACK_DAYS = 7


@shared_task
def send_pending_notifications():
    """Send pending notifications via email and push."""
    # Get notifications with at least one unsent delivery channel (last 24 hours only)
    from datetime import timedelta

    cutoff = timezone.now() - timedelta(hours=24)

    notifications = (
        Notification.objects.filter(created_at__gte=cutoff)
        .filter(Q(is_email_sent=False) | Q(is_push_sent=False))
        .select_related("user", "user__userprofile")
        .iterator(chunk_size=200)
    )
    pending_updates = []

    for notification in notifications:
        try:
            profile = notification.user.userprofile
            email_sent = notification.is_email_sent
            push_sent = notification.is_push_sent

            should_email = _should_send_email(notification, profile)
            should_push = _should_send_push(notification, profile)

            # Finalize channels that are not applicable to avoid perpetual retries.
            if not should_email:
                email_sent = True
            if not should_push:
                push_sent = True

            # Send email if applicable and not already sent
            if should_email and not email_sent:
                _send_notification_email(notification)
                email_sent = True

            # Send push if applicable and not already sent
            if should_push and not push_sent:
                if not PushService.has_active_subscriptions(notification.user):
                    push_sent = True
                else:
                    sent = PushService.send_to_user(
                        user=notification.user,
                        title=notification.title,
                        message=notification.message,
                        data=notification.data,
                    )
                    if sent > 0:
                        push_sent = True

            if (
                email_sent != notification.is_email_sent
                or push_sent != notification.is_push_sent
            ):
                notification.is_email_sent = email_sent
                notification.is_push_sent = push_sent
                pending_updates.append(notification)

            if len(pending_updates) >= 200:
                Notification.objects.bulk_update(
                    pending_updates, ["is_email_sent", "is_push_sent"], batch_size=200
                )
                pending_updates.clear()

        except UserProfile.DoesNotExist:
            # User doesn't have a profile, skip
            pass
        except Exception as e:
            logger.exception(f"Failed to send notification {notification.id}: {e}")

    if pending_updates:
        Notification.objects.bulk_update(
            pending_updates, ["is_email_sent", "is_push_sent"], batch_size=200
        )


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


def _get_recent_episode_events(window_start, now):
    """Return recently aired episode events keyed by anime ID."""
    events = {}

    confirmed_recently_aired = Anime.objects.filter(
        last_aired_at__gte=window_start,
        last_aired_at__lte=now,
        last_aired_episode__isnull=False,
    ).only("id", "slug", "title", "last_aired_episode", "last_aired_at")

    for anime in confirmed_recently_aired:
        events[anime.id] = {
            "anime": anime,
            "episode_number": anime.last_aired_episode,
            "aired_at": anime.last_aired_at,
        }

    pending_airing_updates = Anime.objects.filter(
        status=Anime.AnimeStatus.airing,
        next_airing_date__gte=window_start,
        next_airing_date__lte=now,
        next_airing_episode__isnull=False,
    ).only("id", "slug", "title", "next_airing_episode", "next_airing_date")

    for anime in pending_airing_updates:
        events.setdefault(
            anime.id,
            {
                "anime": anime,
                "episode_number": anime.next_airing_episode,
                "aired_at": anime.next_airing_date,
            },
        )

    return events


def _get_existing_new_episode_notifications(anime_ids, cutoff):
    """Build a dedup set for recent new-episode notifications."""
    existing_notifications = set()
    existing_notification_qs = Notification.objects.filter(
        notification_type=Notification.NotificationType.NEW_EPISODE,
        created_at__gte=cutoff,
    ).values_list("user_id", "data")

    for user_id, data in existing_notification_qs:
        anime_id = data.get("anime_id") if data else None
        if anime_id in anime_ids:
            existing_notifications.add((user_id, anime_id, data.get("episode_number")))

    return existing_notifications


@shared_task
def check_new_episodes():
    """Check for newly aired episodes and create notifications.

    Optimized to avoid O(anime x users) individual queries by:
    1. Pre-fetching all recently-aired anime IDs in one query
    2. Batch-fetching all interested users across all anime in one query
    3. Batch-fetching all existing notifications to build a set for dedup
    """
    logger.info("Checking for new episodes...")

    from datetime import timedelta as td

    from apps.users.models import UserAnimeList

    now = timezone.now()
    window_start = now - td(hours=NEW_EPISODE_LOOKBACK_HOURS)
    notification_cutoff = now - td(days=NEW_EPISODE_DEDUP_LOOKBACK_DAYS)

    episode_events = _get_recent_episode_events(window_start, now)
    if not episode_events:
        logger.info("No recently aired episodes found")
        return 0

    anime_ids = list(episode_events.keys())

    # Single query: all interested users across all recently-aired anime
    interested_entries = list(
        UserAnimeList.objects.filter(
            anime_id__in=anime_ids,
            status__in=[
                UserAnimeList.UserAnimeStatus.watching,
                UserAnimeList.UserAnimeStatus.plan_to_watch,
            ],
        ).select_related("user", "user__userprofile")
    )

    if not interested_entries:
        logger.info("No users interested in recently aired anime")
        return 0

    existing_notifications = _get_existing_new_episode_notifications(
        anime_ids=anime_ids,
        cutoff=notification_cutoff,
    )

    notifications_created = 0

    for user_anime in interested_entries:
        event = episode_events[user_anime.anime_id]
        anime = event["anime"]
        episode_number = event["episode_number"]
        dedup_key = (user_anime.user_id, anime.id, episode_number)

        if dedup_key not in existing_notifications:
            notification = NotificationService.create_new_episode_notification(
                user=user_anime.user,
                anime=anime,
                episode_number=episode_number,
                aired_at=event["aired_at"],
            )
            if notification:
                notifications_created += 1
                # Add to set to prevent duplicates within this batch
                existing_notifications.add(dedup_key)

    logger.info(f"Created {notifications_created} new episode notifications")
    return notifications_created

@shared_task
def cleanup_old_notifications_task(days: int = 90):
    """Cleanup old read notifications."""
    deleted = NotificationService.cleanup_old_notifications(days)
    logger.info(f"Cleaned up {deleted} old notifications")
    return deleted
