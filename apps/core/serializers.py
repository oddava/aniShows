from celery import current_app
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.fields import IntegerField, CharField, SerializerMethodField, ListField, DictField
from rest_framework.serializers import Serializer, ModelSerializer

from apps.core.models import CeleryTaskResult, CeleryTaskSchedule


class TriggeredBySerializer(Serializer):
    id = IntegerField()
    username = CharField()


class CeleryTaskResultListSerializer(ModelSerializer):
    task_name_short = SerializerMethodField()
    status_display = CharField(source="get_status_display", read_only=True)
    triggered_by = SerializerMethodField()
    error_message = SerializerMethodField()

    class Meta:
        model = CeleryTaskResult
        fields = [
            "id",
            "task_id",
            "task_name",
            "task_name_short",
            "status",
            "status_display",
            "date_created",
            "date_started",
            "date_completed",
            "execution_time",
            "worker",
            "queue",
            "retries",
            "error_message",
            "triggered_by",
        ]

    def get_task_name_short(self, obj):
        return obj.task_name.split(".")[-1] if "." in obj.task_name else obj.task_name

    def get_triggered_by(self, obj):
        if not obj.triggered_by:
            return None
        return {"id": obj.triggered_by.id, "username": obj.triggered_by.username}

    def get_error_message(self, obj):
        return obj.error_message[:200] if obj.error_message else None


class CeleryTaskResultDetailSerializer(ModelSerializer):
    status_display = CharField(source="get_status_display", read_only=True)
    triggered_by = SerializerMethodField()

    class Meta:
        model = CeleryTaskResult
        fields = [
            "id",
            "task_id",
            "task_name",
            "task_module",
            "status",
            "status_display",
            "date_created",
            "date_started",
            "date_completed",
            "worker",
            "queue",
            "task_args",
            "task_kwargs",
            "result_data",
            "result_summary",
            "error_message",
            "traceback",
            "execution_time",
            "retries",
            "triggered_by",
        ]

    def get_triggered_by(self, obj):
        if not obj.triggered_by:
            return None
        return {"id": obj.triggered_by.id, "username": obj.triggered_by.username}


class CeleryTaskScheduleWriteSerializer(ModelSerializer):
    task_args = ListField(required=False, allow_empty=True)
    task_kwargs = DictField(required=False)

    class Meta:
        model = CeleryTaskSchedule
        fields = [
            "name",
            "task_name",
            "description",
            "schedule_type",
            "crontab_minute",
            "crontab_hour",
            "crontab_day_of_week",
            "crontab_day_of_month",
            "crontab_month_of_year",
            "interval_every",
            "interval_period",
            "one_time_datetime",
            "task_args",
            "task_kwargs",
            "queue",
            "status",
        ]

    def validate_task_name(self, value):
        if not isinstance(value, str) or not value.startswith("apps.") or value not in current_app.tasks:
            raise ValidationError(
                "Task name must reference a registered application task."
            )
        return value

    def validate_queue(self, value):
        queue_name = (value or "default").strip()
        available_queues = {queue.name for queue in (current_app.conf.task_queues or [])}
        if queue_name not in available_queues:
            raise ValidationError(
                "Queue must be one of the configured Celery queues."
            )
        return queue_name

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        schedule_type = attrs.get(
            "schedule_type",
            instance.schedule_type if instance else CeleryTaskSchedule.ScheduleType.CRONTAB,
        )
        one_time_datetime = attrs.get(
            "one_time_datetime",
            instance.one_time_datetime if instance else None,
        )
        interval_every = attrs.get(
            "interval_every",
            instance.interval_every if instance else 1,
        )
        interval_period = attrs.get(
            "interval_period",
            instance.interval_period if instance else "hours",
        )
        valid_interval_periods = dict(
            CeleryTaskSchedule._meta.get_field("interval_period").choices
        )

        if schedule_type == CeleryTaskSchedule.ScheduleType.DATETIME and not one_time_datetime:
            raise ValidationError(
                {"one_time_datetime": "One-time schedules require a run datetime."}
            )
        if schedule_type == CeleryTaskSchedule.ScheduleType.INTERVAL:
            if interval_every is None or interval_every < 1:
                raise ValidationError(
                    {"interval_every": "Interval schedules require a positive interval."}
                )
            if interval_period not in valid_interval_periods:
                raise ValidationError(
                    {"interval_period": "Interval schedules require a valid period."}
                )

        attrs["queue"] = attrs.get("queue") or getattr(instance, "queue", "default") or "default"
        attrs.setdefault("task_args", getattr(instance, "task_args", []) if instance else [])
        attrs.setdefault("task_kwargs", getattr(instance, "task_kwargs", {}) if instance else {})

        if schedule_type == CeleryTaskSchedule.ScheduleType.CRONTAB:
            attrs["interval_every"] = None
            attrs["one_time_datetime"] = None
        elif schedule_type == CeleryTaskSchedule.ScheduleType.INTERVAL:
            attrs["one_time_datetime"] = None
            attrs.setdefault("interval_every", 1)
            attrs.setdefault("interval_period", "hours")
        else:
            attrs["interval_every"] = None
            attrs["crontab_minute"] = "*"
            attrs["crontab_hour"] = "*"
            attrs["crontab_day_of_week"] = "*"
            attrs["crontab_day_of_month"] = "*"
            attrs["crontab_month_of_year"] = "*"

        return attrs


class CeleryTaskScheduleListSerializer(ModelSerializer):
    task_name_short = SerializerMethodField()
    schedule_type_display = CharField(source="get_schedule_type_display", read_only=True)
    schedule_display = SerializerMethodField()
    status_display = CharField(source="get_status_display", read_only=True)

    class Meta:
        model = CeleryTaskSchedule
        fields = [
            "id",
            "name",
            "task_name",
            "task_name_short",
            "description",
            "schedule_type",
            "schedule_type_display",
            "schedule_display",
            "status",
            "status_display",
            "total_run_count",
            "last_run_at",
            "next_run_at",
            "created_at",
            "updated_at",
        ]

    def get_task_name_short(self, obj):
        return obj.task_name.split(".")[-1] if "." in obj.task_name else obj.task_name

    def get_schedule_display(self, obj):
        if obj.schedule_type == CeleryTaskSchedule.ScheduleType.CRONTAB:
            parts = []
            if obj.crontab_minute != "*":
                parts.append(f"min:{obj.crontab_minute}")
            if obj.crontab_hour != "*":
                parts.append(f"hr:{obj.crontab_hour}")
            if obj.crontab_day_of_week != "*":
                parts.append(f"dow:{obj.crontab_day_of_week}")
            return " | ".join(parts) if parts else "Custom crontab"
        if obj.schedule_type == CeleryTaskSchedule.ScheduleType.INTERVAL:
            return f"Every {obj.interval_every} {obj.interval_period}"
        if obj.schedule_type == CeleryTaskSchedule.ScheduleType.DATETIME:
            return obj.one_time_datetime.strftime("%Y-%m-%d %H:%M") if obj.one_time_datetime else "Not set"
        return "-"


class CeleryTaskScheduleDetailSerializer(ModelSerializer):
    class Meta:
        model = CeleryTaskSchedule
        fields = [
            "id",
            "name",
            "task_name",
            "description",
            "schedule_type",
            "crontab_minute",
            "crontab_hour",
            "crontab_day_of_week",
            "crontab_day_of_month",
            "crontab_month_of_year",
            "interval_every",
            "interval_period",
            "one_time_datetime",
            "task_args",
            "task_kwargs",
            "queue",
            "status",
            "total_run_count",
            "last_run_at",
            "next_run_at",
            "created_at",
            "updated_at",
        ]
