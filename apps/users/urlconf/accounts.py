"""Accounts & auth routes (G1): auth, sessions, account management, profiles."""

from django.urls import path

from ..views import (
    AccountManagementViewSet,
    AuthViewSet,
    CustomTokenObtainPairView,
    LoggingTokenRefreshView,
    LogoutView,
    PublicUserProfileViewSet,
    RegisterView,
    UserProfileView,
    UserStatsView,
    WebSocketTicketView,
)
from ..views.google import GoogleLogin

router_routes = [
    (r"users", PublicUserProfileViewSet, "users"),
]

priority_urlpatterns = [
    path("users/me/", UserProfileView.as_view(), name="user_profile"),
    path("users/me/stats/", UserStatsView.as_view(), name="user_stats"),
    path(
        "users/<str:username>/",
        PublicUserProfileViewSet.as_view({"get": "retrieve"}),
        name="public_user_profile",
    ),
]

urlpatterns = [
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
        name="password_reset",
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
        name="change_password",
    ),
    path(
        "auth/delete-account/",
        AccountManagementViewSet.as_view({"delete": "delete_account"}),
        name="delete_account",
    ),
    path(
        "auth/change-email/",
        AccountManagementViewSet.as_view({"post": "change_email"}),
        name="change_email",
    ),
    path(
        "auth/confirm-email-change/",
        AccountManagementViewSet.as_view({"post": "confirm_email_change"}),
        name="confirm_email_change",
    ),
    path(
        "auth/resend-email-change/",
        AccountManagementViewSet.as_view({"post": "resend_email_change"}),
        name="resend_email_change",
    ),
    path(
        "auth/cancel-email-change/",
        AccountManagementViewSet.as_view({"post": "cancel_email_change"}),
        name="cancel_email_change",
    ),
]
