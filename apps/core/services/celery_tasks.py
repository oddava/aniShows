"""Service-layer implementations for core Celery tasks."""

from __future__ import annotations

import json
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from ...shared.logger import logger
from ...users.models import UserProfile
from ..db_safety import (
    model_table_exists,
    warn_missing_table_once,
)
from ..models import AuditLog, SystemLog
from .metadata_service import MetadataService
from .notification_tasks_service import NotificationTaskService


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
                CeleryTaskResult.objects.filter(date_created__lt=cutoff_date).values_list(
                    "id", flat=True
                )[:batch_size]
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
                logger.warning(
                    "Celery worker appears unhealthy", extra={"worker": worker.worker_name}
                )

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
                logger.warning(
                    "Failed to fetch social link metadata", extra={"url": url}, exc_info=True
                )

        updated = CoreTaskService._store_link_metadata(user_id, metadata_by_url)
        if updated is None:
            logger.warning(
                "UserProfile not found for batch metadata fetch", extra={"user_id": user_id}
            )
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

    # Notification tasks live in notification_tasks_service (G4). These keep the
    # old entry points working.
    @staticmethod
    def send_pending_notifications() -> dict:
        return NotificationTaskService.send_pending_notifications()

    @staticmethod
    def check_new_episodes() -> dict:
        return NotificationTaskService.check_new_episodes()

    @staticmethod
    def cleanup_old_notifications(days: int = 90) -> dict:
        return NotificationTaskService.cleanup_old_notifications(days=days)


def log_data_preview(log_data: dict) -> str:
    return json.dumps(log_data, default=str)[:500]
