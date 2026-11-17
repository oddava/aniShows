"""Admin panel settings model (G6 Admin)."""

from django.db.models import (
    SET_NULL,
    CharField,
    ForeignKey,
    JSONField,
    Model,
)

from ...shared.models import TimestampMixin

__all__ = [
    "AdminPanelSettings",
]


class AdminPanelSettings(TimestampMixin, Model):
    key = CharField(max_length=50, unique=True, default="global")
    data = JSONField(default=dict, blank=True)
    updated_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        blank=True,
        related_name="updated_admin_panel_settings",
    )

    class Meta:
        verbose_name = "Admin Panel Settings"
        verbose_name_plural = "Admin Panel Settings"

    def __str__(self):
        return f"{self.key} settings"
