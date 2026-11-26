"""Site announcements: a banner on the public site and, optionally, an in-app notice (G6)."""

from django.db.models import (
    SET_NULL,
    BooleanField,
    CharField,
    DateTimeField,
    ForeignKey,
    Index,
    Model,
    PositiveIntegerField,
    TextChoices,
    TextField,
)

from ...shared.models import TimestampMixin
from ..validators import validate_site_or_web_link

__all__ = [
    "Announcement",
]


class Announcement(TimestampMixin, Model):
    class Level(TextChoices):
        INFO = "info", "Info"
        SUCCESS = "success", "Success"
        WARNING = "warning", "Warning"
        CRITICAL = "critical", "Critical"

    class NotifyStatus(TextChoices):
        NONE = "", "Not sent"
        QUEUED = "queued", "Queued"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    title = CharField(max_length=120)
    body = TextField(blank=True)
    # https://… or a site path ("/schedule"); validated by validate_site_or_web_link.
    link_url = CharField(max_length=500, blank=True, validators=[validate_site_or_web_link])
    link_label = CharField(max_length=40, blank=True)
    level = CharField(max_length=10, choices=Level.choices, default=Level.INFO)
    is_active = BooleanField(default=True)
    show_banner = BooleanField(default=True)
    starts_at = DateTimeField(null=True, blank=True)
    ends_at = DateTimeField(null=True, blank=True)
    created_by = ForeignKey("users.CustomUser", SET_NULL, null=True, blank=True, related_name="+")
    notify_status = CharField(max_length=10, choices=NotifyStatus.choices, blank=True, default="")
    notify_queued_at = DateTimeField(null=True, blank=True)
    # Who the latest send was for ("all", "active_30d", "staff"), so a retry
    # reaches the same people and the admin can see it.
    notify_audience = CharField(max_length=20, blank=True, default="")
    notified_at = DateTimeField(null=True, blank=True)
    notified_count = PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]
        indexes = [Index(fields=["is_active", "show_banner", "-created_at"])]

    def __str__(self):
        return self.title
