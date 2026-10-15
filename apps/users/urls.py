"""
Users app URL configuration.
User-related API endpoints: auth, profile, follows, lists, import/export, notifications.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AccountManagementViewSet,
    AuthViewSet,
    CustomTokenObtainPairView,
    FollowViewSet,
    LoggingTokenRefreshView,
    LogoutView,
    PublicUserProfileViewSet,
    RegisterView,
    UserActivityViewSet,
    UserAnimeListViewSet,
    UserBadgeViewSet,
    UserProfileView,
    UserStatsView,
    WebSocketTicketView,
)
from .views.google import GoogleLogin
from .views.import_export import (
    ImportExportViewSet,
    UserImportJobViewSet,
)
from .views.notifications import (
    NotificationPreferenceView,
    NotificationViewSet,
    PushSubscriptionViewSet,
)

router = DefaultRouter()
router.register(r"users", PublicUserProfileViewSet, basename="users")
router.register(r"follows", FollowViewSet, basename="follows")
router.register(r"lists", UserAnimeListViewSet, basename="lists")
router.register(r"activity", UserActivityViewSet, basename="activity")
router.register(r"notifications", NotificationViewSet, basename="notifications")
router.register(r"badges", UserBadgeViewSet, basename="user-badges")

urlpatterns = [
    path("users/me/", UserProfileView.as_view(), name="user_profile"),
    path("users/me/stats/", UserStatsView.as_view(), name="user_stats"),
    path(
        "users/<str:username>/",
        PublicUserProfileViewSet.as_view({"get": "retrieve"}),
        name="public_user_profile",
    ),

    # Notification preferences & Push mapping
    path(
        "notifications/preferences/",
        NotificationPreferenceView.as_view(),
        name="notification_preferences",
    ),
    path(
        "notifications/subscribe/",
        PushSubscriptionViewSet.as_view({"post": "create", "get": "list", "delete": "unsubscribe"}),
        name="push_subscribe",
    ),
    path(
        "notifications/unsubscribe/",
        PushSubscriptionViewSet.as_view({"delete": "unsubscribe"}),
        name="push_unsubscribe",
    ),

    # Router URLs covers: users, follows, lists, activity, notifications, badges
    path("", include(router.urls)),

    # Core Auth (Obtain Pair, Refresh, Register)
    path("auth/login/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", LoggingTokenRefreshView.as_view(), name="token_refresh"),
    # Under the refresh cookie path so the browser sends the cookie to it.
    path("auth/refresh/logout/", LogoutView.as_view(), name="token_logout"),
    path("auth/ws-ticket/", WebSocketTicketView.as_view(), name="ws_ticket"),
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/google/", GoogleLogin.as_view(), name="google_login"),

    # Auth Workflow Routes (Verify Email, Resend, Reset Password)
    path(
        "verify-email/<str:uid>/<str:token>/",
        AuthViewSet.as_view({"post": "verify_email"}),
        name="verify_email",
    ),
    path(
        "auth/resend-verification/",
        AuthViewSet.as_view({"post": "resend_verification"}),
        name="resend_verification",
    ),
    path(
        "auth/password-reset/",
        AuthViewSet.as_view({"post": "password_reset"}),
        name="password_reset"
    ),
    path(
        "auth/password-reset-confirm/",
        AuthViewSet.as_view({"post": "password_reset_confirm"}),
        name="password_reset_confirm",
    ),

    # Account Management Routes (Password, Email, Delete)
    path(
        "auth/change-password/",
        AccountManagementViewSet.as_view({"post": "change_password"}),
        name="change_password"
    ),
    path(
        "auth/delete-account/",
        AccountManagementViewSet.as_view({"delete": "delete_account"}),
        name="delete_account"
    ),
    path(
        "auth/change-email/",
        AccountManagementViewSet.as_view({"post": "change_email"}),
        name="change_email"
    ),
    path(
        "auth/confirm-email-change/",
        AccountManagementViewSet.as_view({"post": "confirm_email_change"}),
        name="confirm_email_change",
    ),

    # Import/Export Routes
    path(
        "import/mal/",
        ImportExportViewSet.as_view({"post": "import_mal"}),
        name="import_mal"
    ),
    path(
        "import/mal/xml/",
        ImportExportViewSet.as_view({"post": "import_mal_xml"}),
        name="import_mal_xml"
    ),
    path(
        "import/anilist/",
        ImportExportViewSet.as_view({"post": "import_anilist"}),
        name="import_anilist"
    ),
    path(
        "export/",
        ImportExportViewSet.as_view({"get": "export_user_data"}),
        name="export_user_data"
    ),
    path(
        "export/json/",
        ImportExportViewSet.as_view({"get": "export_user_data"}),
        name="export_user_data_json"
    ),

    # User Import Jobs
    path(
        "import/jobs/",
        UserImportJobViewSet.as_view({"get": "list"}),
        name="import_jobs"
    ),
    path(
        "import/jobs/<int:pk>/",
        UserImportJobViewSet.as_view({"get": "retrieve"}),
        name="import_job_status",
    ),
    path(
        "import/jobs/<int:pk>/cancel/",
        UserImportJobViewSet.as_view({"post": "cancel"}),
        name="import_job_cancel",
    ),
]
