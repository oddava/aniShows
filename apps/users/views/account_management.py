from django.contrib.auth import get_user_model
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.viewsets import ViewSet

from ...core.api_errors import api_response
from ...shared.logger import logger
from .. import throttling
from ..auth_cookies import set_refresh_cookie
from ..serializers.accounts import ChangePasswordSerializer
from ..services.account_management_service import (
    cancel_email_change,
    change_password,
    confirm_email_change,
    delete_account,
    request_email_change,
    resend_email_change,
)
from ..services.auth_service import issue_refresh_token, require_recent_auth, token_auth_time
from ..services.email_service import EmailService
from .auth import request_body

User = get_user_model()


class AccountManagementViewSet(ViewSet):
    """
    ViewSet for managing user account settings like password, email, and deletion.
    Consolidates previously separate APIViews.
    """

    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        """Allow unauthenticated access only for email change confirmation links."""
        if self.action == "confirm_email_change":
            return [AllowAny()]
        return super().get_permissions()

    def get_authenticators(self):
        # The confirm link may be opened anywhere and needs no identity; session
        # auth would answer a browser holding a Django admin session with a CSRF
        # 403. (@action kwargs do not apply: the urlconf calls as_view directly,
        # hence these overrides.) self.action is not set yet when DRF builds the
        # request's authenticators, so read the route's action map instead.
        if "confirm_email_change" in getattr(self, "action_map", {}).values():
            return []
        return super().get_authenticators()

    def get_throttles(self):
        if self.action in ["change_email", "resend_email_change"]:
            return [throttling.StrictUserRateThrottle(), throttling.ChangeEmailRateThrottle()]
        if self.action == "cancel_email_change":
            return [throttling.StrictUserRateThrottle()]
        if self.action in ["delete_account", "confirm_email_change"]:
            return [throttling.StrictUserRateThrottle()]
        return super().get_throttles()

    @action(detail=False, methods=["post"])
    def change_password(self, request):
        # Setting a first password on a Google-only account needs a fresh sign-in.
        require_recent_auth(request)
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        result = change_password(request.user, serializer.validated_data["new_password"])
        # Every refresh token was revoked; keep this device signed in, keeping
        # the sign-in time this session already had.
        refresh = issue_refresh_token(request.user, auth_time=token_auth_time(request.auth))
        response = api_response(
            {**result.payload, "access": str(refresh.access_token)},
            status_code=result.status_code,
            default_code="change_password_failed",
        )
        return set_refresh_cookie(response, str(refresh))

    @action(detail=False, methods=["delete"])
    def delete_account(self, request):
        """Allow users to delete their own account."""
        require_recent_auth(request)
        user = request.user
        password = request_body(request).get("password")

        logger.info("Account deletion attempt initiated")

        result = delete_account(user, password)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="delete_account_failed",
        )

    @action(detail=False, methods=["post"])
    def change_email(self, request):
        """Request email change - sends verification to new email."""
        require_recent_auth(request)
        body = request_body(request)
        new_email = body.get("new_email")
        password = body.get("password")
        user = request.user

        email_service = EmailService()
        result = request_email_change(user, new_email, password, email_service)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="change_email_failed",
        )

    @action(detail=False, methods=["post"])
    def resend_email_change(self, request):
        """Send the confirmation link again to the pending address."""
        result = resend_email_change(request.user, EmailService())
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="resend_email_change_failed",
        )

    @action(detail=False, methods=["post"])
    def cancel_email_change(self, request):
        """Drop the pending address; links already sent stop working."""
        result = cancel_email_change(request.user)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="cancel_email_change_failed",
        )

    @action(detail=False, methods=["post"], permission_classes=[AllowAny])
    def confirm_email_change(self, request):
        """Confirm email change with ``{uid, token}``.

        ``new_email`` is still read for links in the old 3-segment form (one
        release); it must match the pending address.
        """
        body = request_body(request)
        uidb64 = body.get("uid")
        token = body.get("token")
        new_email_encoded = body.get("new_email")

        result = confirm_email_change(uidb64, token, new_email_encoded)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="confirm_email_change_failed",
        )
