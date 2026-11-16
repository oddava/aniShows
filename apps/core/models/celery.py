"""Celery bookkeeping models (G6 Admin): task results and worker status."""

from django.db.models import (
    SET_NULL,
    CharField,
    DateTimeField,
    FloatField,
    ForeignKey,
    JSONField,
    Model,
    PositiveIntegerField,
    TextChoices,
    TextField,
)
from django.db.models.indexes import Index

__all__ = [
    "CeleryTaskResult",
    "CeleryWorkerStatus",
]


class CeleryTaskResult(Model):
    class TaskStatus(TextChoices):
        PENDING = "PENDING", "Pending"
        STARTED = "STARTED", "Started"
        SUCCESS = "SUCCESS", "Success"
        FAILURE = "FAILURE", "Failure"
        RETRY = "RETRY", "Retry"
        REVOKED = "REVOKED", "Revoked"

    task_id = CharField(max_length=255, unique=True, db_index=True)
    task_name = CharField(max_length=255, db_index=True)
    task_module = CharField(max_length=255, blank=True)

    status = CharField(
        max_length=20,
        choices=TaskStatus.choices,
        default=TaskStatus.PENDING,
        db_index=True,
    )

    date_created = DateTimeField(auto_now_add=True, db_index=True)
    date_started = DateTimeField(null=True, blank=True)
    date_completed = DateTimeField(null=True, blank=True)

    worker = CharField(max_length=255, blank=True)
    queue = CharField(max_length=100, blank=True)

    task_args = JSONField(default=list, blank=True)
    task_kwargs = JSONField(default=dict, blank=True)
    result_data = JSONField(default=dict, blank=True, null=True)
    result_summary = TextField(blank=True)

    traceback = TextField(blank=True)
    error_message = TextField(blank=True)

    execution_time = FloatField(null=True, blank=True)
    retries = PositiveIntegerField(default=0)

    triggered_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
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
    class WorkerStatus(TextChoices):
        ONLINE = "ONLINE", "Online"
        OFFLINE = "OFFLINE", "Offline"
        BUSY = "BUSY", "Busy"
        ERROR = "ERROR", "Error"

    worker_name = CharField(max_length=255, unique=True, db_index=True)
    status = CharField(max_length=20, choices=WorkerStatus.choices, default=WorkerStatus.OFFLINE)

    hostname = CharField(max_length=255, blank=True)
    pid = PositiveIntegerField(null=True, blank=True)
    queues = JSONField(default=list, blank=True)

    processed_tasks = PositiveIntegerField(default=0)
    active_tasks = PositiveIntegerField(default=0)
    failed_tasks = PositiveIntegerField(default=0)

    last_heartbeat = DateTimeField(null=True, blank=True)
    last_checked = DateTimeField(auto_now=True)
    first_seen = DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_heartbeat"]
        verbose_name = "Celery Worker"
        verbose_name_plural = "Celery Workers"

    def __str__(self):
        return f"{self.worker_name} ({self.status})"
