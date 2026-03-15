from celery import shared_task

from apps.core.db_safety import (
    is_missing_relation_error,
    model_table_exists,
    warn_missing_table_once,
)
from apps.core.models import AuditLog, SystemLog
from apps.shared.logger import logger


@shared_task(bind=True, max_retries=3, default_retry_delay=5)
def log_request_async(self, log_data):
    """Asynchronously create a system log entry.

    This runs in the background via Celery to avoid blocking API responses.
    """
    if not model_table_exists(SystemLog):
        warn_missing_table_once(SystemLog._meta.db_table, "async request logging")
        return

    try:
        SystemLog.objects.create(**log_data)
    except Exception as exc:
        if is_missing_relation_error(exc):
            warn_missing_table_once(SystemLog._meta.db_table, "async request logging")
            return
        logger.error(f"Failed to create async log entry: {exc}")
        # Retry on failure, but don't spam logs
        if self.request.retries < 3:
            raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=5)
def log_audit_async(self, log_data):
    """Asynchronously create an audit log entry."""
    if not model_table_exists(AuditLog):
        warn_missing_table_once(AuditLog._meta.db_table, "async audit logging")
        return

    try:
        AuditLog.objects.create(**log_data)
    except Exception as exc:
        if is_missing_relation_error(exc):
            warn_missing_table_once(AuditLog._meta.db_table, "async audit logging")
            return
        logger.error(f"Failed to create async audit log: {exc}")
        if self.request.retries < 3:
            raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=5)
def log_exception_async(self, log_data):
    """Asynchronously log an exception."""
    if not model_table_exists(SystemLog):
        warn_missing_table_once(SystemLog._meta.db_table, "async exception logging")
        return

    try:
        SystemLog.objects.create(**log_data)
    except Exception as exc:
        if is_missing_relation_error(exc):
            warn_missing_table_once(SystemLog._meta.db_table, "async exception logging")
            return
        logger.error(f"Failed to create async exception log: {exc}")
        if self.request.retries < 3:
            raise self.retry(exc=exc)
