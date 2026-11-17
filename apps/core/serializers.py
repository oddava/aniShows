"""Celery task-result serializers for the superuser drill-down (G6)."""

from rest_framework.fields import CharField, IntegerField, SerializerMethodField
from rest_framework.serializers import ModelSerializer, Serializer

from .models import CeleryTaskResult


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
