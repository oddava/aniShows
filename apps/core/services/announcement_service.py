"""Site announcements: the public banner list and the in-app broadcast (G6)."""

from __future__ import annotations

from contextlib import suppress
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from ...shared.errors import CACHE_ERRORS
from ...shared.public_cache import best_effort_get, best_effort_set
from ..models import Announcement, Notification
from ..validators import is_site_path
from .notification_service import invalidate_unread_counts

User = get_user_model()

ACTIVE_CACHE_KEY = "announcements:active:v1"
ACTIVE_CACHE_SECONDS = 60
ACTIVE_LIMIT = 3
BODY_MAX_LENGTH = 1000
NOTIFY_CHUNK_SIZE = 1000
AUDIENCES = ("all", "active_30d", "staff")
TITLE_FIELD_MAX = 200


# A send still "queued" after this long lost its job (worker restart, broker
# flush); the admin may send it again.
NOTIFY_STUCK_AFTER = timedelta(minutes=15)


def announcement_send_is_stuck(announcement, now=None) -> bool:
    if announcement.notify_status != Announcement.NotifyStatus.QUEUED:
        return False
    queued_at = announcement.notify_queued_at
    return queued_at is None or queued_at < (now or timezone.now()) - NOTIFY_STUCK_AFTER


def dedupe_key(announcement_id: int) -> str:
    return f"announcement:{announcement_id}"


def active_announcements() -> list[dict]:
    """Live banner announcements, newest first (cached a minute, dropped on every change)."""
    cached = best_effort_get(ACTIVE_CACHE_KEY, source="announcements")
    if isinstance(cached, list):
        return cached
    now = timezone.now()
    rows = (
        Announcement.objects.filter(is_active=True, show_banner=True)
        .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now))
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        .order_by("-created_at")[:ACTIVE_LIMIT]
    )
    payload = [
        {
            "id": row.id,
            "title": row.title,
            "body": row.body,
            "link_url": row.link_url,
            "link_label": row.link_label,
            "level": row.level,
            "starts_at": row.starts_at.isoformat() if row.starts_at else None,
            "ends_at": row.ends_at.isoformat() if row.ends_at else None,
        }
        for row in rows
    ]
    best_effort_set(ACTIVE_CACHE_KEY, payload, _cache_seconds(now), source="announcements")
    return payload


def _cache_seconds(now) -> int:
    """At most a minute, and never past the next scheduled start or end.

    Saves and deletes clear the cache at once; this covers the windows that
    open or close on their own.
    """
    banners = Announcement.objects.filter(is_active=True, show_banner=True)
    upcoming = [
        moment
        for moment in (
            banners.filter(starts_at__gt=now)
            .order_by("starts_at")
            .values_list("starts_at", flat=True)
            .first(),
            banners.filter(ends_at__gt=now)
            .order_by("ends_at")
            .values_list("ends_at", flat=True)
            .first(),
        )
        if moment is not None
    ]
    if not upcoming:
        return ACTIVE_CACHE_SECONDS
    seconds_left = int((min(upcoming) - now).total_seconds()) + 1
    return max(1, min(ACTIVE_CACHE_SECONDS, seconds_left))


def invalidate_active_announcements() -> None:
    with suppress(*CACHE_ERRORS):
        cache.delete(ACTIVE_CACHE_KEY)


def audience_queryset(audience: str):
    users = User.objects.filter(is_active=True)
    if audience == "staff":
        return users.filter(Q(is_staff=True) | Q(is_superuser=True))
    if audience == "active_30d":
        since = timezone.now() - timedelta(days=30)
        return users.filter(
            Q(userprofile__last_activity__gte=since) | Q(last_login__gte=since)
        ).distinct()
    return users


def broadcast_announcement(announcement_id: int, audience: str) -> dict:
    """Create one in-app SYSTEM notification per recipient, in chunks; never push or email.

    The ``(user, dedupe_key)`` unique constraint plus ``ignore_conflicts`` makes a
    rerun (``force``, a retried task) skip everyone who already has it.
    """
    announcement = Announcement.objects.filter(pk=announcement_id).first()
    if announcement is None:
        return {"status": "skipped", "reason": "not_found"}
    if not announcement.is_active:
        # Switched off while the send waited in the queue: send nothing.
        Announcement.objects.filter(pk=announcement.pk).update(
            notify_status=Announcement.NotifyStatus.NONE, notify_queued_at=None
        )
        return {"status": "skipped", "reason": "inactive", "announcement_id": announcement.id}
    key = dedupe_key(announcement.id)
    message = announcement.body or announcement.title
    # In-app notices open site paths only (the notification list refuses other
    # URLs); an external link stays on the banner.
    link = announcement.link_url if is_site_path(announcement.link_url) else ""
    data = {"announcement_id": announcement.id, "url": link}
    try:
        created = _create_notifications(announcement, audience, key, message, data)
    except Exception:
        Announcement.objects.filter(pk=announcement.pk).update(
            notify_status=Announcement.NotifyStatus.FAILED
        )
        raise
    total = Notification.objects.filter(dedupe_key=key).count()
    Announcement.objects.filter(pk=announcement.pk).update(
        notify_status=Announcement.NotifyStatus.SENT,
        notified_at=timezone.now(),
        notified_count=total,
    )
    return {"status": "success", "announcement_id": announcement.id, "created": created}


def _create_notifications(announcement, audience: str, key: str, message: str, data: dict) -> int:
    """Bulk-create the notices in chunks; returns how many were really new."""
    recipients = (
        audience_queryset(audience)
        .exclude(notifications__dedupe_key=key)
        .order_by("pk")
        .values_list("pk", flat=True)
    )
    before = Notification.objects.filter(dedupe_key=key).count()
    last_pk = 0
    while True:
        chunk = list(recipients.filter(pk__gt=last_pk)[:NOTIFY_CHUNK_SIZE])
        if not chunk:
            break
        last_pk = chunk[-1]
        Notification.objects.bulk_create(
            [
                Notification(
                    user_id=user_id,
                    notification_type=Notification.NotificationType.SYSTEM,
                    title=announcement.title[:TITLE_FIELD_MAX],
                    message=message,
                    data=data,
                    dedupe_key=key,
                    # In-app only: the delivery sweeper skips rows already "sent".
                    is_email_sent=True,
                    is_push_sent=True,
                )
                for user_id in chunk
            ],
            ignore_conflicts=True,
        )
        invalidate_unread_counts(chunk)
    # bulk_create(ignore_conflicts=True) returns every row, skipped or not; count instead.
    return Notification.objects.filter(dedupe_key=key).count() - before
