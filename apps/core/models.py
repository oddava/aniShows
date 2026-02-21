from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

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


class CeleryTaskResult(models.Model):
    """Store and track Celery task execution results."""

    class TaskStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        STARTED = "STARTED", "Started"
        SUCCESS = "SUCCESS", "Success"
        FAILURE = "FAILURE", "Failure"
        RETRY = "RETRY", "Retry"
        REVOKED = "REVOKED", "Revoked"

    # Task identification
    task_id = models.CharField(max_length=255, unique=True, db_index=True)
    task_name = models.CharField(max_length=255, db_index=True)
    task_module = models.CharField(max_length=255, blank=True)

    # Status tracking
    status = models.CharField(
        max_length=20,
        choices=TaskStatus.choices,
        default=TaskStatus.PENDING,
        db_index=True,
    )

    # Timing
    date_created = models.DateTimeField(auto_now_add=True, db_index=True)
    date_started = models.DateTimeField(null=True, blank=True)
    date_completed = models.DateTimeField(null=True, blank=True)

    # Execution details
    worker = models.CharField(max_length=255, blank=True)
    queue = models.CharField(max_length=100, blank=True)

    # Task arguments and result
    task_args = models.JSONField(default=list, blank=True)
    task_kwargs = models.JSONField(default=dict, blank=True)
    result_data = models.JSONField(default=dict, blank=True, null=True)
    result_summary = models.TextField(blank=True)

    # Error information
    traceback = models.TextField(blank=True)
    error_message = models.TextField(blank=True)

    # Execution metrics
    execution_time = models.FloatField(null=True, blank=True)  # in seconds
    retries = models.PositiveIntegerField(default=0)

    # User who triggered the task (if applicable)
    triggered_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_tasks",
    )

    class Meta:
        ordering = ["-date_created"]
        indexes = [
            models.Index(fields=["task_name", "status", "date_created"]),
            models.Index(fields=["status", "date_created"]),
            models.Index(fields=["worker", "date_created"]),
        ]
        verbose_name = "Celery Task Result"
        verbose_name_plural = "Celery Task Results"

    def __str__(self):
        return f"{self.task_name} ({self.status}) - {self.date_created.strftime('%Y-%m-%d %H:%M')}"

    @property
    def is_success(self):
        return self.status == self.TaskStatus.SUCCESS

    @property
    def is_failure(self):
        return self.status in [self.TaskStatus.FAILURE, self.TaskStatus.REVOKED]

    @property
    def is_running(self):
        return self.status in [
            self.TaskStatus.PENDING,
            self.TaskStatus.STARTED,
            self.TaskStatus.RETRY,
        ]

    @property
    def duration_display(self):
        if self.execution_time:
            if self.execution_time < 60:
                return f"{self.execution_time:.1f}s"
            elif self.execution_time < 3600:
                return f"{self.execution_time / 60:.1f}m"
            else:
                return f"{self.execution_time / 3600:.2f}h"
        return "N/A"


class CeleryWorkerStatus(models.Model):
    """Track Celery worker status and health."""

    class WorkerStatus(models.TextChoices):
        ONLINE = "ONLINE", "Online"
        OFFLINE = "OFFLINE", "Offline"
        BUSY = "BUSY", "Busy"
        ERROR = "ERROR", "Error"

    worker_name = models.CharField(max_length=255, unique=True, db_index=True)
    status = models.CharField(
        max_length=20, choices=WorkerStatus.choices, default=WorkerStatus.OFFLINE
    )

    # Worker info
    hostname = models.CharField(max_length=255, blank=True)
    pid = models.PositiveIntegerField(null=True, blank=True)
    queues = models.JSONField(default=list, blank=True)

    # Task statistics
    processed_tasks = models.PositiveIntegerField(default=0)
    active_tasks = models.PositiveIntegerField(default=0)
    failed_tasks = models.PositiveIntegerField(default=0)

    # Timestamps
    last_heartbeat = models.DateTimeField(null=True, blank=True)
    last_checked = models.DateTimeField(auto_now=True)
    first_seen = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_heartbeat"]
        verbose_name = "Celery Worker"
        verbose_name_plural = "Celery Workers"

    def __str__(self):
        return f"{self.worker_name} ({self.status})"


class CeleryTaskSchedule(models.Model):
    """Custom scheduled tasks managed via admin."""

    class ScheduleType(models.TextChoices):
        CRONTAB = "CRONTAB", "Crontab"
        INTERVAL = "INTERVAL", "Interval"
        DATETIME = "DATETIME", "One-time"

    class TaskStatus(models.TextChoices):
        ENABLED = "ENABLED", "Enabled"
        DISABLED = "DISABLED", "Disabled"
        RUNNING = "RUNNING", "Running"

    name = models.CharField(max_length=255, unique=True)
    task_name = models.CharField(
        max_length=255,
        help_text="Full task path, e.g., anime.tasks.sync.sync_anime_catalog",
    )
    description = models.TextField(blank=True)

    # Schedule configuration
    schedule_type = models.CharField(
        max_length=20, choices=ScheduleType.choices, default=ScheduleType.CRONTAB
    )

    # Crontab schedule
    crontab_minute = models.CharField(max_length=20, default="*", blank=True)
    crontab_hour = models.CharField(max_length=20, default="*", blank=True)
    crontab_day_of_week = models.CharField(max_length=20, default="*", blank=True)
    crontab_day_of_month = models.CharField(max_length=20, default="*", blank=True)
    crontab_month_of_year = models.CharField(max_length=20, default="*", blank=True)

    # Interval schedule
    interval_every = models.PositiveIntegerField(default=1, null=True, blank=True)
    interval_period = models.CharField(
        max_length=20,
        choices=[
            ("days", "Days"),
            ("hours", "Hours"),
            ("minutes", "Minutes"),
            ("seconds", "Seconds"),
            ("microseconds", "Microseconds"),
        ],
        default="hours",
        blank=True,
    )

    # One-time schedule
    one_time_datetime = models.DateTimeField(null=True, blank=True)

    # Task arguments
    task_args = models.JSONField(
        default=list, blank=True, help_text="Positional arguments as JSON list"
    )
    task_kwargs = models.JSONField(
        default=dict, blank=True, help_text="Keyword arguments as JSON dict"
    )
    queue = models.CharField(max_length=100, default="default", blank=True)

    # Status and tracking
    status = models.CharField(
        max_length=20, choices=TaskStatus.choices, default=TaskStatus.ENABLED
    )
    total_run_count = models.PositiveIntegerField(default=0)
    last_run_at = models.DateTimeField(null=True, blank=True)
    next_run_at = models.DateTimeField(null=True, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Celery Task Schedule"
        verbose_name_plural = "Celery Task Schedules"

    def __str__(self):
        return f"{self.name} ({self.schedule_type})"

    def get_celery_schedule(self):
        """Convert to Celery schedule format."""
        if self.schedule_type == self.ScheduleType.CRONTAB:
            from celery.schedules import crontab

            return crontab(
                minute=self.crontab_minute,
                hour=self.crontab_hour,
                day_of_week=self.crontab_day_of_week,
                day_of_month=self.crontab_day_of_month,
                month_of_year=self.crontab_month_of_year,
            )
        elif self.schedule_type == self.ScheduleType.INTERVAL:
            from celery.schedules import schedule
            import datetime

            period_map = {
                "days": datetime.timedelta(days=self.interval_every),
                "hours": datetime.timedelta(hours=self.interval_every),
                "minutes": datetime.timedelta(minutes=self.interval_every),
                "seconds": datetime.timedelta(seconds=self.interval_every),
                "microseconds": datetime.timedelta(microseconds=self.interval_every),
            }
            return schedule(
                period_map.get(self.interval_period, datetime.timedelta(hours=1))
            )
        return None


class Notification(models.Model):
    """User notifications for various events."""

    class NotificationType(models.TextChoices):
        NEW_EPISODE = "new_episode", "New Episode"
        REVIEW_REPLY = "review_reply", "Review Reply"
        NEW_FOLLOWER = "new_follower", "New Follower"
        FORUM_REPLY = "forum_reply", "Forum Reply"
        FORUM_MENTION = "forum_mention", "Forum Mention"
        FORUM_LIKE = "forum_like", "Forum Like"
        SYSTEM = "system", "System"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="notifications"
    )
    notification_type = models.CharField(
        max_length=20, choices=NotificationType.choices
    )

    # Content
    title = models.CharField(max_length=200)
    message = models.TextField()
    data = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional data (anime_id, review_id, etc.)",
    )

    # Status tracking
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    is_email_sent = models.BooleanField(default=False)
    is_push_sent = models.BooleanField(default=False)

    # Priority for delivery ordering
    priority = models.CharField(
        max_length=10, choices=Priority.choices, default=Priority.MEDIUM
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["user", "is_read", "-created_at"]),
            models.Index(fields=["notification_type", "-created_at"]),
            models.Index(fields=["is_email_sent", "created_at"]),
            models.Index(fields=["is_push_sent", "created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.title}"

    def mark_as_read(self):
        """Mark notification as read."""
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=["is_read", "read_at"])


class PushSubscription(models.Model):
    """Web Push subscription data for users."""

    class DeviceType(models.TextChoices):
        BROWSER = "browser", "Browser"
        MOBILE = "mobile", "Mobile"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint = models.URLField()
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)

    device_type = models.CharField(
        max_length=20, choices=DeviceType.choices, default=DeviceType.BROWSER
    )
    device_info = models.JSONField(
        default=dict, blank=True, help_text="Browser, OS, device details"
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_active"]),
            models.Index(fields=["endpoint"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.device_type}"

    def deactivate(self):
        """Deactivate subscription (e.g., when push fails)."""
        self.is_active = False
        self.save(update_fields=["is_active"])
