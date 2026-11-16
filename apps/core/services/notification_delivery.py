"""Push and email delivery for notification rows (event-driven, plus a sweeper).

``notify`` enqueues ``deliver_notifications`` on commit for rows that still have a
channel pending. Each channel is *claimed* with a conditional update before it is
sent, so the task and the sweeper can race without double delivery; a transient
push failure releases the claim so the sweeper retries it later.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

import requests
from django.db.models import Q
from django.utils import timezone

from ...shared.logger import logger
from ..models import Notification
from . import notification_preferences as prefs
from . import notification_types
from .notification_email import send_notification_email
from .push_service import PushResult, PushService

if TYPE_CHECKING:
    from collections.abc import Iterable


DELIVERY_CHUNK_SIZE = 200
# The sweeper leaves fresh rows to the event-driven task and gives up after a day.
SWEEP_MIN_AGE = timedelta(minutes=2)
SWEEP_MAX_AGE = timedelta(hours=24)

PENDING = Q(is_push_sent=False) | Q(is_email_sent=False)


def _chunks(ids: list[int], size: int = DELIVERY_CHUNK_SIZE):
    for start in range(0, len(ids), size):
        yield ids[start : start + size]


def enqueue_delivery(notification_ids: Iterable[int]) -> None:
    """Queue delivery in chunks; if the broker is down the sweeper picks the rows up."""
    from ..tasks.notifications import deliver_notifications

    ids = list(notification_ids)
    for chunk in _chunks(ids):
        try:
            deliver_notifications.delay(chunk)
        except Exception:
            logger.exception("Failed to enqueue notification delivery for %s rows", len(chunk))


def _claim(notification_id: int, field: str) -> bool:
    return (
        Notification.objects.filter(pk=notification_id, **{field: False}).update(**{field: True})
        == 1
    )


def _release(notification_id: int, field: str) -> None:
    Notification.objects.filter(pk=notification_id).update(**{field: False})


def deliver(notification_ids: Iterable[int]) -> dict:
    """Deliver the pending channels of these rows; returns counters."""
    from .notification_service import NotificationService

    ids = list(dict.fromkeys(notification_ids))
    result = {"push_sent": 0, "push_retry": 0, "email_sent": 0, "skipped": 0}
    if not ids:
        return result
    rows = list(
        Notification.objects.filter(pk__in=ids)
        .filter(PENDING)
        .select_related("user", "user__userprofile")
    )
    preferences = prefs.preferences_for(row.user_id for row in rows)
    push_ready = PushService.is_configured()
    with requests.Session() as session:
        for notification in rows:
            category = notification_types.category_for(notification.notification_type)
            user_prefs = preferences[notification.user_id]
            try:
                if not notification.is_push_sent and _claim(notification.pk, "is_push_sent"):
                    if not (
                        push_ready
                        and notification.user.is_active
                        and prefs.wants(user_prefs, category, prefs.PUSH)
                    ):
                        result["skipped"] += 1
                    else:
                        outcome = PushService.send_notification(
                            notification,
                            unread_count=NotificationService.get_unread_count_for_user_id(
                                notification.user_id
                            ),
                            session=session,
                        )
                        if outcome is PushResult.SENT:
                            result["push_sent"] += 1
                        elif outcome is PushResult.RETRY:
                            _release(notification.pk, "is_push_sent")
                            result["push_retry"] += 1
                if not notification.is_email_sent and _claim(notification.pk, "is_email_sent"):
                    if prefs.wants(user_prefs, category, prefs.EMAIL) and send_notification_email(
                        notification
                    ):
                        result["email_sent"] += 1
                    else:
                        result["skipped"] += 1
            except Exception:
                logger.exception(
                    "Failed to deliver notification", extra={"notification_id": notification.pk}
                )
    return result


def sweep_pending(now=None) -> dict:
    """Deliver rows the event-driven path missed (aged 2 min to 24 h); expire older ones."""
    now = now or timezone.now()
    expired = Notification.objects.filter(PENDING, created_at__lt=now - SWEEP_MAX_AGE).update(
        is_push_sent=True, is_email_sent=True
    )
    ids = list(
        Notification.objects.filter(
            PENDING,
            created_at__gte=now - SWEEP_MAX_AGE,
            created_at__lte=now - SWEEP_MIN_AGE,
        )
        .order_by("created_at")
        .values_list("pk", flat=True)
    )
    totals = {"processed": len(ids), "expired": expired, "push_sent": 0, "push_retry": 0}
    totals.update({"email_sent": 0, "skipped": 0})
    for chunk in _chunks(ids):
        for key, value in deliver(chunk).items():
            totals[key] += value
    return totals
