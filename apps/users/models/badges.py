"""Badge models (G5 Community): badge definitions and grants."""

from django.db.models import (
    CASCADE,
    SET_NULL,
    BooleanField,
    ForeignKey,
    ImageField,
    Index,
    Model,
    SlugField,
)
from django.db.models.fields import (
    CharField,
    DateTimeField,
    IntegerField,
    TextField,
)
from django.utils.text import slugify

from root.storage_backends import MediaStorage

from ...shared.models import CreatedAtMixin
from ..utils.file_security import badge_image_path

__all__ = [
    "Badge",
    "UserBadge",
]


class Badge(CreatedAtMixin, Model):
    name = CharField(max_length=100)
    slug = SlugField(max_length=100, unique=True, blank=True)
    description = TextField()
    icon = CharField(
        max_length=50, blank=True, help_text="Lucide icon name (e.g., 'award', 'shield')"
    )
    image = ImageField(upload_to=badge_image_path, blank=True, null=True, storage=MediaStorage())
    color = CharField(
        max_length=20, default="blue", help_text="Tailwind color key (e.g., 'yellow', 'purple')"
    )
    priority = IntegerField(
        default=0, help_text="Higher = more prestigious, controls display ordering"
    )
    is_active = BooleanField(default=True, help_text="Whether this badge can still be granted")
    created_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        related_name="created_badges",
    )

    class Meta:
        ordering = ["-priority", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.name)
            slug = base_slug
            counter = 2
            while Badge.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)


class UserBadge(Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="badges")
    badge = ForeignKey(Badge, CASCADE, related_name="user_badges")
    granted_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        related_name="granted_badges",
    )
    granted_at = DateTimeField(auto_now_add=True)
    is_featured = BooleanField(default=False, help_text="User chose to display this badge")
    reason = CharField(
        max_length=255, blank=True, help_text="Optional note for why this was granted"
    )

    class Meta:
        unique_together = ("user", "badge")
        ordering = ["-granted_at"]
        indexes = [
            Index(fields=["user", "is_featured"]),
            Index(fields=["badge"]),
            Index(fields=["user", "-granted_at"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.badge.name}"
