"""
Celery Task Management Admin Interface

Provides comprehensive admin interface for:
- Monitoring Celery task execution
- Managing scheduled tasks
- Viewing task results and history
- Controlling workers and tasks
"""

from django.contrib import admin
from django.utils.html import format_html
from django.utils.safestring import mark_safe
from django.urls import path
from django.shortcuts import redirect
from django.contrib import messages
from django.db.models import Count, Avg
from django.utils import timezone
from datetime import timedelta

from core.models import CeleryTaskResult, CeleryWorkerStatus, CeleryTaskSchedule


@admin.register(CeleryTaskResult)
class CeleryTaskResultAdmin(admin.ModelAdmin):
    """Admin interface for Celery task results."""

    list_display = [
        "task_name_short",
        "status_badge",
        "date_created",
        "duration_display",
        "worker_short",
        "queue",
        "triggered_by_user",
    ]
    list_filter = [
        "status",
        "task_name",
        "queue",
        ("date_created", admin.DateFieldListFilter),
        "worker",
    ]
    search_fields = [
        "task_id",
        "task_name",
        "task_module",
        "worker",
        "error_message",
        "result_summary",
    ]
    readonly_fields = [
        "task_id",
        "task_name",
        "task_module",
        "status",
        "date_created",
        "date_started",
        "date_completed",
        "worker",
        "queue",
        "task_args",
        "task_kwargs",
        "result_data_formatted",
        "result_summary",
        "traceback_formatted",
        "error_message",
        "execution_time",
        "retries",
        "triggered_by",
    ]
    date_hierarchy = "date_created"
    ordering = ["-date_created"]

    fieldsets = (
        (
            "Task Information",
            {
                "fields": (
                    "task_id",
                    "task_name",
                    "task_module",
                    "status",
                    "triggered_by",
                )
            },
        ),
        (
            "Execution Details",
            {"fields": ("worker", "queue", "execution_time", "retries")},
        ),
        ("Timing", {"fields": ("date_created", "date_started", "date_completed")}),
        (
            "Arguments",
            {"fields": ("task_args", "task_kwargs"), "classes": ("collapse",)},
        ),
        (
            "Result",
            {
                "fields": ("result_data_formatted", "result_summary"),
                "classes": ("collapse",),
            },
        ),
        (
            "Error Information",
            {
                "fields": ("error_message", "traceback_formatted"),
                "classes": ("collapse",),
            },
        ),
    )

    actions = ["delete_old_tasks", "retry_selected_tasks"]

    def task_name_short(self, obj):
        """Display shortened task name."""
        name = obj.task_name.split(".")[-1] if "." in obj.task_name else obj.task_name
        return format_html('<span title="{}">{}</span>', obj.task_name, name[:30])

    task_name_short.short_description = "Task"

    def status_badge(self, obj):
        """Display status with color-coded badge."""
        colors = {
            "PENDING": "secondary",
            "STARTED": "primary",
            "SUCCESS": "success",
            "FAILURE": "danger",
            "RETRY": "warning",
            "REVOKED": "dark",
        }
        color = colors.get(obj.status, "secondary")
        return format_html(
            '<span class="badge badge-{}">{}</span>', color, obj.get_status_display()
        )

    status_badge.short_description = "Status"

    def worker_short(self, obj):
        """Display shortened worker name."""
        if obj.worker:
            return obj.worker.split("@")[0] if "@" in obj.worker else obj.worker[:20]
        return "-"

    worker_short.short_description = "Worker"

    def triggered_by_user(self, obj):
        """Display user who triggered the task."""
        if obj.triggered_by:
            return format_html(
                '<a href="/admin/users/customuser/{}/change/">{}</a>',
                obj.triggered_by.id,
                obj.triggered_by.username,
            )
        return "-"

    triggered_by_user.short_description = "Triggered By"

    def result_data_formatted(self, obj):
        """Display formatted result data."""
        if obj.result_data:
            import json

            formatted = json.dumps(obj.result_data, indent=2)
            return format_html(
                '<pre style="max-height: 300px; overflow: auto;">{}</pre>', formatted
            )
        return "-"

    result_data_formatted.short_description = "Result Data"

    def traceback_formatted(self, obj):
        """Display formatted traceback."""
        if obj.traceback:
            return format_html(
                '<pre style="max-height: 400px; overflow: auto; color: #dc3545;">{}</pre>',
                obj.traceback,
            )
        return "-"

    traceback_formatted.short_description = "Traceback"

    @admin.action(description="Delete tasks older than 30 days")
    def delete_old_tasks(self, request, queryset):
        """Delete tasks older than 30 days."""
        cutoff_date = timezone.now() - timedelta(days=30)
        old_tasks = CeleryTaskResult.objects.filter(date_created__lt=cutoff_date)
        count = old_tasks.count()
        old_tasks.delete()
        self.message_user(
            request, f"Deleted {count} old task results.", messages.SUCCESS
        )

    @admin.action(description="Retry selected failed tasks")
    def retry_selected_tasks(self, request, queryset):
        """Retry selected failed tasks."""
        from celery import current_app

        retried = 0
        for task in queryset.filter(status="FAILURE"):
            try:
                current_app.send_task(
                    task.task_name,
                    args=task.task_args,
                    kwargs=task.task_kwargs,
                    queue=task.queue or "default",
                )
                retried += 1
            except Exception as e:
                self.message_user(
                    request, f"Failed to retry {task.task_name}: {e}", messages.ERROR
                )

        if retried > 0:
            self.message_user(
                request, f"Successfully retried {retried} tasks.", messages.SUCCESS
            )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        """Add statistics to changelist view."""
        extra_context = extra_context or {}

        # Calculate statistics
        today = timezone.now().date()
        stats = {
            "total_tasks": CeleryTaskResult.objects.count(),
            "today_tasks": CeleryTaskResult.objects.filter(
                date_created__date=today
            ).count(),
            "pending_tasks": CeleryTaskResult.objects.filter(status="PENDING").count(),
            "running_tasks": CeleryTaskResult.objects.filter(status="STARTED").count(),
            "failed_today": CeleryTaskResult.objects.filter(
                status="FAILURE", date_created__date=today
            ).count(),
            "success_rate": self._calculate_success_rate(),
        }
        extra_context["task_stats"] = stats

        return super().changelist_view(request, extra_context=extra_context)

    def _calculate_success_rate(self):
        """Calculate success rate for last 24 hours."""
        last_24h = timezone.now() - timedelta(hours=24)
        tasks = CeleryTaskResult.objects.filter(date_created__gte=last_24h)
        total = tasks.count()
        if total == 0:
            return 100.0
        success = tasks.filter(status="SUCCESS").count()
        return round((success / total) * 100, 1)


@admin.register(CeleryWorkerStatus)
class CeleryWorkerStatusAdmin(admin.ModelAdmin):
    """Admin interface for Celery worker monitoring."""

    list_display = [
        "worker_name",
        "status_badge",
        "hostname",
        "queues_display",
        "active_tasks",
        "processed_tasks",
        "failed_tasks",
        "last_heartbeat",
    ]
    list_filter = ["status", "queues"]
    search_fields = ["worker_name", "hostname"]
    readonly_fields = [
        "worker_name",
        "status",
        "hostname",
        "pid",
        "queues",
        "processed_tasks",
        "active_tasks",
        "failed_tasks",
        "last_heartbeat",
        "last_checked",
        "first_seen",
    ]
    ordering = ["-last_heartbeat"]

    fieldsets = (
        (
            "Worker Information",
            {"fields": ("worker_name", "hostname", "pid", "status")},
        ),
        ("Queues", {"fields": ("queues",)}),
        (
            "Task Statistics",
            {"fields": ("processed_tasks", "active_tasks", "failed_tasks")},
        ),
        ("Timestamps", {"fields": ("first_seen", "last_heartbeat", "last_checked")}),
    )

    def status_badge(self, obj):
        """Display status with color-coded badge."""
        colors = {
            "ONLINE": "success",
            "OFFLINE": "secondary",
            "BUSY": "warning",
            "ERROR": "danger",
        }
        color = colors.get(obj.status, "secondary")
        return format_html(
            '<span class="badge badge-{}">{}</span>', color, obj.get_status_display()
        )

    status_badge.short_description = "Status"

    def queues_display(self, obj):
        """Display queues as badges."""
        if obj.queues:
            badges = " ".join(
                [
                    format_html('<span class="badge badge-info">{}</span>', q)
                    for q in obj.queues
                ]
            )
            return mark_safe(badges)
        return "-"

    queues_display.short_description = "Queues"

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    actions = ["refresh_worker_status"]

    @admin.action(description="Refresh worker status")
    def refresh_worker_status(self, request, queryset):
        """Refresh worker status from Celery."""
        from celery import current_app
        from celery.result import AsyncResult

        try:
            inspector = current_app.control.inspect()
            active_workers = inspector.active()

            if active_workers:
                for worker_name, tasks in active_workers.items():
                    CeleryWorkerStatus.objects.update_or_create(
                        worker_name=worker_name,
                        defaults={
                            "status": CeleryWorkerStatus.WorkerStatus.ONLINE,
                            "active_tasks": len(tasks),
                            "last_heartbeat": timezone.now(),
                        },
                    )

            self.message_user(
                request, "Worker status refreshed successfully.", messages.SUCCESS
            )
        except Exception as e:
            self.message_user(
                request, f"Failed to refresh worker status: {e}", messages.ERROR
            )


@admin.register(CeleryTaskSchedule)
class CeleryTaskScheduleAdmin(admin.ModelAdmin):
    """Admin interface for scheduled Celery tasks."""

    list_display = [
        "name",
        "task_name_short",
        "schedule_type",
        "schedule_display",
        "status_badge",
        "total_run_count",
        "last_run_at",
        "next_run_at",
    ]
    list_filter = [
        "status",
        "schedule_type",
        ("created_at", admin.DateFieldListFilter),
    ]
    search_fields = ["name", "task_name", "description"]
    ordering = ["name"]

    fieldsets = (
        (
            "Basic Information",
            {"fields": ("name", "task_name", "description", "status")},
        ),
        (
            "Schedule Configuration",
            {
                "fields": ("schedule_type",),
                "description": "Configure when this task should run",
            },
        ),
        (
            "Crontab Schedule",
            {
                "fields": (
                    "crontab_minute",
                    "crontab_hour",
                    "crontab_day_of_week",
                    "crontab_day_of_month",
                    "crontab_month_of_year",
                ),
                "classes": ("collapse",),
                "description": 'Used when Schedule Type is "Crontab"',
            },
        ),
        (
            "Interval Schedule",
            {
                "fields": ("interval_every", "interval_period"),
                "classes": ("collapse",),
                "description": 'Used when Schedule Type is "Interval"',
            },
        ),
        (
            "One-time Schedule",
            {
                "fields": ("one_time_datetime",),
                "classes": ("collapse",),
                "description": 'Used when Schedule Type is "One-time"',
            },
        ),
        (
            "Task Arguments",
            {
                "fields": ("task_args", "task_kwargs", "queue"),
                "classes": ("collapse",),
                "description": "Arguments passed to the task function",
            },
        ),
        (
            "Statistics",
            {
                "fields": (
                    "total_run_count",
                    "last_run_at",
                    "next_run_at",
                    "created_at",
                    "updated_at",
                ),
                "classes": ("collapse",),
            },
        ),
    )

    readonly_fields = [
        "total_run_count",
        "last_run_at",
        "next_run_at",
        "created_at",
        "updated_at",
    ]

    actions = ["enable_schedules", "disable_schedules", "run_now"]

    def task_name_short(self, obj):
        """Display shortened task name."""
        name = obj.task_name.split(".")[-1] if "." in obj.task_name else obj.task_name
        return format_html('<span title="{}">{}</span>', obj.task_name, name[:30])

    task_name_short.short_description = "Task"

    def schedule_display(self, obj):
        """Display human-readable schedule."""
        if obj.schedule_type == CeleryTaskSchedule.ScheduleType.CRONTAB:
            parts = []
            if obj.crontab_minute != "*":
                parts.append(f"min:{obj.crontab_minute}")
            if obj.crontab_hour != "*":
                parts.append(f"hr:{obj.crontab_hour}")
            if obj.crontab_day_of_week != "*":
                parts.append(f"dow:{obj.crontab_day_of_week}")
            return " | ".join(parts) if parts else "Custom crontab"
        elif obj.schedule_type == CeleryTaskSchedule.ScheduleType.INTERVAL:
            return f"Every {obj.interval_every} {obj.interval_period}"
        elif obj.schedule_type == CeleryTaskSchedule.ScheduleType.DATETIME:
            return (
                obj.one_time_datetime.strftime("%Y-%m-%d %H:%M")
                if obj.one_time_datetime
                else "Not set"
            )
        return "-"

    schedule_display.short_description = "Schedule"

    def status_badge(self, obj):
        """Display status with color-coded badge."""
        colors = {
            "ENABLED": "success",
            "DISABLED": "secondary",
            "RUNNING": "primary",
        }
        color = colors.get(obj.status, "secondary")
        return format_html(
            '<span class="badge badge-{}">{}</span>', color, obj.get_status_display()
        )

    status_badge.short_description = "Status"

    @admin.action(description="Enable selected schedules")
    def enable_schedules(self, request, queryset):
        """Enable selected schedules."""
        count = queryset.update(status=CeleryTaskSchedule.TaskStatus.ENABLED)
        self.message_user(request, f"Enabled {count} schedule(s).", messages.SUCCESS)

    @admin.action(description="Disable selected schedules")
    def disable_schedules(self, request, queryset):
        """Disable selected schedules."""
        count = queryset.update(status=CeleryTaskSchedule.TaskStatus.DISABLED)
        self.message_user(request, f"Disabled {count} schedule(s).", messages.SUCCESS)

    @admin.action(description="Run selected tasks now")
    def run_now(self, request, queryset):
        """Run selected tasks immediately."""
        from celery import current_app

        executed = 0
        for schedule in queryset.filter(status=CeleryTaskSchedule.TaskStatus.ENABLED):
            try:
                current_app.send_task(
                    schedule.task_name,
                    args=schedule.task_args or [],
                    kwargs=schedule.task_kwargs or {},
                    queue=schedule.queue or "default",
                )
                executed += 1
            except Exception as e:
                self.message_user(
                    request, f"Failed to run {schedule.name}: {e}", messages.ERROR
                )

        if executed > 0:
            self.message_user(
                request, f"Successfully triggered {executed} task(s).", messages.SUCCESS
            )
