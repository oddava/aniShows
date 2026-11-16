"""``/api/v1/admin/`` routes. Every view is gated by ``permissions.ADMIN_ACTION_POLICY``."""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from ..core.views.admin_import_jobs import AdminImportJobViewSet
from ..core.views.celery_admin import CeleryAdminControlViewSet, CeleryTaskResultViewSet
from ..users.views import AdminBadgeViewSet
from .views.anime import (
    AdminAnimeViewSet,
    AdminCharacterViewSet,
    AdminGenreViewSet,
    AdminOfflineAnimeSyncStateViewSet,
    AdminStaffViewSet,
    AdminStudioViewSet,
)
from .views.dashboard import AdminDashboardView, AdminStatsExportView
from .views.logs import AdminAuditLogViewSet, AdminSystemLogViewSet
from .views.moderation import (
    AdminModerationForumViewSet,
    AdminModerationReviewViewSet,
    AdminModerationSummaryView,
)
from .views.reports import AdminBulkOperationsView, AdminReportsView
from .views.reviews import AdminReviewViewSet
from .views.settings import AdminSettingsView
from .views.system import AdminSystemBeatRunView, AdminSystemView
from .views.users import AdminFavoritesStatsViewSet, AdminUserViewSet

# SimpleRouter: no browsable root view listing every admin endpoint.
admin_router = SimpleRouter()
admin_router.register(r"users", AdminUserViewSet, basename="admin-users")
admin_router.register(r"badges", AdminBadgeViewSet, basename="admin-badges")
admin_router.register(r"anime", AdminAnimeViewSet, basename="admin-anime")
admin_router.register(r"reviews", AdminReviewViewSet, basename="admin-reviews")
admin_router.register(r"genres", AdminGenreViewSet, basename="admin-genres")
admin_router.register(r"studios", AdminStudioViewSet, basename="admin-studios")
admin_router.register(r"characters", AdminCharacterViewSet, basename="admin-characters")
admin_router.register(r"staff", AdminStaffViewSet, basename="admin-staff")
admin_router.register(
    r"offline-sync-states",
    AdminOfflineAnimeSyncStateViewSet,
    basename="admin-offline-sync-states",
)
admin_router.register(r"favorites", AdminFavoritesStatsViewSet, basename="admin-favorites")
admin_router.register(r"import-jobs", AdminImportJobViewSet, basename="admin-import-jobs")
admin_router.register(r"logs", AdminSystemLogViewSet, basename="admin-logs")
admin_router.register(r"audit-logs", AdminAuditLogViewSet, basename="admin-audit-logs")
admin_router.register(
    r"moderation/reviews", AdminModerationReviewViewSet, basename="admin-moderation-reviews"
)
admin_router.register(
    r"moderation/forums", AdminModerationForumViewSet, basename="admin-moderation-forums"
)
admin_router.register(
    r"celery/tasks/results", CeleryTaskResultViewSet, basename="celery-task-results"
)

urlpatterns = [
    path(
        "moderation/summary/",
        AdminModerationSummaryView.as_view(),
        name="admin-moderation-summary",
    ),
    path("", include(admin_router.urls)),
    path("dashboard/", AdminDashboardView.as_view(), name="admin-dashboard"),
    path("stats/export/", AdminStatsExportView.as_view(), name="admin-stats-export"),
    path("bulk/", AdminBulkOperationsView.as_view(), name="admin-bulk"),
    path("reports/", AdminReportsView.as_view(), name="admin-reports"),
    path("settings/", AdminSettingsView.as_view(), name="admin-settings"),
    path("system/", AdminSystemView.as_view(), name="admin-system"),
    path(
        "system/beat/<str:entry>/run/",
        AdminSystemBeatRunView.as_view(),
        name="admin-system-beat-run",
    ),
    path(
        "celery/tasks/trigger/",
        CeleryAdminControlViewSet.as_view({"post": "trigger_task"}),
        name="celery-task-trigger",
    ),
    path(
        "celery/tasks/control/",
        CeleryAdminControlViewSet.as_view({"post": "control_task"}),
        name="celery-task-control",
    ),
]
