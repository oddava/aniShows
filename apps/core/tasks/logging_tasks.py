"""Celery task wrappers for async request and audit logging."""

from __future__ import annotations

import logging

from ...shared.celery import observed_shared_task
from ..db_safety import is_missing_relation_error
from ..services.celery_tasks import CoreTaskService, log_data_preview

logger = logging.getLogger(__name__)


@observed_shared_task(retry_policy="quick")
def log_request_async(self, log_data):
    try:
        return CoreTaskService.create_system_log(log_data)
    except Exception as exc:
        if is_missing_relation_error(exc):
            logger.warning("Skipping async request log because the relation is missing")
            return {"status": "skipped", "reason": "missing_relation"}
        logger.exception("Failed to create async request log", extra={"log_data": log_data_preview(log_data)})
        raise self.retry(exc=exc, countdown=5)


@observed_shared_task(retry_policy="quick")
def log_audit_async(self, log_data):
    try:
        return CoreTaskService.create_audit_log(log_data)
    except Exception as exc:
        if is_missing_relation_error(exc):
            logger.warning("Skipping async audit log because the relation is missing")
            return {"status": "skipped", "reason": "missing_relation"}
        logger.exception("Failed to create async audit log", extra={"log_data": log_data_preview(log_data)})
        raise self.retry(exc=exc, countdown=5)


@observed_shared_task(retry_policy="quick")
def log_exception_async(self, log_data):
    try:
        return CoreTaskService.create_system_log(log_data)
    except Exception as exc:
        if is_missing_relation_error(exc):
            logger.warning("Skipping async exception log because the relation is missing")
            return {"status": "skipped", "reason": "missing_relation"}
        logger.exception(
            "Failed to create async exception log",
            extra={"log_data": log_data_preview(log_data)},
        )
        raise self.retry(exc=exc, countdown=5)
