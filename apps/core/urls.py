"""
Core app URL configuration.
Infrastructure endpoints: health checks, admin dashboard, celery management.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import health_check
from .views.celery_admin import (
    CeleryTaskResultViewSet,
    CeleryTaskTriggerView,
    CeleryTaskControlView,
    CeleryWorkerStatusView,
    CeleryTaskScheduleViewSet,
    CeleryDashboardView,
)

# Import admin views from both domain apps
from apps.animes.admin_views import (
    AdminAnimeViewSet,
    AdminGenreViewSet,
    AdminStudioViewSet,
)
from apps.users.admin_views import (
    AdminDashboardView,
    AdminUserViewSet,
    AdminReviewViewSet,
    AdminStatsExportView,
    AdminUserListViewSet,
    AdminFavoritesViewSet,
    AdminImportJobViewSet,
    AdminBulkOperationsView,
    AdminReportsView,
    AdminSystemLogViewSet,
    AdminAuditLogViewSet,
)

# Admin router
admin_router = DefaultRouter()
admin_router.register(r"users", AdminUserViewSet, basename="admin-users")
admin_router.register(r"anime", AdminAnimeViewSet, basename="admin-anime")
admin_router.register(r"reviews", AdminReviewViewSet, basename="admin-reviews")
admin_router.register(r"genres", AdminGenreViewSet, basename="admin-genres")
admin_router.register(r"studios", AdminStudioViewSet, basename="admin-studios")
admin_router.register(r"user-lists", AdminUserListViewSet, basename="admin-user-lists")
admin_router.register(r"favorites", AdminFavoritesViewSet, basename="admin-favorites")
admin_router.register(
    r"import-jobs", AdminImportJobViewSet, basename="admin-import-jobs"
)
admin_router.register(r"logs", AdminSystemLogViewSet, basename="admin-logs")
admin_router.register(r"audit-logs", AdminAuditLogViewSet, basename="admin-audit-logs")

# Celery admin router
celery_router = DefaultRouter()
celery_router.register(
    r"tasks/results", CeleryTaskResultViewSet, basename="celery-task-results"
)
celery_router.register(
    r"tasks/schedules", CeleryTaskScheduleViewSet, basename="celery-task-schedules"
)

urlpatterns = [
    # Health check
    path("health/", health_check, name="health_check"),
    # Admin endpoints
    path("admin/", include(admin_router.urls)),
    path("admin/dashboard/", AdminDashboardView.as_view(), name="admin-dashboard"),
    path(
        "admin/stats/export/", AdminStatsExportView.as_view(), name="admin-stats-export"
    ),
    path("admin/bulk/", AdminBulkOperationsView.as_view(), name="admin-bulk"),
    path("admin/reports/", AdminReportsView.as_view(), name="admin-reports"),
    # Celery endpoints
    path("admin/celery/", include(celery_router.urls)),
    path(
        "admin/celery/dashboard/",
        CeleryDashboardView.as_view(),
        name="celery-dashboard",
    ),
    path(
        "admin/celery/tasks/trigger/",
        CeleryTaskTriggerView.as_view(),
        name="celery-task-trigger",
    ),
    path(
        "admin/celery/tasks/<str:task_id>/control/",
        CeleryTaskControlView.as_view(),
        name="celery-task-control",
    ),
    path(
        "admin/celery/workers/", CeleryWorkerStatusView.as_view(), name="celery-workers"
    ),
]
