"""Accounts models (G1 Accounts & auth): identity, profile, social-link audit."""

from django.contrib.auth.models import AbstractUser
from django.db.models import (
    CASCADE,
    BooleanField,
    ForeignKey,
    GenericIPAddressField,
    ImageField,
    Index,
    JSONField,
    Model,
    OneToOneField,
    PositiveIntegerField,
    Q,
    TextChoices,
    UniqueConstraint,
)
from django.db.models.fields import (
    CharField,
    DateTimeField,
    EmailField,
    IntegerField,
    TextField,
)
from django.db.models.functions import Lower

from root.storage_backends import MediaStorage

from ...shared.models import CreatedAtMixin
from ..utils.file_security import user_avatar_path, user_banner_path

__all__ = [
    "CustomUser",
    "SocialLinkChangeLog",
    "UserProfile",
    "UserSession",
]


class CustomUser(AbstractUser):
    # Bumped by "sign out everywhere" (and suspension, password changes):
    # tokens carry the version they were issued under, and older ones are refused.
    session_version = PositiveIntegerField(default=0)

    class Meta(AbstractUser.Meta):
        constraints = [
            # One account per address, whatever its case. Blank emails (some
            # admin-created accounts) are exempt.
            UniqueConstraint(
                Lower("email"),
                condition=~Q(email=""),
                name="users_customuser_email_ci_unique",
            ),
            # "Bob" and "bob" are the same name (A13); lookups go through
            # user_queryset.filter_username_ci, which this index serves.
            UniqueConstraint(Lower("username"), name="users_customuser_username_ci_unique"),
        ]


class UserProfile(Model):
    user = OneToOneField("users.CustomUser", CASCADE, db_index=True)
    avatar = ImageField(upload_to=user_avatar_path, blank=True, null=True, storage=MediaStorage())
    banner = ImageField(upload_to=user_banner_path, blank=True, null=True, storage=MediaStorage())
    bio = TextField(blank=True, null=True)
    last_username_change = DateTimeField(null=True, blank=True)
    is_private = BooleanField(default=False)
    show_adult_content = BooleanField(default=False)
    email_verified = BooleanField(default=False)
    points = IntegerField(default=0)
    social_links = JSONField(default=list, blank=True)
    profile_primary_color = CharField(
        max_length=7,
        default="#8b5cf6",
        help_text="Hex color for profile accent (e.g., #8b5cf6)",
    )
    preferred_timezone = CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="IANA timezone name for localizing timestamps (blank uses auto-detected browser timezone).",
    )
    last_activity = DateTimeField(null=True, blank=True)
    # An email change waiting for its owner to confirm (A14); blank when none.
    pending_email = EmailField(blank=True, default="")
    pending_email_requested_at = DateTimeField(null=True, blank=True)
    email_new_episodes = BooleanField(default=True)
    push_new_episodes = BooleanField(default=True)
    push_review_replies = BooleanField(default=True)
    push_new_follower = BooleanField(default=True)


class SocialLinkChangeLog(CreatedAtMixin, Model):
    class ActionChoices(TextChoices):
        ADD = "add", "Add"
        EDIT = "edit", "Edit"
        DELETE = "delete", "Delete"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="social_link_logs")
    action = CharField(max_length=20, choices=ActionChoices.choices)
    old_value = JSONField(null=True, blank=True)
    new_value = JSONField(default=dict)
    ip_address = GenericIPAddressField()

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "-created_at"], name="soclinklog_user_created_idx"),
            Index(fields=["action", "-created_at"], name="soclinklog_action_created_idx"),
            Index(fields=["created_at"], name="soclinklog_created_idx"),
            Index(fields=["ip_address"], name="soclinklog_ip_address_idx"),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.action} at {self.created_at}"


class UserSession(Model):
    """One signed-in device: what Settings lists and can sign out (BUG-008).

    ``jti`` is the device's current refresh token; rotation moves it to the
    new token (services/device_sessions.py), so the row follows the device
    across refreshes. ``device`` is a short label from the User-Agent
    ("Firefox on Windows"); nothing else about the client is stored.
    """

    user = ForeignKey("users.CustomUser", CASCADE, related_name="device_sessions")
    jti = CharField(max_length=255, unique=True)
    device = CharField(max_length=80, blank=True, default="")
    created_at = DateTimeField(auto_now_add=True)
    last_seen_at = DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [Index(fields=["user", "-last_seen_at"], name="users_session_user_seen")]

    def __str__(self):
        return f"{self.user_id}: {self.device or 'device'}"
