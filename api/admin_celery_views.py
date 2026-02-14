"""
Celery Task Management API Endpoints

Provides REST API for:
- Listing and triggering Celery tasks
- Monitoring task status and results
- Managing scheduled tasks
- Viewing worker status
"""

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination
from django.db.models import Count, Avg, Q
from django.utils import timezone
from datetime import timedelta

from celery import current_app
from celery.result import AsyncResult

from core.models import CeleryTaskResult, CeleryWorkerStatus, CeleryTaskSchedule
from api.admin_views import IsAdminUser, AdminPagination


class CeleryTaskResultViewSet(viewsets.ViewSet):
    """ViewSet for Celery task results management."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all task results with filtering."""
        queryset = CeleryTaskResult.objects.all()

        # Filter by status
        status_filter = request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter.upper())

        # Filter by task name
        task_name = request.query_params.get("task_name")
        if task_name:
            queryset = queryset.filter(task_name__icontains=task_name)

        # Filter by worker
        worker = request.query_params.get("worker")
        if worker:
            queryset = queryset.filter(worker__icontains=worker)

        # Filter by queue
        queue = request.query_params.get("queue")
        if queue:
            queryset = queryset.filter(queue=queue)

        # Filter by date range
        date_from = request.query_params.get("date_from")
        if date_from:
            try:
                from_date = timezone.datetime.strptime(date_from, "%Y-%m-%d")
                queryset = queryset.filter(date_created__gte=from_date)
            except ValueError:
                pass

        date_to = request.query_params.get("date_to")
        if date_to:
            try:
                to_date = timezone.datetime.strptime(date_to, "%Y-%m-%d")
                to_date = to_date.replace(hour=23, minute=59, second=59)
                queryset = queryset.filter(date_created__lte=to_date)
            except ValueError:
                pass

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(
                Q(task_id__icontains=search)
                | Q(task_name__icontains=search)
                | Q(error_message__icontains=search)
                | Q(result_summary__icontains=search)
            )

        # Ordering
        ordering = request.query_params.get("ordering", "-date_created")
        valid_orderings = [
            "date_created",
            "-date_created",
            "date_started",
            "-date_started",
            "execution_time",
            "-execution_time",
            "task_name",
            "-task_name",
        ]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        results_data = []
        for result in page:
            results_data.append(
                {
                    "id": result.id,
                    "task_id": result.task_id,
                    "task_name": result.task_name,
                    "task_name_short": result.task_name.split(".")[-1]
                    if "." in result.task_name
                    else result.task_name,
                    "status": result.status,
                    "status_display": result.get_status_display(),
                    "date_created": result.date_created.isoformat(),
                    "date_started": result.date_started.isoformat()
                    if result.date_started
                    else None,
                    "date_completed": result.date_completed.isoformat()
                    if result.date_completed
                    else None,
                    "execution_time": result.execution_time,
                    "worker": result.worker,
                    "queue": result.queue,
                    "retries": result.retries,
                    "error_message": result.error_message[:200]
                    if result.error_message
                    else None,
                    "triggered_by": {
                        "id": result.triggered_by.id,
                        "username": result.triggered_by.username,
                    }
                    if result.triggered_by
                    else None,
                }
            )

        return paginator.get_paginated_response(results_data)

    def retrieve(self, request, pk=None):
        """Get detailed task result information."""
        try:
            result = CeleryTaskResult.objects.get(pk=pk)
        except CeleryTaskResult.DoesNotExist:
            return Response(
                {"detail": "Task result not found."}, status=status.HTTP_404_NOT_FOUND
            )

        return Response(
            {
                "id": result.id,
                "task_id": result.task_id,
                "task_name": result.task_name,
                "task_module": result.task_module,
                "status": result.status,
                "status_display": result.get_status_display(),
                "date_created": result.date_created.isoformat(),
                "date_started": result.date_started.isoformat()
                if result.date_started
                else None,
                "date_completed": result.date_completed.isoformat()
                if result.date_completed
                else None,
                "worker": result.worker,
                "queue": result.queue,
                "task_args": result.task_args,
                "task_kwargs": result.task_kwargs,
                "result_data": result.result_data,
                "result_summary": result.result_summary,
                "error_message": result.error_message,
                "traceback": result.traceback,
                "execution_time": result.execution_time,
                "retries": result.retries,
                "triggered_by": {
                    "id": result.triggered_by.id,
                    "username": result.triggered_by.username,
                }
                if result.triggered_by
                else None,
            }
        )

    def destroy(self, request, pk=None):
        """Delete a task result."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete task results."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            result = CeleryTaskResult.objects.get(pk=pk)
        except CeleryTaskResult.DoesNotExist:
            return Response(
                {"detail": "Task result not found."}, status=status.HTTP_404_NOT_FOUND
            )

        result.delete()
        return Response({"message": "Task result deleted successfully."})

    @action(detail=False, methods=["post"])
    def bulk_delete(self, request):
        """Bulk delete task results."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete task results."},
                status=status.HTTP_403_FORBIDDEN,
            )

        ids = request.data.get("ids", [])
        days = request.data.get("days")

        if ids:
            deleted_count = CeleryTaskResult.objects.filter(id__in=ids).delete()[0]
        elif days:
            cutoff_date = timezone.now() - timedelta(days=days)
            deleted_count = CeleryTaskResult.objects.filter(
                date_created__lt=cutoff_date
            ).delete()[0]
        else:
            return Response(
                {"detail": "Provide either ids or days parameter."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"message": f"{deleted_count} task results deleted successfully."}
        )

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get task execution statistics."""
        now = timezone.now()
        last_24h = now - timedelta(hours=24)
        last_7d = now - timedelta(days=7)
        last_30d = now - timedelta(days=30)

        # Overall stats
        total_tasks = CeleryTaskResult.objects.count()

        # Status breakdown
        by_status = dict(
            CeleryTaskResult.objects.values_list("status").annotate(count=Count("id"))
        )

        # Task name breakdown (top 10)
        by_task = dict(
            CeleryTaskResult.objects.values_list("task_name")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )

        # Time-based stats
        stats_24h = {
            "total": CeleryTaskResult.objects.filter(
                date_created__gte=last_24h
            ).count(),
            "success": CeleryTaskResult.objects.filter(
                date_created__gte=last_24h, status="SUCCESS"
            ).count(),
            "failure": CeleryTaskResult.objects.filter(
                date_created__gte=last_24h, status="FAILURE"
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
                date_created__gte=last_7d, status="SUCCESS"
            ).count(),
            "failure": CeleryTaskResult.objects.filter(
                date_created__gte=last_7d, status="FAILURE"
            ).count(),
        }
        stats_7d["success_rate"] = (
            round((stats_7d["success"] / stats_7d["total"] * 100), 2)
            if stats_7d["total"] > 0
            else 0
        )

        # Average execution time
        avg_execution = CeleryTaskResult.objects.filter(
            status="SUCCESS", execution_time__isnull=False
        ).aggregate(avg=Avg("execution_time"))["avg"]

        return Response(
            {
                "total_tasks": total_tasks,
                "by_status": by_status,
                "by_task": by_task,
                "last_24h": stats_24h,
                "last_7d": stats_7d,
                "average_execution_time": round(avg_execution, 2)
                if avg_execution
                else None,
            }
        )


class CeleryTaskTriggerView(APIView):
    """API endpoint for triggering and managing Celery tasks."""

    permission_classes = [IsAdminUser]

    # Available tasks registry
    AVAILABLE_TASKS = {
        # Anime tasks
        "anime.tasks.sync.sync_anime_catalog": {
            "name": "Sync Anime Catalog",
            "description": "Synchronize anime catalog from AniList",
            "args_schema": {
                "sync_type": {
                    "type": "string",
                    "enum": ["trending", "seasonal", "next_season", "airing"],
                    "required": True,
                },
                "limit": {"type": "integer", "default": 50},
            },
            "default_queue": "default",
        },
        "anime.tasks.airing.sync_airing_workflow": {
            "name": "Sync Airing Workflow",
            "description": "Run the complete airing anime workflow",
            "args_schema": {
                "phases": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": ["sync"],
                },
                "batch_size": {"type": "integer", "default": 100},
            },
            "default_queue": "default",
        },
        "anime.tasks.metadata.enrich_metadata": {
            "name": "Enrich Metadata",
            "description": "Enrich anime metadata from external sources",
            "args_schema": {
                "mode": {
                    "type": "string",
                    "enum": ["single", "batch", "backfill"],
                    "default": "backfill",
                },
                "batch_size": {"type": "integer", "default": 100},
            },
            "default_queue": "low_priority",
        },
        "anime.tasks.themes.sync_theme_songs": {
            "name": "Sync Theme Songs",
            "description": "Synchronize anime theme songs",
            "args_schema": {
                "limit": {"type": "integer", "default": 500},
                "retry_failed": {"type": "boolean", "default": False},
            },
            "default_queue": "default",
        },
        "anime.tasks.recommendations.generate_recommendations": {
            "name": "Generate Recommendations",
            "description": "Generate anime recommendations for users",
            "args_schema": {
                "limit": {"type": "integer", "default": 10},
            },
            "default_queue": "low_priority",
        },
        "anime.tasks.franchises.sync_franchises": {
            "name": "Sync Franchises",
            "description": "Synchronize anime franchise data",
            "args_schema": {
                "anime_id": {"type": "integer", "required": False},
                "mode": {
                    "type": "string",
                    "enum": ["single", "backfill"],
                    "default": "backfill",
                },
                "batch_size": {"type": "integer", "default": 50},
            },
            "default_queue": "default",
        },
        "anime.tasks.franchises.update_relation_slugs": {
            "name": "Update Relation Slugs",
            "description": "Update broken relation slugs",
            "args_schema": {
                "batch_size": {"type": "integer", "default": 100},
            },
            "default_queue": "low_priority",
        },
        "anime.tasks.images.generate_image_thumbnails": {
            "name": "Generate Image Thumbnails",
            "description": "Generate WebP thumbnails for anime images",
            "args_schema": {
                "limit": {"type": "integer", "default": 100},
            },
            "default_queue": "low_priority",
        },
        # User tasks
        "users.tasks.cleanup_unverified_accounts": {
            "name": "Cleanup Unverified Accounts",
            "description": "Delete unverified user accounts",
            "args_schema": {
                "days": {"type": "integer", "default": 7},
            },
            "default_queue": "low_priority",
        },
        "users.tasks.run_user_maintenance_workflow": {
            "name": "User Maintenance Workflow",
            "description": "Run comprehensive user maintenance",
            "args_schema": {
                "cleanup_unverified": {"type": "boolean", "default": True},
                "cleanup_imports": {"type": "boolean", "default": True},
                "unverified_days": {"type": "integer", "default": 7},
                "import_days": {"type": "integer", "default": 30},
            },
            "default_queue": "low_priority",
        },
    }

    def get(self, request):
        """List all available tasks that can be triggered."""
        tasks_list = []
        for task_path, task_info in self.AVAILABLE_TASKS.items():
            tasks_list.append(
                {
                    "task_path": task_path,
                    "name": task_info["name"],
                    "description": task_info["description"],
                    "args_schema": task_info["args_schema"],
                    "default_queue": task_info.get("default_queue", "default"),
                }
            )

        return Response({"tasks": tasks_list})

    def post(self, request):
        """Trigger a Celery task."""
        task_path = request.data.get("task")
        args = request.data.get("args", [])
        kwargs = request.data.get("kwargs", {})
        queue = request.data.get("queue")

        if not task_path:
            return Response(
                {"detail": "Task path is required."}, status=status.HTTP_400_BAD_REQUEST
            )

        # Validate task is in allowed list
        if task_path not in self.AVAILABLE_TASKS:
            return Response(
                {"detail": f"Task {task_path} is not allowed or does not exist."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task_info = self.AVAILABLE_TASKS[task_path]
        queue = queue or task_info.get("default_queue", "default")

        try:
            # Send the task
            result = current_app.send_task(
                task_path, args=args, kwargs=kwargs, queue=queue
            )

            # Create task result record
            task_result = CeleryTaskResult.objects.create(
                task_id=result.id,
                task_name=task_path,
                task_module=".".join(task_path.split(".")[:-1]),
                status="PENDING",
                task_args=args,
                task_kwargs=kwargs,
                queue=queue,
                triggered_by=request.user if request.user.is_authenticated else None,
            )

            return Response(
                {
                    "message": f"Task {task_info['name']} triggered successfully.",
                    "task_id": result.id,
                    "task_result_id": task_result.id,
                    "status": "PENDING",
                },
                status=status.HTTP_202_ACCEPTED,
            )

        except Exception as e:
            return Response(
                {"detail": f"Failed to trigger task: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class CeleryTaskControlView(APIView):
    """API endpoint for controlling Celery tasks (revoke, terminate, etc.)."""

    permission_classes = [IsAdminUser]

    def post(self, request, task_id=None):
        """Revoke/terminate a running task."""
        action = request.data.get("action", "revoke")
        terminate = request.data.get("terminate", False)

        if not task_id:
            return Response(
                {"detail": "Task ID is required."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            if action == "revoke":
                # Revoke the task
                current_app.control.revoke(task_id, terminate=terminate)

                # Update our record if it exists
                CeleryTaskResult.objects.filter(task_id=task_id).update(
                    status="REVOKED", date_completed=timezone.now()
                )

                return Response(
                    {
                        "message": f"Task {task_id} revoked successfully.",
                        "terminated": terminate,
                    }
                )

            else:
                return Response(
                    {"detail": f"Unknown action: {action}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        except Exception as e:
            return Response(
                {"detail": f"Failed to {action} task: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class CeleryWorkerStatusView(APIView):
    """API endpoint for Celery worker status."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        """Get current worker status from Celery."""
        try:
            inspector = current_app.control.inspect()

            # Get worker stats
            stats = inspector.stats() or {}
            active = inspector.active() or {}
            scheduled = inspector.scheduled() or {}
            reserved = inspector.reserved() or {}

            workers_data = []
            for worker_name, worker_stats in stats.items():
                # Get queue info
                queues = []
                if "prefetch_count" in worker_stats:
                    # This is a basic check, real queue info might be elsewhere
                    pass

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
                    "last_heartbeat": timezone.now().isoformat(),
                }
                workers_data.append(worker_info)

                # Update or create worker status record
                CeleryWorkerStatus.objects.update_or_create(
                    worker_name=worker_name,
                    defaults={
                        "status": CeleryWorkerStatus.WorkerStatus.ONLINE,
                        "hostname": worker_info["hostname"],
                        "pid": worker_info["pid"],
                        "queues": queues,
                        "active_tasks": worker_info["active_tasks"],
                        "processed_tasks": worker_info["processed"],
                        "last_heartbeat": timezone.now(),
                    },
                )

            return Response(
                {
                    "workers": workers_data,
                    "total_workers": len(workers_data),
                    "total_active_tasks": sum(w["active_tasks"] for w in workers_data),
                }
            )

        except Exception as e:
            return Response(
                {"detail": f"Failed to get worker status: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def post(self, request):
        """Perform control actions on workers."""
        action = request.data.get("action")
        worker = request.data.get("worker")  # Specific worker or None for all

        if not action:
            return Response(
                {"detail": "Action is required."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            if action == "ping":
                # Ping workers
                result = current_app.control.ping(
                    destination=[worker] if worker else None
                )
                return Response({"pong": result})

            elif action == "shutdown":
                # Shutdown workers (be careful!)
                if not request.user.is_superuser:
                    return Response(
                        {"detail": "Only superusers can shutdown workers."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                current_app.control.shutdown(destination=[worker] if worker else None)
                return Response({"message": "Shutdown signal sent to workers."})

            else:
                return Response(
                    {"detail": f"Unknown action: {action}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        except Exception as e:
            return Response(
                {"detail": f"Failed to perform action: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class CeleryTaskScheduleViewSet(viewsets.ViewSet):
    """ViewSet for managing Celery task schedules."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all custom task schedules."""
        queryset = CeleryTaskSchedule.objects.all()

        # Filter by status
        status_filter = request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter.upper())

        # Filter by schedule type
        schedule_type = request.query_params.get("schedule_type")
        if schedule_type:
            queryset = queryset.filter(schedule_type=schedule_type.upper())

        # Ordering
        ordering = request.query_params.get("ordering", "name")
        valid_orderings = [
            "name",
            "-name",
            "created_at",
            "-created_at",
            "last_run_at",
            "-last_run_at",
        ]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        schedules_data = []
        for schedule in page:
            schedules_data.append(
                {
                    "id": schedule.id,
                    "name": schedule.name,
                    "task_name": schedule.task_name,
                    "task_name_short": schedule.task_name.split(".")[-1]
                    if "." in schedule.task_name
                    else schedule.task_name,
                    "description": schedule.description,
                    "schedule_type": schedule.schedule_type,
                    "schedule_type_display": schedule.get_schedule_type_display(),
                    "schedule_display": self._get_schedule_display(schedule),
                    "status": schedule.status,
                    "status_display": schedule.get_status_display(),
                    "total_run_count": schedule.total_run_count,
                    "last_run_at": schedule.last_run_at.isoformat()
                    if schedule.last_run_at
                    else None,
                    "next_run_at": schedule.next_run_at.isoformat()
                    if schedule.next_run_at
                    else None,
                    "created_at": schedule.created_at.isoformat(),
                    "updated_at": schedule.updated_at.isoformat(),
                }
            )

        return paginator.get_paginated_response(schedules_data)

    def create(self, request):
        """Create a new scheduled task."""
        schedule = CeleryTaskSchedule.objects.create(
            name=request.data.get("name"),
            task_name=request.data.get("task_name"),
            description=request.data.get("description", ""),
            schedule_type=request.data.get("schedule_type", "CRONTAB"),
            crontab_minute=request.data.get("crontab_minute", "*"),
            crontab_hour=request.data.get("crontab_hour", "*"),
            crontab_day_of_week=request.data.get("crontab_day_of_week", "*"),
            crontab_day_of_month=request.data.get("crontab_day_of_month", "*"),
            crontab_month_of_year=request.data.get("crontab_month_of_year", "*"),
            interval_every=request.data.get("interval_every", 1),
            interval_period=request.data.get("interval_period", "hours"),
            one_time_datetime=request.data.get("one_time_datetime"),
            task_args=request.data.get("task_args", []),
            task_kwargs=request.data.get("task_kwargs", {}),
            queue=request.data.get("queue", "default"),
            status=request.data.get("status", "ENABLED"),
        )

        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "message": "Schedule created successfully.",
            },
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        """Get detailed schedule information."""
        try:
            schedule = CeleryTaskSchedule.objects.get(pk=pk)
        except CeleryTaskSchedule.DoesNotExist:
            return Response(
                {"detail": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
            )

        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "task_name": schedule.task_name,
                "description": schedule.description,
                "schedule_type": schedule.schedule_type,
                "crontab_minute": schedule.crontab_minute,
                "crontab_hour": schedule.crontab_hour,
                "crontab_day_of_week": schedule.crontab_day_of_week,
                "crontab_day_of_month": schedule.crontab_day_of_month,
                "crontab_month_of_year": schedule.crontab_month_of_year,
                "interval_every": schedule.interval_every,
                "interval_period": schedule.interval_period,
                "one_time_datetime": schedule.one_time_datetime.isoformat()
                if schedule.one_time_datetime
                else None,
                "task_args": schedule.task_args,
                "task_kwargs": schedule.task_kwargs,
                "queue": schedule.queue,
                "status": schedule.status,
                "total_run_count": schedule.total_run_count,
                "last_run_at": schedule.last_run_at.isoformat()
                if schedule.last_run_at
                else None,
                "next_run_at": schedule.next_run_at.isoformat()
                if schedule.next_run_at
                else None,
                "created_at": schedule.created_at.isoformat(),
                "updated_at": schedule.updated_at.isoformat(),
            }
        )

    def update(self, request, pk=None):
        """Update a scheduled task."""
        try:
            schedule = CeleryTaskSchedule.objects.get(pk=pk)
        except CeleryTaskSchedule.DoesNotExist:
            return Response(
                {"detail": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
            )

        schedule.name = request.data.get("name", schedule.name)
        schedule.task_name = request.data.get("task_name", schedule.task_name)
        schedule.description = request.data.get("description", schedule.description)
        schedule.schedule_type = request.data.get(
            "schedule_type", schedule.schedule_type
        )
        schedule.crontab_minute = request.data.get(
            "crontab_minute", schedule.crontab_minute
        )
        schedule.crontab_hour = request.data.get("crontab_hour", schedule.crontab_hour)
        schedule.crontab_day_of_week = request.data.get(
            "crontab_day_of_week", schedule.crontab_day_of_week
        )
        schedule.crontab_day_of_month = request.data.get(
            "crontab_day_of_month", schedule.crontab_day_of_month
        )
        schedule.crontab_month_of_year = request.data.get(
            "crontab_month_of_year", schedule.crontab_month_of_year
        )
        schedule.interval_every = request.data.get(
            "interval_every", schedule.interval_every
        )
        schedule.interval_period = request.data.get(
            "interval_period", schedule.interval_period
        )
        schedule.one_time_datetime = request.data.get(
            "one_time_datetime", schedule.one_time_datetime
        )
        schedule.task_args = request.data.get("task_args", schedule.task_args)
        schedule.task_kwargs = request.data.get("task_kwargs", schedule.task_kwargs)
        schedule.queue = request.data.get("queue", schedule.queue)
        schedule.status = request.data.get("status", schedule.status)
        schedule.save()

        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "message": "Schedule updated successfully.",
            }
        )

    def destroy(self, request, pk=None):
        """Delete a scheduled task."""
        try:
            schedule = CeleryTaskSchedule.objects.get(pk=pk)
        except CeleryTaskSchedule.DoesNotExist:
            return Response(
                {"detail": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
            )

        schedule.delete()
        return Response(
            {"message": f'Schedule "{schedule.name}" deleted successfully.'}
        )

    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None):
        """Enable a scheduled task."""
        try:
            schedule = CeleryTaskSchedule.objects.get(pk=pk)
        except CeleryTaskSchedule.DoesNotExist:
            return Response(
                {"detail": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
            )

        schedule.status = CeleryTaskSchedule.TaskStatus.ENABLED
        schedule.save()

        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "status": schedule.status,
                "message": "Schedule enabled successfully.",
            }
        )

    @action(detail=True, methods=["post"])
    def disable(self, request, pk=None):
        """Disable a scheduled task."""
        try:
            schedule = CeleryTaskSchedule.objects.get(pk=pk)
        except CeleryTaskSchedule.DoesNotExist:
            return Response(
                {"detail": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
            )

        schedule.status = CeleryTaskSchedule.TaskStatus.DISABLED
        schedule.save()

        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "status": schedule.status,
                "message": "Schedule disabled successfully.",
            }
        )

    @action(detail=True, methods=["post"])
    def run_now(self, request, pk=None):
        """Run a scheduled task immediately."""
        try:
            schedule = CeleryTaskSchedule.objects.get(pk=pk)
        except CeleryTaskSchedule.DoesNotExist:
            return Response(
                {"detail": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
            )

        if schedule.status != CeleryTaskSchedule.TaskStatus.ENABLED:
            return Response(
                {"detail": "Cannot run disabled schedule."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = current_app.send_task(
                schedule.task_name,
                args=schedule.task_args or [],
                kwargs=schedule.task_kwargs or {},
                queue=schedule.queue or "default",
            )

            # Create task result record
            task_result = CeleryTaskResult.objects.create(
                task_id=result.id,
                task_name=schedule.task_name,
                task_module=".".join(schedule.task_name.split(".")[:-1]),
                status="PENDING",
                task_args=schedule.task_args or [],
                task_kwargs=schedule.task_kwargs or {},
                queue=schedule.queue or "default",
                triggered_by=request.user if request.user.is_authenticated else None,
            )

            # Update schedule
            schedule.last_run_at = timezone.now()
            schedule.total_run_count += 1
            schedule.save()

            return Response(
                {
                    "message": f'Task "{schedule.name}" triggered successfully.',
                    "task_id": result.id,
                    "task_result_id": task_result.id,
                }
            )

        except Exception as e:
            return Response(
                {"detail": f"Failed to trigger task: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def _get_schedule_display(self, schedule):
        """Generate human-readable schedule display."""
        if schedule.schedule_type == CeleryTaskSchedule.ScheduleType.CRONTAB:
            parts = []
            if schedule.crontab_minute != "*":
                parts.append(f"min:{schedule.crontab_minute}")
            if schedule.crontab_hour != "*":
                parts.append(f"hr:{schedule.crontab_hour}")
            if schedule.crontab_day_of_week != "*":
                parts.append(f"dow:{schedule.crontab_day_of_week}")
            return " | ".join(parts) if parts else "Custom crontab"
        elif schedule.schedule_type == CeleryTaskSchedule.ScheduleType.INTERVAL:
            return f"Every {schedule.interval_every} {schedule.interval_period}"
        elif schedule.schedule_type == CeleryTaskSchedule.ScheduleType.DATETIME:
            return (
                schedule.one_time_datetime.strftime("%Y-%m-%d %H:%M")
                if schedule.one_time_datetime
                else "Not set"
            )
        return "-"


class CeleryDashboardView(APIView):
    """Dashboard view for Celery task overview."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        """Get comprehensive Celery dashboard data."""
        now = timezone.now()
        last_24h = now - timedelta(hours=24)
        last_7d = now - timedelta(days=7)

        # Task statistics
        task_stats = {
            "total": CeleryTaskResult.objects.count(),
            "last_24h": CeleryTaskResult.objects.filter(
                date_created__gte=last_24h
            ).count(),
            "last_7d": CeleryTaskResult.objects.filter(
                date_created__gte=last_7d
            ).count(),
            "pending": CeleryTaskResult.objects.filter(status="PENDING").count(),
            "running": CeleryTaskResult.objects.filter(status="STARTED").count(),
            "success_today": CeleryTaskResult.objects.filter(
                status="SUCCESS", date_created__date=now.date()
            ).count(),
            "failed_today": CeleryTaskResult.objects.filter(
                status="FAILURE", date_created__date=now.date()
            ).count(),
        }

        # Calculate success rate
        today_total = task_stats["success_today"] + task_stats["failed_today"]
        task_stats["success_rate_today"] = (
            round((task_stats["success_today"] / today_total * 100), 1)
            if today_total > 0
            else 100.0
        )

        # Recent tasks
        recent_tasks = CeleryTaskResult.objects.select_related("triggered_by").order_by(
            "-date_created"
        )[:10]
        recent_tasks_data = []
        for task in recent_tasks:
            recent_tasks_data.append(
                {
                    "id": task.id,
                    "task_name": task.task_name.split(".")[-1]
                    if "." in task.task_name
                    else task.task_name,
                    "status": task.status,
                    "date_created": task.date_created.isoformat(),
                    "execution_time": task.execution_time,
                    "triggered_by": task.triggered_by.username
                    if task.triggered_by
                    else None,
                }
            )

        # Scheduled tasks count
        scheduled_count = CeleryTaskSchedule.objects.filter(
            status=CeleryTaskSchedule.TaskStatus.ENABLED
        ).count()

        # Workers
        workers = CeleryWorkerStatus.objects.filter(
            last_heartbeat__gte=now - timedelta(minutes=5)
        )
        workers_data = []
        for worker in workers:
            workers_data.append(
                {
                    "name": worker.worker_name,
                    "status": worker.status,
                    "active_tasks": worker.active_tasks,
                    "processed_tasks": worker.processed_tasks,
                    "last_heartbeat": worker.last_heartbeat.isoformat()
                    if worker.last_heartbeat
                    else None,
                }
            )

        # Top tasks by volume (last 7 days)
        top_tasks = (
            CeleryTaskResult.objects.filter(date_created__gte=last_7d)
            .values("task_name")
            .annotate(
                count=Count("id"),
                success_count=Count("id", filter=Q(status="SUCCESS")),
                avg_duration=Avg("execution_time", filter=Q(status="SUCCESS")),
            )
            .order_by("-count")[:5]
        )

        return Response(
            {
                "task_stats": task_stats,
                "recent_tasks": recent_tasks_data,
                "scheduled_count": scheduled_count,
                "workers": workers_data,
                "worker_count": len(workers_data),
                "top_tasks": list(top_tasks),
            }
        )
