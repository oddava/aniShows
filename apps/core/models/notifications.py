"""Notification models (G4 Notifications): in-app rows and web-push subscriptions."""

from django.db.models import (
    CASCADE,
    BooleanField,
    CharField,
    DateTimeField,
    ForeignKey,
    JSONField,
    Model,
    TextChoices,
    TextField,
    URLField,
)
from django.db.models.indexes import Index
from django.utils import timezone

from ...shared.models import CreatedAtMixin

__all__ = [
    "Notification",
    "PushSubscription",
]


class Notification(CreatedAtMixin, Model):
    class NotificationType(TextChoices):
        NEW_EPISODE = "new_episode", "New Episode"
        REVIEW_REPLY = "review_reply", "Review Reply"
        REVIEW_LIKE = "review_like", "Review Like"
        NEW_FOLLOWER = "new_follower", "New Follower"
        FORUM_REPLY = "forum_reply", "Forum Reply"
        FORUM_MENTION = "forum_mention", "Forum Mention"
        FORUM_LIKE = "forum_like", "Forum Like"
        BADGE_AWARDED = "badge_awarded", "Badge Awarded"
        SYSTEM = "system", "System"

    class Priority(TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="notifications")
    notification_type = CharField(max_length=20, choices=NotificationType.choices)

    title = CharField(max_length=200)
    message = TextField()
    data = JSONField(
        default=dict,
        blank=True,
        help_text="Additional data (anime_id, review_id, etc.)",
    )

    is_read = BooleanField(default=False, db_index=True)
    read_at = DateTimeField(null=True, blank=True)
    is_email_sent = BooleanField(default=False)
    is_push_sent = BooleanField(default=False)

    priority = CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "-created_at"]),
            Index(fields=["user", "is_read", "-created_at"]),
            Index(
                fields=["user", "notification_type", "is_read", "-created_at"],
                name="core_notif_user_type_read_idx",
            ),
            Index(fields=["notification_type", "-created_at"]),
            Index(fields=["is_email_sent", "created_at"]),
            Index(fields=["is_push_sent", "created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.title}"

    def mark_as_read(self):
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=["is_read", "read_at"])


class PushSubscription(CreatedAtMixin, Model):
    class DeviceType(TextChoices):
        BROWSER = "browser", "Browser"
        MOBILE = "mobile", "Mobile"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="push_subscriptions")
    endpoint = URLField()
    p256dh = CharField(max_length=255)
    auth = CharField(max_length=255)

    device_type = CharField(max_length=20, choices=DeviceType.choices, default=DeviceType.BROWSER)
    device_info = JSONField(default=dict, blank=True, help_text="Browser, OS, device details")

    is_active = BooleanField(default=True)
    last_used = DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "is_active"]),
            Index(fields=["endpoint"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.device_type}"

    def deactivate(self):
        self.is_active = False
        self.save(update_fields=["is_active"])
