import json
from dataclasses import dataclass
from datetime import timedelta

from celery import current_app
from django.utils import timezone

from ..models import CeleryTaskResult

AVAILABLE_TASKS = {
    "apps.animes.tasks.sync.sync_anime_catalog": {
        "name": "Refresh Anime Catalog Slice",
        "description": "Refresh trending from AniList and other catalog slices from local Anime fields",
        "args_schema": {
            "sync_type": {
                "type": "string",
                "enum": ["trending", "seasonal", "next_season", "airing", "full_catalog"],
                "required": True,
            },
            "limit": {"type": "integer", "default": 50, "min": 1, "max": 500},
        },
    },
    "apps.animes.tasks.metadata.enrich_metadata": {
        "name": "Enrich Metadata",
        "description": "Enrich anime metadata from AniList",
        "args_schema": {
            "mode": {
                "type": "string",
                "enum": ["single", "backfill"],
                "default": "backfill",
            },
            "batch_size": {"type": "integer", "default": 100, "min": 1, "max": 500},
        },
    },
    "apps.animes.tasks.recommendations.generate_recommendations": {
        "name": "Generate Recommendations",
        "description": "Generate anime recommendations for users",
        "args_schema": {
            "limit": {"type": "integer", "default": 10, "min": 1, "max": 100},
        },
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
    },
    "apps.animes.tasks.franchises.update_relation_slugs": {
        "name": "Update Relation Slugs",
        "description": "Update broken relation slugs",
        "args_schema": {
            "batch_size": {"type": "integer", "default": 100, "min": 1, "max": 500},
        },
    },
    "apps.animes.tasks.images.generate_image_thumbnails": {
        "name": "Generate Image Thumbnails",
        "description": "Generate WebP thumbnails for anime images",
        "args_schema": {
            "anime_id": {"type": "integer", "required": True, "min": 1},
        },
    },
    "apps.users.tasks.cleanup_unverified_accounts": {
        "name": "Cleanup Unverified Accounts",
        "description": "Delete unverified user accounts",
        "args_schema": {
            "days": {"type": "integer", "default": 7, "min": 7, "max": 90},
        },
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
    },
}

MAX_ADMIN_TASK_PAYLOAD_BYTES = 4096
MAX_BULK_DELETE_IDS = 500


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
        if not isinstance(ids, list) or len(ids) > MAX_BULK_DELETE_IDS:
            return CeleryAdminActionResult(
                payload={"detail": f"ids must be a list of at most {MAX_BULK_DELETE_IDS}."},
                status_code=400,
            )
        try:
            clean_ids = [int(value) for value in ids if not isinstance(value, bool)]
        except (TypeError, ValueError):
            clean_ids = []
        if len(clean_ids) != len(ids):
            return CeleryAdminActionResult(
                payload={"detail": "ids must be integers."}, status_code=400
            )
        queryset = CeleryTaskResult.objects.filter(id__in=clean_ids)
        deleted_count = queryset.delete()[0]
    elif days:
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 0
        if days < 1:
            return CeleryAdminActionResult(
                payload={"detail": "days must be a positive integer."}, status_code=400
            )
        cutoff_date = timezone.now() - timedelta(days=days)
        queryset = CeleryTaskResult.objects.filter(date_created__lt=cutoff_date)
        deleted_count = queryset.delete()[0]
    else:
        return CeleryAdminActionResult(
            payload={"detail": "Provide either ids or days parameter."},
            status_code=400,
        )

    return CeleryAdminActionResult(
        payload={
            "message": f"{deleted_count} task results deleted successfully.",
            "deleted": deleted_count,
        },
        status_code=200,
    )


def create_task_result_record(
    *, task_path: str, task_id: str, args=None, kwargs=None, queue: str, user
):
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


def trigger_task(*, task_path: str, args=None, kwargs=None, user):
    """Send an allowlisted task with validated kwargs. Routing follows ``task_routes``."""
    args, kwargs = validate_task_invocation(task_path=task_path, args=args, kwargs=kwargs)
    task_info = AVAILABLE_TASKS[task_path]
    result = current_app.send_task(task_path, args=args or [], kwargs=kwargs or {})
    task_result = create_task_result_record(
        task_path=task_path,
        task_id=result.id,
        args=args,
        kwargs=kwargs,
        queue=routed_queue(task_path),
        user=user,
    )
    return {
        "message": f"Task {task_info['name']} triggered successfully.",
        "task_id": result.id,
        "task_result_id": task_result.id,
        "status": "PENDING",
        "kwargs": kwargs,
    }


def routed_queue(task_path: str) -> str:
    """The queue ``task_routes`` sends ``task_path`` to (the default queue otherwise)."""
    route = (current_app.conf.task_routes or {}).get(task_path) or {}
    return route.get("queue") or current_app.conf.task_default_queue or "default"


def control_task(*, task_id: str, action: str, terminate: bool) -> CeleryAdminActionResult:
    if action != "revoke":
        return CeleryAdminActionResult(
            payload={"detail": "Unknown action. Allowed: revoke."},
            status_code=400,
        )

    current_app.control.revoke(task_id, terminate=terminate)
    CeleryTaskResult.objects.filter(task_id=task_id).update(
        status="REVOKED",
        date_completed=timezone.now(),
    )
    return CeleryAdminActionResult(
        payload={
            "message": "Task revoked successfully.",
            "task_id": task_id,
            "terminated": terminate,
        },
        status_code=200,
    )
