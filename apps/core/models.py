from django.contrib.auth import get_user_model
from django.db.models import Model, TextChoices, DateTimeField, CharField, ForeignKey, SET_NULL, GenericIPAddressField, \
    PositiveIntegerField, TextField, JSONField, FloatField, CASCADE, BooleanField, URLField
from django.db.models.indexes import Index
from django.utils import timezone

User = get_user_model()


class SystemLog(Model):
    """System logs for audit trail and monitoring."""

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

    # User information
    user = ForeignKey(User, on_delete=SET_NULL, null=True, blank=True)
    user_ip = GenericIPAddressField(null=True, blank=True)

    # Request information
    method = CharField(max_length=10, blank=True)
    path = CharField(max_length=500, blank=True)
    status_code = PositiveIntegerField(null=True, blank=True)

    # Log content
    message = TextField()
    details = JSONField(default=dict, blank=True)

    # Performance metrics
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
    """Detailed audit trail for important actions."""

    class ActionType(TextChoices):
        CREATE = "CREATE", "Create"
        UPDATE = "UPDATE", "Update"
        DELETE = "DELETE", "Delete"
        LOGIN = "LOGIN", "Login"
        LOGOUT = "LOGOUT", "Logout"
        EXPORT = "EXPORT", "Export"
        BULK_ACTION = "BULK_ACTION", "Bulk Action"

    timestamp = DateTimeField(auto_now_add=True, db_index=True)
    user = ForeignKey(User, on_delete=SET_NULL, null=True, blank=True)
    user_ip = GenericIPAddressField(null=True, blank=True)

    action = CharField(max_length=20, choices=ActionType.choices)
    entity_type = CharField(max_length=50)  # e.g., 'Anime', 'User', 'Review'
    entity_id = CharField(max_length=50, blank=True)
    entity_repr = CharField(max_length=200, blank=True)  # Human-readable representation

    # Change details
    previous_state = JSONField(default=dict, blank=True)
    new_state = JSONField(default=dict, blank=True)
    changes = JSONField(default=dict, blank=True)  # Computed diff

    # Additional context
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


class CeleryTaskResult(Model):
    """Store and track Celery task execution results."""

    class TaskStatus(TextChoices):
        PENDING = "PENDING", "Pending"
        STARTED = "STARTED", "Started"
        SUCCESS = "SUCCESS", "Success"
        FAILURE = "FAILURE", "Failure"
        RETRY = "RETRY", "Retry"
        REVOKED = "REVOKED", "Revoked"

    # Task identification
    task_id = CharField(max_length=255, unique=True, db_index=True)
    task_name = CharField(max_length=255, db_index=True)
    task_module = CharField(max_length=255, blank=True)

    # Status tracking
    status = CharField(
        max_length=20,
        choices=TaskStatus.choices,
        default=TaskStatus.PENDING,
        db_index=True,
    )

    # Timing
    date_created = DateTimeField(auto_now_add=True, db_index=True)
    date_started = DateTimeField(null=True, blank=True)
    date_completed = DateTimeField(null=True, blank=True)

    # Execution details
    worker = CharField(max_length=255, blank=True)
    queue = CharField(max_length=100, blank=True)

    # Task arguments and result
    task_args = JSONField(default=list, blank=True)
    task_kwargs = JSONField(default=dict, blank=True)
    result_data = JSONField(default=dict, blank=True, null=True)
    result_summary = TextField(blank=True)

    # Error information
    traceback = TextField(blank=True)
    error_message = TextField(blank=True)

    # Execution metrics
    execution_time = FloatField(null=True, blank=True)  # in seconds
    retries = PositiveIntegerField(default=0)

    # User who triggered the task (if applicable)
    triggered_by = ForeignKey(
        User,
        on_delete=SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_tasks",
    )

    class Meta:
        ordering = ["-date_created"]
        indexes = [
            Index(fields=["task_name", "status", "date_created"]),
            Index(fields=["status", "date_created"]),
            Index(fields=["worker", "date_created"]),
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


class CeleryWorkerStatus(Model):
    """Track Celery worker status and health."""

    class WorkerStatus(TextChoices):
        ONLINE = "ONLINE", "Online"
        OFFLINE = "OFFLINE", "Offline"
        BUSY = "BUSY", "Busy"
        ERROR = "ERROR", "Error"

    worker_name = CharField(max_length=255, unique=True, db_index=True)
    status = CharField(
        max_length=20, choices=WorkerStatus.choices, default=WorkerStatus.OFFLINE
    )

    # Worker info
    hostname = CharField(max_length=255, blank=True)
    pid = PositiveIntegerField(null=True, blank=True)
    queues = JSONField(default=list, blank=True)

    # Task statistics
    processed_tasks = PositiveIntegerField(default=0)
    active_tasks = PositiveIntegerField(default=0)
    failed_tasks = PositiveIntegerField(default=0)

    # Timestamps
    last_heartbeat = DateTimeField(null=True, blank=True)
    last_checked = DateTimeField(auto_now=True)
    first_seen = DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_heartbeat"]
        verbose_name = "Celery Worker"
        verbose_name_plural = "Celery Workers"

    def __str__(self):
        return f"{self.worker_name} ({self.status})"


class CeleryTaskSchedule(Model):
    """Custom scheduled tasks managed via admin."""

    class ScheduleType(TextChoices):
        CRONTAB = "CRONTAB", "Crontab"
        INTERVAL = "INTERVAL", "Interval"
        DATETIME = "DATETIME", "One-time"

    class TaskStatus(TextChoices):
        ENABLED = "ENABLED", "Enabled"
        DISABLED = "DISABLED", "Disabled"
        RUNNING = "RUNNING", "Running"

    name = CharField(max_length=255, unique=True)
    task_name = CharField(
        max_length=255,
        help_text="Full task path, e.g., anime.tasks.sync.sync_anime_catalog",
    )
    description = TextField(blank=True)

    # Schedule configuration
    schedule_type = CharField(
        max_length=20, choices=ScheduleType.choices, default=ScheduleType.CRONTAB
    )

    # Crontab schedule
    crontab_minute = CharField(max_length=20, default="*", blank=True)
    crontab_hour = CharField(max_length=20, default="*", blank=True)
    crontab_day_of_week = CharField(max_length=20, default="*", blank=True)
    crontab_day_of_month = CharField(max_length=20, default="*", blank=True)
    crontab_month_of_year = CharField(max_length=20, default="*", blank=True)

    # Interval schedule
    interval_every = PositiveIntegerField(default=1, null=True, blank=True)
    interval_period = CharField(
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
    one_time_datetime = DateTimeField(null=True, blank=True)

    # Task arguments
    task_args = JSONField(
        default=list, blank=True, help_text="Positional arguments as JSON list"
    )
    task_kwargs = JSONField(
        default=dict, blank=True, help_text="Keyword arguments as JSON dict"
    )
    queue = CharField(max_length=100, default="default", blank=True)

    # Status and tracking
    status = CharField(max_length=20, choices=TaskStatus.choices, default=TaskStatus.ENABLED)
    total_run_count = PositiveIntegerField(default=0)
    last_run_at = DateTimeField(null=True, blank=True)
    next_run_at = DateTimeField(null=True, blank=True)

    # Timestamps
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

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
            return schedule(period_map.get(self.interval_period, datetime.timedelta(hours=1)))
        return None


class Notification(Model):
    """User notifications for various events."""

    class NotificationType(TextChoices):
        NEW_EPISODE = "new_episode", "New Episode"
        REVIEW_REPLY = "review_reply", "Review Reply"
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

    user = ForeignKey(User, on_delete=CASCADE, related_name="notifications")
    notification_type = CharField(max_length=20, choices=NotificationType.choices)

    # Content
    title = CharField(max_length=200)
    message = TextField()
    data = JSONField(
        default=dict,
        blank=True,
        help_text="Additional data (anime_id, review_id, etc.)",
    )

    # Status tracking
    is_read = BooleanField(default=False, db_index=True)
    read_at = DateTimeField(null=True, blank=True)
    is_email_sent = BooleanField(default=False)
    is_push_sent = BooleanField(default=False)

    # Priority for delivery ordering
    priority = CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)

    # Timestamps
    created_at = DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "-created_at"]),
            Index(fields=["user", "is_read", "-created_at"]),
            Index(fields=["notification_type", "-created_at"]),
            Index(fields=["is_email_sent", "created_at"]),
            Index(fields=["is_push_sent", "created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.title}"

    def mark_as_read(self):
        """Mark notification as read."""
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=["is_read", "read_at"])


class PushSubscription(Model):
    """Web Push subscription data for users."""

    class DeviceType(TextChoices):
        BROWSER = "browser", "Browser"
        MOBILE = "mobile", "Mobile"

    user = ForeignKey(User, on_delete=CASCADE, related_name="push_subscriptions")
    endpoint = URLField()
    p256dh = CharField(max_length=255)
    auth = CharField(max_length=255)

    device_type = CharField(
        max_length=20, choices=DeviceType.choices, default=DeviceType.BROWSER
    )
    device_info = JSONField(
        default=dict, blank=True, help_text="Browser, OS, device details"
    )

    is_active = BooleanField(default=True)
    created_at = DateTimeField(auto_now_add=True)
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
        """Deactivate subscription (e.g., when push fails)."""
        self.is_active = False
        self.save(update_fields=["is_active"])
