"""Notification models (G4 Notifications): in-app rows, web-push devices, preferences."""

from django.db.models import (
    CASCADE,
    SET_NULL,
    BooleanField,
    CharField,
    DateTimeField,
    ForeignKey,
    JSONField,
    Model,
    OneToOneField,
    PositiveIntegerField,
    Q,
    TextChoices,
    TextField,
    UniqueConstraint,
    URLField,
)
from django.db.models.indexes import Index

from ...shared.models import CreatedAtMixin

__all__ = [
    "Notification",
    "NotificationPreference",
    "PushSubscription",
]

# Longest push endpoint we accept (the subscribe serializer enforces the same).
PUSH_ENDPOINT_MAX_LENGTH = 2048
NOTIFICATION_KEY_MAX_LENGTH = 160


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
    actor = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="Who caused the notification (the latest one for aggregates).",
    )
    notification_type = CharField(max_length=20, choices=NotificationType.choices)

    title = CharField(max_length=200)
    message = TextField()
    data = JSONField(
        default=dict,
        blank=True,
        help_text="Additional data (anime_id, review_id, etc.)",
    )

    # Idempotency: one row per (user, dedupe_key), ever. Aggregation: at most one
    # unread row per (user, group_key). Both are enforced by partial unique indexes.
    dedupe_key = CharField(max_length=NOTIFICATION_KEY_MAX_LENGTH, null=True, blank=True)
    group_key = CharField(max_length=NOTIFICATION_KEY_MAX_LENGTH, null=True, blank=True)

    is_read = BooleanField(default=False, db_index=True)
    read_at = DateTimeField(null=True, blank=True)
    # True once the channel is done: delivered, or not wanted for this row.
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
            # The delivery sweeper only ever looks at rows with work left.
            Index(
                fields=["created_at"],
                name="core_notif_pending_idx",
                condition=Q(is_push_sent=False) | Q(is_email_sent=False),
            ),
        ]
        constraints = [
            UniqueConstraint(
                fields=["user", "dedupe_key"],
                condition=Q(dedupe_key__isnull=False),
                name="core_notif_user_dedupe_uniq",
            ),
            UniqueConstraint(
                fields=["user", "group_key"],
                condition=Q(group_key__isnull=False, is_read=False),
                name="core_notif_user_group_unread_uniq",
            ),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.title}"


class PushSubscription(CreatedAtMixin, Model):
    class DeviceType(TextChoices):
        BROWSER = "browser", "Browser"
        MOBILE = "mobile", "Mobile"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="push_subscriptions")
    # A browser endpoint belongs to exactly one account: the last one that subscribed.
    endpoint = URLField(max_length=PUSH_ENDPOINT_MAX_LENGTH)
    p256dh = CharField(max_length=255)
    auth = CharField(max_length=255)

    device_type = CharField(max_length=20, choices=DeviceType.choices, default=DeviceType.BROWSER)
    device_info = JSONField(default=dict, blank=True, help_text="Browser, OS, device details")

    is_active = BooleanField(default=True)
    last_used = DateTimeField(null=True, blank=True)
    # Consecutive transient failures (429/5xx/timeouts); reset on success.
    failure_count = PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "is_active"]),
        ]
        constraints = [
            UniqueConstraint(fields=["endpoint"], name="core_pushsub_endpoint_uniq"),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.device_type}"

    def deactivate(self):
        self.is_active = False
        self.save(update_fields=["is_active"])


class NotificationPreference(Model):
    """Per-user notification choices, ``{category: {channel: bool}}``.

    Read through ``apps.core.services.notification_preferences``: unknown keys are
    dropped and defaults are merged on read, so a missing row means defaults.
    """

    user = OneToOneField(
        "users.CustomUser",
        CASCADE,
        primary_key=True,
        related_name="notification_preference",
    )
    preferences = JSONField(default=dict, blank=True)
    updated_at = DateTimeField(auto_now=True)

    def __str__(self):
        return f"Notification preferences of user {self.user_id}"
