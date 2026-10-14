import json
from dataclasses import dataclass
from datetime import timedelta

from celery import current_app
from django.db.models import Avg, Count, Q
from django.utils import timezone

from ..models import CeleryTaskResult, CeleryTaskSchedule, CeleryWorkerStatus

AVAILABLE_TASKS = {
    "apps.animes.tasks.sync.sync_anime_catalog": {
        "name": "Refresh Anime Catalog Slice",
        "description": "Refresh trending from Jikan and other catalog slices from local Anime fields",
        "args_schema": {
            "sync_type": {
                "type": "string",
                "enum": ["trending", "seasonal", "next_season", "airing", "full_catalog"],
                "required": True,
            },
            "limit": {"type": "integer", "default": 50, "min": 1, "max": 500},
        },
        "default_queue": "high_priority",
    },
    "apps.animes.tasks.metadata.enrich_metadata": {
        "name": "Enrich Metadata",
        "description": "Enrich anime metadata from Jikan (self-hosted)",
        "args_schema": {
            "mode": {
                "type": "string",
                "enum": ["single", "backfill"],
                "default": "backfill",
            },
            "batch_size": {"type": "integer", "default": 100, "min": 1, "max": 500},
        },
        "default_queue": "batch",
    },
    "apps.animes.tasks.themes.sync_theme_songs": {
        "name": "Sync Theme Songs",
        "description": "Synchronize anime theme songs",
        "args_schema": {
            "limit": {"type": "integer", "default": 500, "min": 1, "max": 1000},
            "retry_failed": {"type": "boolean", "default": False},
        },
        "default_queue": "default",
    },
    "apps.animes.tasks.recommendations.generate_recommendations": {
        "name": "Generate Recommendations",
        "description": "Generate anime recommendations for users",
        "args_schema": {
            "limit": {"type": "integer", "default": 10, "min": 1, "max": 100},
        },
        "default_queue": "low_priority",
    },
    "apps.animes.tasks.franchises.sync_franchises": {
        "name": "Sync Franchises",
        "description": "Synchronize anime franchise data",
        "args_schema": {
            "anime_id": {"type": "integer", "required": False, "min": 1},
            "mode": {
                "type": "string",
                "enum": ["single", "backfill"],
                "default": "backfill",
            },
            "batch_size": {"type": "integer", "default": 50, "min": 1, "max": 250},
        },
        "default_queue": "default",
    },
    "apps.animes.tasks.franchises.update_relation_slugs": {
        "name": "Update Relation Slugs",
        "description": "Update broken relation slugs",
        "args_schema": {
            "batch_size": {"type": "integer", "default": 100, "min": 1, "max": 500},
        },
        "default_queue": "low_priority",
    },
    "apps.animes.tasks.images.generate_image_thumbnails": {
        "name": "Generate Image Thumbnails",
        "description": "Generate WebP thumbnails for anime images",
        "args_schema": {
            "anime_id": {"type": "integer", "required": True, "min": 1},
        },
        "default_queue": "low_priority",
    },
    "apps.users.tasks.cleanup_unverified_accounts": {
        "name": "Cleanup Unverified Accounts",
        "description": "Delete unverified user accounts",
        "args_schema": {
            "days": {"type": "integer", "default": 7, "min": 7, "max": 90},
        },
        "default_queue": "low_priority",
    },
    "apps.users.tasks.run_user_maintenance_workflow": {
        "name": "User Maintenance Workflow",
        "description": "Run comprehensive user maintenance",
        "args_schema": {
            "cleanup_unverified": {"type": "boolean", "default": True},
            "cleanup_imports": {"type": "boolean", "default": True},
            "unverified_days": {"type": "integer", "default": 7, "min": 7, "max": 90},
            "import_days": {"type": "integer", "default": 30, "min": 7, "max": 365},
        },
        "default_queue": "low_priority",
    },
}

MAX_ADMIN_TASK_PAYLOAD_BYTES = 4096


class CeleryTaskValidationError(ValueError):
    pass


@dataclass(slots=True)
class CeleryAdminActionResult:
    payload: dict
    status_code: int


def _payload_size_bytes(args=None, kwargs=None) -> int:
    try:
        payload = json.dumps(
            {
                "args": [] if args is None else args,
                "kwargs": {} if kwargs is None else kwargs,
            }
        )
    except TypeError as exc:
        raise CeleryTaskValidationError("Task arguments must be JSON serializable.") from exc
    return len(payload.encode("utf-8"))


def _coerce_schema_value(name: str, value, spec: dict):
    value_type = spec.get("type")

    if value_type == "integer":
        if isinstance(value, bool):
            raise CeleryTaskValidationError(f"{name} must be an integer.")
        try:
            coerced = int(value)
        except (TypeError, ValueError) as exc:
            raise CeleryTaskValidationError(f"{name} must be an integer.") from exc
        if "min" in spec and coerced < spec["min"]:
            raise CeleryTaskValidationError(f"{name} must be at least {spec['min']}.")
        if "max" in spec and coerced > spec["max"]:
            raise CeleryTaskValidationError(f"{name} must be at most {spec['max']}.")
        return coerced

    if value_type == "boolean":
        if isinstance(value, bool):
            return value
        raise CeleryTaskValidationError(f"{name} must be a boolean.")

    if value_type == "string":
        if not isinstance(value, str):
            raise CeleryTaskValidationError(f"{name} must be a string.")
        coerced = value.strip()
        if spec.get("enum") and coerced not in spec["enum"]:
            allowed = ", ".join(spec["enum"])
            raise CeleryTaskValidationError(f"{name} must be one of: {allowed}.")
        return coerced

    raise CeleryTaskValidationError(f"{name} has an unsupported schema type.")


def validate_task_invocation(*, task_path: str, args=None, kwargs=None) -> tuple[list, dict]:
    if task_path not in AVAILABLE_TASKS:
        raise CeleryTaskValidationError(f"Task {task_path} is not allowed or does not exist.")

    resolved_args = [] if args is None else args
    resolved_kwargs = {} if kwargs is None else kwargs
    if not isinstance(resolved_args, list):
        raise CeleryTaskValidationError("Task args must be a JSON list.")
    if resolved_args:
        raise CeleryTaskValidationError("Use keyword arguments for admin-triggered tasks.")
    if not isinstance(resolved_kwargs, dict):
        raise CeleryTaskValidationError("Task kwargs must be a JSON object.")
    if _payload_size_bytes(resolved_args, resolved_kwargs) > MAX_ADMIN_TASK_PAYLOAD_BYTES:
        raise CeleryTaskValidationError("Task argument payload is too large.")

    schema = AVAILABLE_TASKS[task_path].get("args_schema", {})
    unknown_keys = set(resolved_kwargs) - set(schema)
    if unknown_keys:
        unknown = ", ".join(sorted(unknown_keys))
        raise CeleryTaskValidationError(f"Unknown task argument(s): {unknown}.")

    validated_kwargs = {}
    for name, spec in schema.items():
        if name in resolved_kwargs:
            validated_kwargs[name] = _coerce_schema_value(name, resolved_kwargs[name], spec)
        elif spec.get("required"):
            raise CeleryTaskValidationError(f"{name} is required.")
        elif "default" in spec:
            validated_kwargs[name] = spec["default"]

    return [], validated_kwargs


def bulk_delete_task_results(*, ids=None, days=None) -> CeleryAdminActionResult:
    if ids:
        queryset = CeleryTaskResult.objects.filter(id__in=ids)
        deleted_count = queryset.delete()[0]
    elif days:
        cutoff_date = timezone.now() - timedelta(days=days)
        queryset = CeleryTaskResult.objects.filter(date_created__lt=cutoff_date)
        deleted_count = queryset.delete()[0]
    else:
        return CeleryAdminActionResult(
            payload={"detail": "Provide either ids or days parameter."},
            status_code=400,
        )

    return CeleryAdminActionResult(
        payload={"message": f"{deleted_count} task results deleted successfully."},
        status_code=200,
    )


def build_task_result_stats() -> dict:
    now = timezone.now()
    last_24h = now - timedelta(hours=24)
    last_7d = now - timedelta(days=7)

    total_tasks = CeleryTaskResult.objects.count()
    by_status = dict(CeleryTaskResult.objects.values_list("status").annotate(count=Count("id")))
    by_task = dict(
        CeleryTaskResult.objects.values_list("task_name")
        .annotate(count=Count("id"))
        .order_by("-count")[:10]
    )

    stats_24h = {
        "total": CeleryTaskResult.objects.filter(date_created__gte=last_24h).count(),
        "success": CeleryTaskResult.objects.filter(
            date_created__gte=last_24h,
            status="SUCCESS",
        ).count(),
        "failure": CeleryTaskResult.objects.filter(
            date_created__gte=last_24h,
            status="FAILURE",
        ).count(),
    }
    stats_24h["success_rate"] = (
        round((stats_24h["success"] / stats_24h["total"] * 100), 2)
        if stats_24h["total"] > 0
        else 0
    )

    stats_7d = {
        "total": CeleryTaskResult.objects.filter(date_created__gte=last_7d).count(),
        "success": CeleryTaskResult.objects.filter(
            date_created__gte=last_7d,
            status="SUCCESS",
        ).count(),
        "failure": CeleryTaskResult.objects.filter(
            date_created__gte=last_7d,
            status="FAILURE",
        ).count(),
    }
    stats_7d["success_rate"] = (
        round((stats_7d["success"] / stats_7d["total"] * 100), 2)
        if stats_7d["total"] > 0
        else 0
    )

    avg_execution = CeleryTaskResult.objects.filter(
        status="SUCCESS",
        execution_time__isnull=False,
    ).aggregate(avg=Avg("execution_time"))["avg"]

    return {
        "total_tasks": total_tasks,
        "by_status": by_status,
        "by_task": by_task,
        "last_24h": stats_24h,
        "last_7d": stats_7d,
        "average_execution_time": round(avg_execution, 2) if avg_execution else None,
    }


def create_task_result_record(*, task_path: str, task_id: str, args=None, kwargs=None, queue: str, user):
    return CeleryTaskResult.objects.create(
        task_id=task_id,
        task_name=task_path,
        task_module=".".join(task_path.split(".")[:-1]),
        status="PENDING",
        task_args=args or [],
        task_kwargs=kwargs or {},
        queue=queue or "default",
        triggered_by=user if getattr(user, "is_authenticated", False) else None,
    )


def trigger_task(*, task_path: str, args=None, kwargs=None, queue: str | None, user):
    args, kwargs = validate_task_invocation(task_path=task_path, args=args, kwargs=kwargs)
    task_info = AVAILABLE_TASKS[task_path]
    resolved_queue = queue or task_info.get("default_queue", "default")
    result = current_app.send_task(task_path, args=args or [], kwargs=kwargs or {}, queue=resolved_queue)
    task_result = create_task_result_record(
        task_path=task_path,
        task_id=result.id,
        args=args,
        kwargs=kwargs,
        queue=resolved_queue,
        user=user,
    )
    return {
        "message": f"Task {task_info['name']} triggered successfully.",
        "task_id": result.id,
        "task_result_id": task_result.id,
        "status": "PENDING",
    }


def run_schedule_now(*, schedule, user) -> CeleryAdminActionResult:
    if schedule.status != CeleryTaskSchedule.TaskStatus.ENABLED:
        return CeleryAdminActionResult(
            payload={"detail": "Cannot run disabled schedule."},
            status_code=400,
        )

    args, kwargs = validate_task_invocation(
        task_path=schedule.task_name,
        args=schedule.task_args or [],
        kwargs=schedule.task_kwargs or {},
    )
    result = current_app.send_task(
        schedule.task_name,
        args=args,
        kwargs=kwargs,
        queue=schedule.queue or "default",
    )
    task_result = create_task_result_record(
        task_path=schedule.task_name,
        task_id=result.id,
        args=args,
        kwargs=kwargs,
        queue=schedule.queue,
        user=user,
    )
    schedule.last_run_at = timezone.now()
    schedule.total_run_count += 1
    schedule.save(update_fields=["last_run_at", "total_run_count", "updated_at"])

    return CeleryAdminActionResult(
        payload={
            "message": f'Task "{schedule.name}" triggered successfully.',
            "task_id": result.id,
            "task_result_id": task_result.id,
        },
        status_code=200,
    )


def control_task(*, task_id: str, action: str, terminate: bool) -> CeleryAdminActionResult:
    if action != "revoke":
        return CeleryAdminActionResult(
            payload={"detail": f"Unknown action: {action}"},
            status_code=400,
        )

    current_app.control.revoke(task_id, terminate=terminate)
    CeleryTaskResult.objects.filter(task_id=task_id).update(
        status="REVOKED",
        date_completed=timezone.now(),
    )
    return CeleryAdminActionResult(
        payload={
            "message": f"Task {task_id} revoked successfully.",
            "terminated": terminate,
        },
        status_code=200,
    )


def get_worker_status_payload() -> dict:
    inspector = current_app.control.inspect()
    stats = inspector.stats() or {}
    active = inspector.active() or {}
    scheduled = inspector.scheduled() or {}
    reserved = inspector.reserved() or {}

    workers_data = []
    heartbeat = timezone.now()
    for worker_name, worker_stats in stats.items():
        queues = []
        worker_info = {
            "name": worker_name,
            "hostname": worker_stats.get("hostname", worker_name),
            "pid": worker_stats.get("pid"),
            "queues": queues,
            "active_tasks": len(active.get(worker_name, [])),
            "scheduled_tasks": len(scheduled.get(worker_name, [])),
            "reserved_tasks": len(reserved.get(worker_name, [])),
            "processed": worker_stats.get("total", {}).get("tasks", 0),
            "status": "ONLINE",
            "last_heartbeat": heartbeat.isoformat(),
        }
        workers_data.append(worker_info)

        CeleryWorkerStatus.objects.update_or_create(
            worker_name=worker_name,
            defaults={
                "status": CeleryWorkerStatus.WorkerStatus.ONLINE,
                "hostname": worker_info["hostname"],
                "pid": worker_info["pid"],
                "queues": queues,
                "active_tasks": worker_info["active_tasks"],
                "processed_tasks": worker_info["processed"],
                "last_heartbeat": heartbeat,
            },
        )

    return {
        "workers": workers_data,
        "total_workers": len(workers_data),
        "total_active_tasks": sum(worker["active_tasks"] for worker in workers_data),
    }


def perform_worker_control(*, action: str, worker: str | None) -> CeleryAdminActionResult:
    if action == "ping":
        result = current_app.control.ping(destination=[worker] if worker else None)
        return CeleryAdminActionResult(payload={"pong": result}, status_code=200)
    if action == "shutdown":
        current_app.control.shutdown(destination=[worker] if worker else None)
        return CeleryAdminActionResult(
            payload={"message": "Shutdown signal sent to workers."},
            status_code=200,
        )
    return CeleryAdminActionResult(
        payload={"detail": f"Unknown action: {action}"},
        status_code=400,
    )


def build_dashboard_payload() -> dict:
    now = timezone.now()
    last_24h = now - timedelta(hours=24)
    last_7d = now - timedelta(days=7)

    task_stats = {
        "total": CeleryTaskResult.objects.count(),
        "last_24h": CeleryTaskResult.objects.filter(date_created__gte=last_24h).count(),
        "last_7d": CeleryTaskResult.objects.filter(date_created__gte=last_7d).count(),
        "pending": CeleryTaskResult.objects.filter(status="PENDING").count(),
        "running": CeleryTaskResult.objects.filter(status="STARTED").count(),
        "success_today": CeleryTaskResult.objects.filter(
            status="SUCCESS",
            date_created__date=now.date(),
        ).count(),
        "failed_today": CeleryTaskResult.objects.filter(
            status="FAILURE",
            date_created__date=now.date(),
        ).count(),
    }
    today_total = task_stats["success_today"] + task_stats["failed_today"]
    task_stats["success_rate_today"] = (
        round((task_stats["success_today"] / today_total * 100), 1)
        if today_total > 0
        else 100.0
    )

    recent_tasks = CeleryTaskResult.objects.select_related("triggered_by").order_by("-date_created")[:10]
    recent_tasks_data = [
        {
            "id": task.id,
            "task_name": task.task_name.split(".")[-1] if "." in task.task_name else task.task_name,
            "status": task.status,
            "date_created": task.date_created.isoformat(),
            "execution_time": task.execution_time,
            "triggered_by": task.triggered_by.username if task.triggered_by else None,
        }
        for task in recent_tasks
    ]

    scheduled_count = CeleryTaskSchedule.objects.filter(
        status=CeleryTaskSchedule.TaskStatus.ENABLED
    ).count()

    workers = CeleryWorkerStatus.objects.filter(last_heartbeat__gte=now - timedelta(minutes=5))
    workers_data = [
        {
            "name": worker.worker_name,
            "status": worker.status,
            "active_tasks": worker.active_tasks,
            "processed_tasks": worker.processed_tasks,
            "last_heartbeat": worker.last_heartbeat.isoformat() if worker.last_heartbeat else None,
        }
        for worker in workers
    ]

    top_tasks = list(
        CeleryTaskResult.objects.filter(date_created__gte=last_7d)
        .values("task_name")
        .annotate(
            count=Count("id"),
            success_count=Count("id", filter=Q(status="SUCCESS")),
            avg_duration=Avg("execution_time", filter=Q(status="SUCCESS")),
        )
        .order_by("-count")[:5]
    )

    return {
        "task_stats": task_stats,
        "recent_tasks": recent_tasks_data,
        "scheduled_count": scheduled_count,
        "workers": workers_data,
        "worker_count": len(workers_data),
        "top_tasks": top_tasks,
    }
