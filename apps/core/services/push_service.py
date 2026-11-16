"""Web Push transport: VAPID, payload v1, per-subscription error handling."""

from __future__ import annotations

import enum
import json
from datetime import timedelta
from email.utils import parseaddr
from typing import Any

import requests  # type: ignore[import-untyped, unused-ignore]
from django.conf import settings
from django.db.models import F, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from pywebpush import WebPushException, webpush

from ...shared.logger import logger
from ..models import Notification, PushSubscription
from . import notification_types

PUSH_TIMEOUT_SECONDS = 10
# A subscription is dropped after this many consecutive failures, and only once they have
# lasted FAILURE_GRACE: a burst (several rows sent in one sweep while the push service
# rate-limits, or a short VAPID mistake) never drops a device, however rarely it is used.
MAX_TRANSIENT_FAILURES = 5
FAILURE_GRACE = timedelta(hours=24)
PUSH_BODY_MAX_CHARS = 180
PUSH_TITLE_MAX_CHARS = 80
PUSH_PAYLOAD_MAX_BYTES = 1024
PUSH_URL_MAX_BYTES = 512
PAYLOAD_VERSION = 1

GONE_STATUSES = frozenset({404, 410})
# Bad keys or a VAPID mismatch: retrying this row cannot help, but a server-side VAPID
# mistake would answer 403 for every device, so these count as failures (see above)
# instead of deactivating at once.
REJECTED_STATUSES = frozenset({400, 403})
# The payload was too large: a problem with this notification, not with the device.
PAYLOAD_STATUSES = frozenset({413})


class PushResult(enum.Enum):
    SENT = "sent"
    GONE = "gone"  # endpoint expired or rejected for good; the row was deactivated
    RETRY = "retry"  # transient (429/5xx/timeout); the notification should stay pending
    FAILED = "failed"  # nothing more to do for this row


def _truncate(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def build_payload(notification: Notification, *, unread_count: int) -> str:
    """The frozen push payload v1, JSON-encoded and at most 1 KB."""
    payload: dict[str, Any] = {
        "v": PAYLOAD_VERSION,
        "title": _truncate(notification.title, PUSH_TITLE_MAX_CHARS),
        "body": _truncate(notification.message, PUSH_BODY_MAX_CHARS),
        "url": notification_types.url_for(notification) or "/notifications",
        "tag": notification_types.topic_for(notification) or f"n{notification.pk}",
        "notification_id": notification.pk,
        "unread_count": max(int(unread_count), 0),
    }
    # Multi-byte text (emoji, CJK) can exceed the budget even within the character caps:
    # trim the body, then the title, against the encoded size. The link is kept unless
    # it alone is too long, in which case it falls back to the list page.
    if len(payload["url"].encode()) > PUSH_URL_MAX_BYTES:
        payload["url"] = "/notifications"
    encoded = _encode(payload)
    for key, floor in (("body", 0), ("title", 1)):
        while len(encoded.encode()) > PUSH_PAYLOAD_MAX_BYTES and len(payload[key]) > floor:
            overflow = len(encoded.encode()) - PUSH_PAYLOAD_MAX_BYTES
            # A character is 1-4 bytes in UTF-8 (up to 6 when JSON-escaped): cut roughly
            # what's over, never much more, and loop until it fits.
            keep = max(floor, len(payload[key]) - max(2, overflow // 4))
            trimmed = payload[key][:keep].rstrip() + ("…" if keep else "")
            if len(trimmed) >= len(payload[key]):
                break
            payload[key] = trimmed
            encoded = _encode(payload)
    return encoded


def _encode(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


class PushService:
    """Service for sending Web Push notifications."""

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)

    @classmethod
    def public_config(cls) -> dict:
        enabled = cls.is_configured()
        return {"enabled": enabled, "public_key": settings.VAPID_PUBLIC_KEY if enabled else ""}

    @classmethod
    def has_active_subscriptions(cls, user) -> bool:
        """Return whether the user (or user id) currently has an active push endpoint."""
        user_id = getattr(user, "pk", user)
        return PushSubscription.objects.filter(user_id=user_id, is_active=True).exists()

    @classmethod
    def get_vapid_claims(cls) -> dict:
        """VAPID claims; ``sub`` must be a bare ``mailto:`` or ``https:`` URI."""
        subject = (getattr(settings, "VAPID_SUBJECT", "") or "").strip()
        if not subject:
            address = parseaddr(settings.DEFAULT_FROM_EMAIL)[1]
            subject = f"mailto:{address}" if address else settings.FRONTEND_URL.rstrip("/")
        return {"sub": subject}

    @classmethod
    def send_push_notification(
        cls,
        subscription: PushSubscription,
        payload: str,
        *,
        ttl: int,
        urgency: str,
        topic: str | None = None,
        session: requests.Session | None = None,
    ) -> PushResult:
        """Send one encoded payload to one subscription and record the outcome on it."""
        if not subscription.is_active:
            return PushResult.FAILED

        headers: dict[str, str | int | float] = {"Urgency": urgency}
        if topic:
            headers["Topic"] = topic
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims=cls.get_vapid_claims(),
                ttl=ttl,
                timeout=PUSH_TIMEOUT_SECONDS,
                headers=headers,
                requests_session=session,
            )
        except WebPushException as exc:
            # ``requests.Response`` is falsy for 4xx/5xx: compare with None, never truthiness.
            status = exc.response.status_code if exc.response is not None else None
            if status in GONE_STATUSES:
                logger.info("Push endpoint gone; deactivating subscription %s", subscription.pk)
                cls._deactivate(subscription)
                return PushResult.GONE
            if status in REJECTED_STATUSES:
                logger.error("Push rejected with %s for subscription %s", status, subscription.pk)
                cls._record_failure(subscription, f"HTTP {status}")
                return PushResult.FAILED
            if status in PAYLOAD_STATUSES:
                logger.error(
                    "Push payload rejected (%s) for subscription %s", status, subscription.pk
                )
                return PushResult.FAILED
            if status is None or status == 429 or status >= 500:
                return cls._record_failure(subscription, f"HTTP {status}")
            logger.warning("Push failed with %s for subscription %s", status, subscription.pk)
            return PushResult.FAILED
        except requests.RequestException as exc:
            return cls._record_failure(subscription, type(exc).__name__)
        except Exception:
            # Malformed keys or VAPID config: logged, never retried, row left alone.
            logger.exception("Failed to send push notification to subscription %s", subscription.pk)
            return PushResult.FAILED

        PushSubscription.objects.filter(pk=subscription.pk).update(
            last_used=timezone.now(), failure_count=0, failing_since=None
        )
        return PushResult.SENT

    @staticmethod
    def _deactivate(subscription: PushSubscription) -> None:
        PushSubscription.objects.filter(pk=subscription.pk).update(is_active=False)
        subscription.is_active = False

    @classmethod
    def _record_failure(cls, subscription: PushSubscription, reason: str) -> PushResult:
        """Count a failed send; RETRY, or GONE once the device has failed for a whole day."""
        now = timezone.now()
        PushSubscription.objects.filter(pk=subscription.pk).update(
            failure_count=F("failure_count") + 1,
            failing_since=Coalesce(F("failing_since"), Value(now)),
        )
        row = (
            PushSubscription.objects.filter(pk=subscription.pk)
            .values("failure_count", "failing_since")
            .first()
        )
        if row is None:
            return PushResult.GONE
        logger.warning(
            "Push failure (%s) for subscription %s (%s in a row)",
            reason,
            subscription.pk,
            row["failure_count"],
        )
        failing_since = row["failing_since"]
        if (
            row["failure_count"] >= MAX_TRANSIENT_FAILURES
            and failing_since is not None
            and failing_since < now - FAILURE_GRACE
        ):
            cls._deactivate(subscription)
            return PushResult.GONE
        return PushResult.RETRY

    @classmethod
    def send_notification(
        cls,
        notification: Notification,
        *,
        unread_count: int,
        session: requests.Session | None = None,
    ) -> PushResult:
        """Send ``notification`` to every active device of its user.

        SENT if any device got it; RETRY if none did but one may later; FAILED otherwise
        (no devices, or every device is gone).
        """
        subscriptions = list(
            PushSubscription.objects.filter(user_id=notification.user_id, is_active=True)
        )
        if not subscriptions:
            return PushResult.FAILED
        kind = notification_types.kind_for(notification.notification_type)
        policy = kind.push if kind else notification_types.PUSH_POLICIES["account"]
        payload = build_payload(notification, unread_count=unread_count)
        topic = notification_types.topic_for(notification)
        results = [
            cls.send_push_notification(
                subscription,
                payload,
                ttl=policy.ttl,
                urgency=policy.urgency,
                topic=topic,
                session=session,
            )
            for subscription in subscriptions
        ]
        if PushResult.SENT in results:
            return PushResult.SENT
        if PushResult.RETRY in results:
            return PushResult.RETRY
        return PushResult.FAILED

    @classmethod
    def subscribe_user(
        cls,
        user,
        endpoint: str,
        p256dh: str,
        auth: str,
        device_type: str = "browser",
        device_info: dict | None = None,
    ) -> PushSubscription:
        """Register ``endpoint`` for ``user``; an endpoint moves to whoever subscribes last."""
        subscription, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={
                "user": user,
                "p256dh": p256dh,
                "auth": auth,
                "device_type": device_type,
                "device_info": device_info or {},
                "is_active": True,
                "failure_count": 0,
                "failing_since": None,
            },
        )
        logger.info(
            "Push subscription %s for user %s", "created" if created else "updated", user.pk
        )
        return subscription

    @classmethod
    def refresh_subscription(
        cls, user, endpoint: str, p256dh: str, auth: str
    ) -> PushSubscription | None:
        """Re-activate this user's existing row for ``endpoint``; None when there is none.

        The app's daily re-sync uses this, so it can revive a device dropped after
        failures but never resurrect one the user removed (its row was deleted).
        """
        updated = PushSubscription.objects.filter(user=user, endpoint=endpoint).update(
            p256dh=p256dh, auth=auth, is_active=True, failure_count=0, failing_since=None
        )
        if not updated:
            return None
        return PushSubscription.objects.get(user=user, endpoint=endpoint)

    @classmethod
    def unsubscribe_user(cls, user, endpoint: str) -> bool:
        """Remove this user's row for ``endpoint`` (logout, or "Disable on this device")."""
        deleted, _ = PushSubscription.objects.filter(user=user, endpoint=endpoint).delete()
        return bool(deleted)

    @classmethod
    def delete_device(cls, user, subscription_id: int) -> bool:
        deleted, _ = PushSubscription.objects.filter(user=user, pk=subscription_id).delete()
        return bool(deleted)
