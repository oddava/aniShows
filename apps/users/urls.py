"""
Users app URL configuration.
User-related API endpoints: auth, profile, follows, lists, import/export, notifications.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    CustomTokenObtainPairView,
    RegisterView,
    LoggingTokenRefreshView,
    VerifyEmailView,
    ResendVerificationView,
    PasswordResetView,
    PasswordResetConfirmView,
    ChangePasswordView,
    UserProfileView,
    UserStatsView,
    PublicUserProfileViewSet,
    FollowViewSet,
    UserAnimeListViewSet,
    UserActivityViewSet,
    DeleteAccountView,
    ChangeEmailView,
    ConfirmEmailChangeView,
    UserBadgeViewSet,
)
from .views.google import GoogleLogin
from .views.notifications import (
    NotificationViewSet,
    NotificationPreferenceView,
    PushSubscriptionView,
)
from .views.import_export import (
    ImportJobCancelView,
    ImportMALView,
    ImportMALXMLView,
    ImportAniListView,
    ImportJobStatusView,
    ImportJobListView,
    ExportUserDataView,
    ExportUserDataJSONView,
)

router = DefaultRouter()
router.register(r"users", PublicUserProfileViewSet, basename="users")
router.register(r"follows", FollowViewSet, basename="follows")
router.register(r"lists", UserAnimeListViewSet, basename="lists")
router.register(r"activity", UserActivityViewSet, basename="activity")
router.register(r"notifications", NotificationViewSet, basename="notifications")
router.register(r"badges", UserBadgeViewSet, basename="user-badges")

urlpatterns = [
    # User profile - me endpoints must come before username lookup
    path("users/me/", UserProfileView.as_view(), name="user_profile"),
    path("users/me/stats/", UserStatsView.as_view(), name="user_stats"),
    # Public user profile lookup by username (must come after me/)
    path(
        "users/<str:username>/",
        PublicUserProfileViewSet.as_view({"get": "retrieve"}),
        name="public_user_profile",
    ),
    # Notification endpoints (must be before router to avoid conflicts)
    path(
        "notifications/preferences/",
        NotificationPreferenceView.as_view(),
        name="notification_preferences",
    ),
    path(
        "notifications/subscribe/",
        PushSubscriptionView.as_view(),
        name="push_subscribe",
    ),
    # Router URLs
    path("", include(router.urls)),
    # Authentication
    path("auth/login/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", LoggingTokenRefreshView.as_view(), name="token_refresh"),
    path("auth/register/", RegisterView.as_view(), name="register"),
    path(
        "verify-email/<str:uid>/<str:token>/",
        VerifyEmailView.as_view(),
        name="verify_email",
    ),
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
    path("export/json/", ExportUserDataJSONView.as_view(), name="export_user_data_json"),
]
