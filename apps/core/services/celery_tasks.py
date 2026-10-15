"""Service-layer implementations for core Celery tasks."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from ...animes.models import Anime
from ...users.models import UserProfile
from ..db_safety import (
    model_table_exists,
    warn_missing_table_once,
)
from ..models import AuditLog, Notification, SystemLog
from .metadata_service import MetadataService
from .notification_service import NotificationService
from .push_service import PushService

logger = logging.getLogger(__name__)

NEW_EPISODE_LOOKBACK_HOURS = 24
NEW_EPISODE_DEDUP_LOOKBACK_DAYS = 7


class CoreTaskService:
    """Service methods used by Celery task wrappers in ``apps.core.tasks``."""

    @staticmethod
    def cleanup_old_task_results(days: int = 7, batch_size: int = 1000) -> dict:
        from ..models import CeleryTaskResult

        cutoff_date = timezone.now() - timedelta(days=days)
        total_to_delete = CeleryTaskResult.objects.filter(date_created__lt=cutoff_date).count()
        if total_to_delete == 0:
            logger.info("No custom Celery task results matched the cleanup window")
            return {"deleted": 0, "total_found": 0, "batches": 0, "days_threshold": days}

        logger.info(
            "Cleaning up custom Celery task results",
            extra={"total_to_delete": total_to_delete, "days": days, "batch_size": batch_size},
        )

        deleted_total = 0
        batches = 0
        while True:
            batch_ids = list(
                CeleryTaskResult.objects.filter(date_created__lt=cutoff_date)
                .values_list("id", flat=True)[:batch_size]
            )
            if not batch_ids:
                break

            deleted_count = CeleryTaskResult.objects.filter(id__in=batch_ids).delete()[0]
            deleted_total += deleted_count
            batches += 1
            logger.info(
                "Deleted Celery task result batch",
                extra={"batch_number": batches, "deleted_count": deleted_count},
            )

            if len(batch_ids) < batch_size:
                break

        return {
            "deleted": deleted_total,
            "total_found": total_to_delete,
            "batches": batches,
            "days_threshold": days,
        }

    @staticmethod
    def cleanup_celery_backend(days: int = 1) -> dict:
        logger.info(
            "Skipping explicit backend cleanup because Celery backend retention is handled elsewhere",
            extra={"days": days},
        )
        return {"status": "skipped", "reason": "automatic_cleanup_enabled", "days": days}

    @staticmethod
    def health_check_workers() -> dict:
        from ..models import CeleryWorkerStatus

        timeout_threshold = timezone.now() - timedelta(minutes=5)
        workers = list(CeleryWorkerStatus.objects.all())
        status_report = {
            "total_workers": len(workers),
            "healthy": 0,
            "unhealthy": 0,
            "details": [],
        }

        for worker in workers:
            is_healthy = bool(worker.last_heartbeat and worker.last_heartbeat > timeout_threshold)
            status_report["details"].append(
                {
                    "name": worker.worker_name,
                    "hostname": worker.hostname,
                    "healthy": is_healthy,
                    "last_heartbeat": worker.last_heartbeat.isoformat()
                    if worker.last_heartbeat
                    else None,
                    "processed_count": worker.processed_tasks,
                    "failed_count": worker.failed_tasks,
                }
            )
            if is_healthy:
                status_report["healthy"] += 1
            else:
                status_report["unhealthy"] += 1
                logger.warning("Celery worker appears unhealthy", extra={"worker": worker.worker_name})

        logger.info("Completed worker health check", extra=status_report)
        return status_report

    @staticmethod
    def flush_forum_view_counts(max_threads: int | None = None) -> dict:
        from ...forums.cache_utils import flush_buffered_thread_views

        result = flush_buffered_thread_views(max_threads=max_threads)
        logger.info("Flushed buffered forum views", extra=result)
        return result

    @staticmethod
    def collect_queue_metrics() -> dict:
        from .celery_monitoring import collect_queue_metrics

        result = collect_queue_metrics()
        logger.info("Collected Celery queue metrics", extra={"queues": result})
        return {"queues": result, "queue_count": len(result)}

    @staticmethod
    def _store_link_metadata(user_id: int, metadata_by_url: dict, link_index: int | None = None):
        """Attach fetched metadata to the user's *current* social links.

        Fetching takes seconds, so the links are re-read under a row lock
        afterwards; writing back a copy read before the fetch would undo any
        edit the user saved in the meantime. Returns ``None`` when the profile
        is gone, else whether anything changed.
        """
        with transaction.atomic():
            profile = UserProfile.objects.select_for_update().filter(user_id=user_id).first()
            if profile is None:
                return None

            social_links = profile.social_links or []
            updated = False
            for index, link in enumerate(social_links):
                if link_index is not None and index != link_index:
                    continue
                url = next(
                    (u for u in (link.get("url"), link.get("value")) if u in metadata_by_url),
                    None,
                )
                if url is not None:
                    link["metadata"] = metadata_by_url[url]
                    link["metadata_pending"] = False
                    updated = True

            if updated:
                profile.social_links = social_links
                profile.save(update_fields=["social_links"])
            return updated

    @staticmethod
    def fetch_link_metadata(url: str, user_id: int, link_index: int | None = None) -> dict:
        metadata = MetadataService().fetch_metadata(url)

        updated = CoreTaskService._store_link_metadata(user_id, {url: metadata}, link_index)
        if updated is None:
            logger.warning("UserProfile not found for metadata fetch", extra={"user_id": user_id})
            return {"status": "missing_profile", "user_id": user_id, "url": url}
        if updated:
            logger.info("Fetched and stored link metadata", extra={"user_id": user_id, "url": url})
            return {"status": "updated", "user_id": user_id, "url": url}

        logger.warning(
            "Link metadata fetched but matching social link was not found",
            extra={"user_id": user_id, "url": url, "link_index": link_index},
        )
        return {"status": "not_found", "user_id": user_id, "url": url}

    @staticmethod
    def fetch_multiple_link_metadata(urls: list[str], user_id: int) -> dict:
        service = MetadataService()
        metadata_by_url = {}
        failed = 0

        for url in urls:
            try:
                metadata_by_url[url] = service.fetch_metadata(url)
            except Exception:
                failed += 1
                logger.warning("Failed to fetch social link metadata", extra={"url": url}, exc_info=True)

        updated = CoreTaskService._store_link_metadata(user_id, metadata_by_url)
        if updated is None:
            logger.warning("UserProfile not found for batch metadata fetch", extra={"user_id": user_id})
            return {"status": "missing_profile", "user_id": user_id, "urls": urls}

        result = {
            "status": "updated" if updated else "noop",
            "user_id": user_id,
            "processed": len(metadata_by_url),
            "failed": failed,
        }
        logger.info("Completed batch social link metadata fetch", extra=result)
        return result

    @staticmethod
    def create_system_log(log_data: dict) -> dict:
        if not model_table_exists(SystemLog):
            warn_missing_table_once(SystemLog._meta.db_table, "async request logging")
            return {"status": "skipped", "reason": "missing_table"}

        SystemLog.objects.create(**log_data)
        return {"status": "created", "model": "SystemLog"}

    @staticmethod
    def create_audit_log(log_data: dict) -> dict:
        if not model_table_exists(AuditLog):
            warn_missing_table_once(AuditLog._meta.db_table, "async audit logging")
            return {"status": "skipped", "reason": "missing_table"}

        AuditLog.objects.create(**log_data)
        return {"status": "created", "model": "AuditLog"}

    @staticmethod
    def send_pending_notifications() -> dict:
        cutoff = timezone.now() - timedelta(hours=24)
        notifications = (
            Notification.objects.filter(created_at__gte=cutoff)
            .filter(Q(is_email_sent=False) | Q(is_push_sent=False))
            .select_related("user", "user__userprofile")
            .iterator(chunk_size=200)
        )

        pending_updates = []
        processed = 0
        email_sends = 0
        push_sends = 0
        skipped_missing_profile = 0
        failures = 0

        for notification in notifications:
            processed += 1
            try:
                profile = notification.user.userprofile
                email_sent = notification.is_email_sent
                push_sent = notification.is_push_sent

                should_email = _should_send_email(notification, profile)
                should_push = _should_send_push(notification, profile)

                if not should_email:
                    email_sent = True
                if not should_push:
                    push_sent = True

                if should_email and not email_sent:
                    _send_notification_email(notification)
                    email_sends += 1
                    email_sent = True

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
                            push_sends += sent
                            push_sent = True

                if email_sent != notification.is_email_sent or push_sent != notification.is_push_sent:
                    notification.is_email_sent = email_sent
                    notification.is_push_sent = push_sent
                    pending_updates.append(notification)

                if len(pending_updates) >= 200:
                    Notification.objects.bulk_update(
                        pending_updates,
                        ["is_email_sent", "is_push_sent"],
                        batch_size=200,
                    )
                    pending_updates.clear()
            except UserProfile.DoesNotExist:
                skipped_missing_profile += 1
                logger.warning(
                    "Skipping notification because the user profile is missing",
                    extra={"notification_id": notification.id, "user_id": notification.user_id},
                )
            except Exception:
                failures += 1
                logger.exception(
                    "Failed to deliver pending notification",
                    extra={"notification_id": notification.id},
                )

        if pending_updates:
            Notification.objects.bulk_update(
                pending_updates,
                ["is_email_sent", "is_push_sent"],
                batch_size=200,
            )

        result = {
            "processed": processed,
            "email_sends": email_sends,
            "push_sends": push_sends,
            "skipped_missing_profile": skipped_missing_profile,
            "failures": failures,
        }
        logger.info("Processed pending notifications", extra=result)
        return result

    @staticmethod
    def check_new_episodes() -> dict:
        from ...users.models import UserAnimeList

        now = timezone.now()
        window_start = now - timedelta(hours=NEW_EPISODE_LOOKBACK_HOURS)
        notification_cutoff = now - timedelta(days=NEW_EPISODE_DEDUP_LOOKBACK_DAYS)

        episode_events = _get_recent_episode_events(window_start, now)
        if not episode_events:
            logger.info("No recently aired episodes found")
            return {"notifications_created": 0, "anime_candidates": 0, "user_entries": 0}

        anime_ids = list(episode_events.keys())
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
            logger.info("No users were watching recently aired anime", extra={"anime_ids": anime_ids})
            return {"notifications_created": 0, "anime_candidates": len(anime_ids), "user_entries": 0}

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
            if dedup_key in existing_notifications:
                continue

            notification = NotificationService.create_new_episode_notification(
                user=user_anime.user,
                anime=anime,
                episode_number=episode_number,
                aired_at=event["aired_at"],
            )
            if notification:
                notifications_created += 1
                existing_notifications.add(dedup_key)

        result = {
            "notifications_created": notifications_created,
            "anime_candidates": len(anime_ids),
            "user_entries": len(interested_entries),
        }
        logger.info("Checked new episode notifications", extra=result)
        return result

    @staticmethod
    def cleanup_old_notifications(days: int = 90) -> dict:
        deleted = NotificationService.cleanup_old_notifications(days)
        result = {"deleted": deleted, "days": days}
        logger.info("Cleaned up old notifications", extra=result)
        return result


def _should_send_email(notification, profile):
    if notification.notification_type == Notification.NotificationType.NEW_EPISODE:
        return profile.email_new_episodes
    return False


def _should_send_push(notification, profile):
    if notification.notification_type == Notification.NotificationType.NEW_EPISODE:
        return profile.push_new_episodes
    if notification.notification_type in (
        Notification.NotificationType.REVIEW_REPLY,
        Notification.NotificationType.REVIEW_LIKE,
    ):
        return profile.push_review_replies
    if notification.notification_type == Notification.NotificationType.NEW_FOLLOWER:
        return profile.push_new_follower
    return True


def _send_notification_email(notification):
    from ...users.services.email_service import send_email_task

    if notification.notification_type != Notification.NotificationType.NEW_EPISODE:
        logger.warning(
            "Notification email dispatch skipped for unsupported type",
            extra={
                "notification_id": notification.id,
                "notification_type": notification.notification_type,
            },
        )
        return

    html_message = _build_new_episode_email(notification)
    send_email_task.delay(
        subject=notification.title,
        message=notification.message,
        recipient_list=[notification.user.email],
        html_message=html_message,
    )


def _build_new_episode_email(notification):
    anime_slug = (notification.data or {}).get("anime_slug", "")
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


def log_data_preview(log_data: dict) -> str:
    return json.dumps(log_data, default=str)[:500]
