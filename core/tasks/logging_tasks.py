import logging
from celery import shared_task
from core.models import SystemLog, AuditLog

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=5)
def log_request_async(self, log_data):
    """Asynchronously create a system log entry.

    This runs in the background via Celery to avoid blocking API responses.
    """
    try:
        SystemLog.objects.create(**log_data)
    except Exception as exc:
        logger.error(f"Failed to create async log entry: {exc}")
        # Retry on failure, but don't spam logs
        if self.request.retries < 3:
            raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=5)
def log_audit_async(self, log_data):
    """Asynchronously create an audit log entry."""
    try:
        AuditLog.objects.create(**log_data)
    except Exception as exc:
        logger.error(f"Failed to create async audit log: {exc}")
        if self.request.retries < 3:
            raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=5)
def log_exception_async(self, log_data):
    """Asynchronously log an exception."""
    try:
        SystemLog.objects.create(**log_data)
    except Exception as exc:
        logger.error(f"Failed to create async exception log: {exc}")
        if self.request.retries < 3:
            raise self.retry(exc=exc)
