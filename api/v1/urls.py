"""
API v1 URL configuration.

Version 1 of the AniShows API.
All endpoints under /api/v1/ are defined here.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from api.views import (
    AnimeViewSet,
    GenreViewSet,
    StudioViewSet,
    CustomTokenObtainPairView,
    RegisterView,
    UserProfileView,
    FavoriteViewSet,
    UserAnimeListViewSet,
    ReviewViewSet,
    VerifyEmailView,
    ResendVerificationView,
    PasswordResetView,
    PasswordResetConfirmView,
    ChangePasswordView,
    PublicUserProfileViewSet,
    DeleteAccountView,
    ChangeEmailView,
    ConfirmEmailChangeView,
    RecommendationsViewSet,
    FollowViewSet,
)
from api.admin_views import (
    AdminDashboardView,
    AdminUserViewSet,
    AdminAnimeViewSet,
    AdminReviewViewSet,
    AdminStatsExportView,
    AdminGenreViewSet,
    AdminStudioViewSet,
    AdminUserListViewSet,
    AdminFavoritesViewSet,
    AdminImportJobViewSet,
    AdminBulkOperationsView,
    AdminReportsView,
    AdminSystemLogViewSet,
    AdminAuditLogViewSet,
)
from users.views import GoogleLogin
from api.import_export_views import (
    ImportJobCancelView,
    ImportMALView,
    ImportMALXMLView,
    ImportAniListView,
    ImportJobStatusView,
    ImportJobListView,
    ExportUserDataView,
    ExportUserDataJSONView,
)

# Main router for v1
router = DefaultRouter()
router.register(r"anime", AnimeViewSet, basename="anime")
router.register(r"genres", GenreViewSet)
router.register(r"studios", StudioViewSet)
router.register(r"favorites", FavoriteViewSet, basename="favorites")
router.register(r"lists", UserAnimeListViewSet, basename="lists")
router.register(r"reviews", ReviewViewSet, basename="reviews")
router.register(r"users", PublicUserProfileViewSet, basename="users")
router.register(r"recommendations", RecommendationsViewSet, basename="recommendations")
router.register(r"follows", FollowViewSet, basename="follows")

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

urlpatterns = [
    # User profile
    path("users/me/", UserProfileView.as_view(), name="user_profile"),
    # Router URLs
    path("", include(router.urls)),
    # Authentication
    path("auth/login/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/verify-email/", VerifyEmailView.as_view(), name="verify_email"),
    path(
        "auth/resend-verification/",
        ResendVerificationView.as_view(),
        name="resend_verification",
    ),
    path("auth/password-reset/", PasswordResetView.as_view(), name="password_reset"),
    path(
        "auth/password-reset-confirm/",
        PasswordResetConfirmView.as_view(),
        name="password_reset_confirm",
    ),
    path("auth/change-password/", ChangePasswordView.as_view(), name="change_password"),
    path("auth/delete-account/", DeleteAccountView.as_view(), name="delete_account"),
    path("auth/change-email/", ChangeEmailView.as_view(), name="change_email"),
    path(
        "auth/confirm-email-change/",
        ConfirmEmailChangeView.as_view(),
        name="confirm_email_change",
    ),
    path("auth/google/", GoogleLogin.as_view(), name="google_login"),
    # Import/Export
    path("import/mal/", ImportMALView.as_view(), name="import_mal"),
    path("import/mal/xml/", ImportMALXMLView.as_view(), name="import_mal_xml"),
    path("import/anilist/", ImportAniListView.as_view(), name="import_anilist"),
    path("import/jobs/", ImportJobListView.as_view(), name="import_jobs"),
    path(
        "import/jobs/<int:job_id>/",
        ImportJobStatusView.as_view(),
        name="import_job_status",
    ),
    path(
        "import/jobs/<int:job_id>/cancel/",
        ImportJobCancelView.as_view(),
        name="import_job_cancel",
    ),
    path("export/", ExportUserDataView.as_view(), name="export_user_data"),
    path(
        "export/json/", ExportUserDataJSONView.as_view(), name="export_user_data_json"
    ),
    # Admin endpoints
    path("admin/", include(admin_router.urls)),
    path("admin/dashboard/", AdminDashboardView.as_view(), name="admin-dashboard"),
    path(
        "admin/stats/export/", AdminStatsExportView.as_view(), name="admin-stats-export"
    ),
    path("admin/bulk/", AdminBulkOperationsView.as_view(), name="admin-bulk"),
    path("admin/reports/", AdminReportsView.as_view(), name="admin-reports"),
]
