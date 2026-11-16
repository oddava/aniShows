"""Log models (G6 Admin): request/system log and admin audit trail."""

from django.db.models import (
    SET_NULL,
    CharField,
    DateTimeField,
    ForeignKey,
    GenericIPAddressField,
    JSONField,
    Model,
    PositiveIntegerField,
    TextChoices,
    TextField,
)
from django.db.models.indexes import Index

__all__ = [
    "AuditLog",
    "SystemLog",
]


class SystemLog(Model):
    class LogLevel(TextChoices):
        DEBUG = "DEBUG", "Debug"
        INFO = "INFO", "Info"
        WARNING = "WARNING", "Warning"
        ERROR = "ERROR", "Error"
        CRITICAL = "CRITICAL", "Critical"

    class LogType(TextChoices):
        SYSTEM = "SYSTEM", "System"
        REQUEST = "REQUEST", "Request"
        AUTH = "AUTH", "Authentication"
        ADMIN = "ADMIN", "Admin Action"
        ERROR = "ERROR", "Error"
        SECURITY = "SECURITY", "Security"

    timestamp = DateTimeField(auto_now_add=True, db_index=True)
    level = CharField(max_length=10, choices=LogLevel.choices, default=LogLevel.INFO)
    log_type = CharField(max_length=20, choices=LogType.choices, default=LogType.SYSTEM)

    user = ForeignKey("users.CustomUser", SET_NULL, null=True, blank=True)
    user_ip = GenericIPAddressField(null=True, blank=True)

    method = CharField(max_length=10, blank=True)
    path = CharField(max_length=500, blank=True)
    status_code = PositiveIntegerField(null=True, blank=True)

    message = TextField()
    details = JSONField(default=dict, blank=True)

    duration_ms = PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            Index(fields=["level", "timestamp"]),
            Index(fields=["log_type", "timestamp"]),
            Index(fields=["user", "timestamp"]),
        ]

    def __str__(self):
        return f"[{self.timestamp}] {self.level}: {self.message[:50]}"


class AuditLog(Model):
    class ActionType(TextChoices):
        CREATE = "CREATE", "Create"
        UPDATE = "UPDATE", "Update"
        DELETE = "DELETE", "Delete"
        LOGIN = "LOGIN", "Login"
        LOGOUT = "LOGOUT", "Logout"
        EXPORT = "EXPORT", "Export"
        BULK_ACTION = "BULK_ACTION", "Bulk Action"

    timestamp = DateTimeField(auto_now_add=True, db_index=True)
    user = ForeignKey("users.CustomUser", SET_NULL, null=True, blank=True)
    user_ip = GenericIPAddressField(null=True, blank=True)

    action = CharField(max_length=20, choices=ActionType.choices)
    entity_type = CharField(max_length=50)
    entity_id = CharField(max_length=50, blank=True)
    entity_repr = CharField(max_length=200, blank=True)

    previous_state = JSONField(default=dict, blank=True)
    new_state = JSONField(default=dict, blank=True)
    changes = JSONField(default=dict, blank=True)

    metadata = JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            Index(fields=["action", "timestamp"]),
            Index(fields=["entity_type", "timestamp"]),
            Index(fields=["user", "timestamp"]),
        ]

    def __str__(self):
        return f"{self.user} {self.action} {self.entity_type} at {self.timestamp}"

    def save(self, *args, **kwargs):
        if self.previous_state and self.new_state:
            self.changes = self._compute_changes()
        super().save(*args, **kwargs)

    def _compute_changes(self):
        changes = {}
        all_keys = set(self.previous_state.keys()) | set(self.new_state.keys())

        for key in all_keys:
            old_val = self.previous_state.get(key)
            new_val = self.new_state.get(key)
            if old_val != new_val:
                changes[key] = {"old": old_val, "new": new_val}

        return changes
