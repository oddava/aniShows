from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class SystemLog(models.Model):
    """System logs for audit trail and monitoring."""

    class LogLevel(models.TextChoices):
        DEBUG = "DEBUG", "Debug"
        INFO = "INFO", "Info"
        WARNING = "WARNING", "Warning"
        ERROR = "ERROR", "Error"
        CRITICAL = "CRITICAL", "Critical"

    class LogType(models.TextChoices):
        SYSTEM = "SYSTEM", "System"
        REQUEST = "REQUEST", "Request"
        AUTH = "AUTH", "Authentication"
        ADMIN = "ADMIN", "Admin Action"
        ERROR = "ERROR", "Error"
        SECURITY = "SECURITY", "Security"

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    level = models.CharField(
        max_length=10, choices=LogLevel.choices, default=LogLevel.INFO
    )
    log_type = models.CharField(
        max_length=20, choices=LogType.choices, default=LogType.SYSTEM
    )

    # User information
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    user_ip = models.GenericIPAddressField(null=True, blank=True)

    # Request information
    method = models.CharField(max_length=10, blank=True)
    path = models.CharField(max_length=500, blank=True)
    status_code = models.PositiveIntegerField(null=True, blank=True)

    # Log content
    message = models.TextField()
    details = models.JSONField(default=dict, blank=True)

    # Performance metrics
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["level", "timestamp"]),
            models.Index(fields=["log_type", "timestamp"]),
            models.Index(fields=["user", "timestamp"]),
        ]

    def __str__(self):
        return f"[{self.timestamp}] {self.level}: {self.message[:50]}"


class AuditLog(models.Model):
    """Detailed audit trail for important actions."""

    class ActionType(models.TextChoices):
        CREATE = "CREATE", "Create"
        UPDATE = "UPDATE", "Update"
        DELETE = "DELETE", "Delete"
        LOGIN = "LOGIN", "Login"
        LOGOUT = "LOGOUT", "Logout"
        EXPORT = "EXPORT", "Export"
        BULK_ACTION = "BULK_ACTION", "Bulk Action"

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    user_ip = models.GenericIPAddressField(null=True, blank=True)

    action = models.CharField(max_length=20, choices=ActionType.choices)
    entity_type = models.CharField(max_length=50)  # e.g., 'Anime', 'User', 'Review'
    entity_id = models.CharField(max_length=50, blank=True)
    entity_repr = models.CharField(
        max_length=200, blank=True
    )  # Human-readable representation

    # Change details
    previous_state = models.JSONField(default=dict, blank=True)
    new_state = models.JSONField(default=dict, blank=True)
    changes = models.JSONField(default=dict, blank=True)  # Computed diff

    # Additional context
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["action", "timestamp"]),
            models.Index(fields=["entity_type", "timestamp"]),
            models.Index(fields=["user", "timestamp"]),
        ]

    def __str__(self):
        return f"{self.user} {self.action} {self.entity_type} at {self.timestamp}"

    def save(self, *args, **kwargs):
        # Compute changes if both states are present
        if self.previous_state and self.new_state:
            self.changes = self._compute_changes()
        super().save(*args, **kwargs)

    def _compute_changes(self):
        """Compute the diff between previous and new state."""
        changes = {}
        all_keys = set(self.previous_state.keys()) | set(self.new_state.keys())

        for key in all_keys:
            old_val = self.previous_state.get(key)
            new_val = self.new_state.get(key)
            if old_val != new_val:
                changes[key] = {"old": old_val, "new": new_val}

        return changes
