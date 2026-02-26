import logging
from typing import Optional
from pywebpush import webpush, WebPushException
from django.conf import settings
from django.utils import timezone
from apps.core.models import PushSubscription

logger = logging.getLogger(__name__)


class PushService:
    """Service for sending Web Push notifications."""

    @classmethod
    def get_vapid_claims(cls) -> dict:
        """Get VAPID claims for Web Push."""
        return {
            "sub": f"mailto:{settings.DEFAULT_FROM_EMAIL}",
        }

    @classmethod
    def send_push_notification(
        cls,
        subscription: PushSubscription,
        title: str,
        message: str,
        data: Optional[dict] = None,
    ) -> bool:
        """Send a push notification to a subscription.

        Args:
            subscription: PushSubscription object
            title: Notification title
            message: Notification body
            data: Additional data to send with notification

        Returns:
            True if sent successfully, False otherwise
        """
        if not subscription.is_active:
            logger.debug(f"Skipping inactive subscription {subscription.id}")
            return False

        payload = {
            "title": title,
            "body": message,
            "data": data or {},
        }

        try:
            response = webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {
                        "p256dh": subscription.p256dh,
                        "auth": subscription.auth,
                    },
                },
                data=str(payload).replace("'", '"'),  # JSON string
                vapid_private_key=getattr(settings, "VAPID_PRIVATE_KEY", None),
                vapid_claims=cls.get_vapid_claims(),
            )

            subscription.last_used = timezone.now()
            subscription.save(update_fields=["last_used"])

            logger.info(f"Push notification sent to subscription {subscription.id}")
            return True

        except WebPushException as e:
            logger.warning(f"WebPush failed for subscription {subscription.id}: {e}")

            # Deactivate subscription if it's invalid or expired
            if e.response and e.response.status_code in [404, 410]:
                logger.info(f"Deactivating expired subscription {subscription.id}")
                subscription.deactivate()

            return False

        except Exception as e:
            logger.exception(f"Failed to send push notification: {e}")
            return False

    @classmethod
    def send_to_user(
        cls,
        user,
        title: str,
        message: str,
        data: Optional[dict] = None,
    ) -> int:
        """Send push notification to all active subscriptions for a user.

        Returns:
            Number of successfully sent notifications
        """
        subscriptions = PushSubscription.objects.filter(user=user, is_active=True)

        if not subscriptions.exists():
            logger.debug(f"No active push subscriptions for user {user.id}")
            return 0

        sent_count = 0
        for subscription in subscriptions:
            if cls.send_push_notification(subscription, title, message, data):
                sent_count += 1

        logger.info(
            f"Sent push notification to {sent_count}/{subscriptions.count()} devices for user {user.id}"
        )
        return sent_count

    @classmethod
    def subscribe_user(
        cls,
        user,
        endpoint: str,
        p256dh: str,
        auth: str,
        device_type: str = "browser",
        device_info: Optional[dict] = None,
    ) -> PushSubscription:
        """Create or update a push subscription for a user."""
        subscription, created = PushSubscription.objects.update_or_create(
            user=user,
            endpoint=endpoint,
            defaults={
                "p256dh": p256dh,
                "auth": auth,
                "device_type": device_type,
                "device_info": device_info or {},
                "is_active": True,
            },
        )

        action = "created" if created else "updated"
        logger.info(f"Push subscription {action} for user {user.id}")
        return subscription

    @classmethod
    def unsubscribe_user(cls, user, endpoint: str) -> bool:
        """Deactivate a push subscription."""
        try:
            subscription = PushSubscription.objects.get(user=user, endpoint=endpoint)
            subscription.deactivate()
            logger.info(f"Push subscription deactivated for user {user.id}")
            return True
        except PushSubscription.DoesNotExist:
            return False
