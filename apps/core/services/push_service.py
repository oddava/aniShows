"""Web Push transport: VAPID, payload v1, per-subscription error handling."""

from __future__ import annotations

import enum
import json
from email.utils import parseaddr
from typing import Any

import requests  # type: ignore[import-untyped]
from django.conf import settings
from django.db.models import F
from django.utils import timezone
from pywebpush import WebPushException, webpush

from ...shared.logger import logger
from ..models import Notification, PushSubscription
from . import notification_types

PUSH_TIMEOUT_SECONDS = 10
# A subscription is dropped after this many consecutive transient failures.
MAX_TRANSIENT_FAILURES = 5
PUSH_BODY_MAX_CHARS = 180
PUSH_TITLE_MAX_CHARS = 80
PUSH_PAYLOAD_MAX_BYTES = 1024
PAYLOAD_VERSION = 1

GONE_STATUSES = frozenset({404, 410})
# Bad keys, VAPID mismatch or an oversized payload: retrying cannot help.
PERMANENT_STATUSES = frozenset({400, 403, 413})


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
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode()) > PUSH_PAYLOAD_MAX_BYTES:
        # Only an absurd URL can get here (title and body are capped): fall back.
        payload["url"] = "/notifications"
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return encoded


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
            if status in PERMANENT_STATUSES:
                logger.error(
                    "Push rejected with %s; deactivating subscription %s", status, subscription.pk
                )
                cls._deactivate(subscription)
                return PushResult.GONE
            if status is None or status == 429 or status >= 500:
                return cls._record_transient_failure(subscription, f"HTTP {status}")
            logger.warning("Push failed with %s for subscription %s", status, subscription.pk)
            return PushResult.FAILED
        except requests.RequestException as exc:
            return cls._record_transient_failure(subscription, type(exc).__name__)
        except Exception:
            # Malformed keys or VAPID config: logged, never retried, row left alone.
            logger.exception("Failed to send push notification to subscription %s", subscription.pk)
            return PushResult.FAILED

        PushSubscription.objects.filter(pk=subscription.pk).update(
            last_used=timezone.now(), failure_count=0
        )
        return PushResult.SENT

    @staticmethod
    def _deactivate(subscription: PushSubscription) -> None:
        PushSubscription.objects.filter(pk=subscription.pk).update(is_active=False)
        subscription.is_active = False

    @classmethod
    def _record_transient_failure(cls, subscription: PushSubscription, reason: str) -> PushResult:
        PushSubscription.objects.filter(pk=subscription.pk).update(
            failure_count=F("failure_count") + 1
        )
        failures = (
            PushSubscription.objects.filter(pk=subscription.pk)
            .values_list("failure_count", flat=True)
            .first()
            or 0
        )
        logger.warning(
            "Transient push failure (%s) for subscription %s (%s in a row)",
            reason,
            subscription.pk,
            failures,
        )
        if failures >= MAX_TRANSIENT_FAILURES:
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
            },
        )
        logger.info(
            "Push subscription %s for user %s", "created" if created else "updated", user.pk
        )
        return subscription

    @classmethod
    def unsubscribe_user(cls, user, endpoint: str) -> bool:
        """Remove this user's row for ``endpoint`` (logout, or "Disable on this device")."""
        deleted, _ = PushSubscription.objects.filter(user=user, endpoint=endpoint).delete()
        return bool(deleted)

    @classmethod
    def delete_device(cls, user, subscription_id: int) -> bool:
        deleted, _ = PushSubscription.objects.filter(user=user, pk=subscription_id).delete()
        return bool(deleted)
