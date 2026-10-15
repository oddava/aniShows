import contextlib

from django.contrib.auth import get_user_model
from rest_framework import generics, status
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.fields import CharField, EmailField
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView as BaseTokenRefreshView

from ...core.api_errors import error_response
from ...core.services.admin_settings_service import is_registration_enabled
from ...shared.logger import logger
from .. import throttling
from ..auth_cookies import (
    clear_refresh_cookie,
    cookie_csrf_failure,
    get_refresh_cookie,
    move_refresh_to_cookie,
)
from ..serializers.users import RegisterSerializer
from ..services.auth_flow_service import (
    AuthFlowError,
    password_reset_confirm_flow,
    password_reset_flow,
    register_user_flow,
    resend_verification_flow,
    verify_email_flow,
)
from ..services.auth_service import AuthService
from ..services.email_service import EmailService
from ..services.ws_ticket_service import TICKET_TTL_SECONDS, issue_ws_ticket

User = get_user_model()

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"] = CharField(required=False)
        self.fields["email"] = EmailField(required=False)

    @classmethod
    def get_token(cls, user):
        # Keep claims minimal: email and role flags come from /users/me/,
        # never from a decoded token.
        token = super().get_token(user)
        token["user_id"] = user.id
        token["username"] = user.username
        return token

    def validate(self, attrs):
        # Allow login with email or username
        email = attrs.get("email")
        username = attrs.get("username")
        if username:
            attrs["username"] = AuthService().normalize_login_identifier(username=username)
        elif email:
            normalized_username = AuthService().normalize_login_identifier(email=email)
            if normalized_username:
                attrs["username"] = normalized_username

        return super().validate(attrs)


class CustomTokenObtainPairView(TokenObtainPairView):
    """Handle login with username/email support.

    Returns the access token in the body; the refresh token is set as an
    httpOnly cookie.
    """

    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [throttling.LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        return move_refresh_to_cookie(super().post(request, *args, **kwargs))


class RegisterView(generics.CreateAPIView):
    """Handle user registration with email verification."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.RegisterRateThrottle]
    serializer_class = RegisterSerializer

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.auth_service = AuthService()
        self.email_service = EmailService()

    def _validate_registration_availability(self, validated_data):
        generic_message = "Unable to create account. The email or username may already be in use."
        username = validated_data["username"]
        email = validated_data["email"]

        if self.auth_service.username_exists(username) or self.auth_service.email_exists(email):
            raise ValidationError(
                {
                    "username": [generic_message],
                    "email": [generic_message],
                }
            )

    def create(self, request, *args, **kwargs):
        if not is_registration_enabled():
            return error_response(
                "Registration is currently disabled by the administrator.",
                code="registration_disabled",
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._validate_registration_availability(serializer.validated_data)

        result = register_user_flow(serializer.validated_data, self.auth_service, self.email_service)
        headers = self.get_success_headers(serializer.data)
        return Response(
            result.payload,
            status=result.status_code,
            headers=headers
        )


class AuthViewSet(ViewSet):
    """
    ViewSet to handle email verification and password reset workflows.
    Consolidates verify_email, resend_verification, password_reset, and password_reset_confirm.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.auth_service = AuthService()
        self.email_service = EmailService()

    def get_throttles(self):
        if self.action in ["resend_verification", "password_reset"]:
            return [throttling.PasswordResetRateThrottle()]
        if self.action in ["verify_email", "password_reset_confirm"]:
            return [throttling.StrictUserRateThrottle()]
        return super().get_throttles()

    @action(detail=False, methods=["get", "post"])
    def verify_email(self, request, **kwargs):
        """Verify email using URL parameters or POST data."""
        if request.method == "GET":
            # Support both query params and URL kwargs
            uidb64 = kwargs.get("uid") or request.query_params.get("uid")
            token = kwargs.get("token") or request.query_params.get("token")
        else:
            uidb64 = request.data.get("uid")
            token = request.data.get("token")

        try:
            result = verify_email_flow(uidb64, token, request, self.auth_service)
        except AuthFlowError as exc:
            return error_response(
                exc.message,
                code="email_verification_failed",
                status_code=exc.status_code,
            )

        return move_refresh_to_cookie(Response(result.payload, status=result.status_code))

    @action(detail=False, methods=["post"])
    def resend_verification(self, request):
        """Resend verification email."""
        try:
            result = resend_verification_flow(request.data.get("email"), self.email_service)
        except AuthFlowError as exc:
            return error_response(
                exc.message,
                code="resend_verification_failed",
                status_code=exc.status_code,
            )

        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def password_reset(self, request):
        """Request a password reset link."""
        try:
            result = password_reset_flow(request.data.get("email"), self.email_service)
        except AuthFlowError as exc:
            return error_response(
                exc.message,
                code="password_reset_failed",
                status_code=exc.status_code,
            )

        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def password_reset_confirm(self, request):
        """Confirm password reset with the new password."""
        try:
            result = password_reset_confirm_flow(
                request.data.get("uid"),
                request.data.get("token"),
                request.data.get("password"),
            )
        except AuthFlowError as exc:
            return error_response(
                exc.message,
                code="password_reset_confirm_failed",
                status_code=exc.status_code,
            )

        return Response(result.payload, status=result.status_code)


class LoggingTokenRefreshSerializer(TokenRefreshSerializer):
    """Token refresh serializer with logging for failed attempts."""

    def _failure_log_context(self) -> dict[str, str | int | None]:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        is_authenticated = bool(getattr(user, "is_authenticated", False))

        return {
            "request_method": getattr(request, "method", None),
            "request_path": getattr(request, "path", None),
            "remote_addr": request.META.get("REMOTE_ADDR") if request else None,
            "user_id": getattr(user, "pk", None) if is_authenticated else None,
            "username": user.get_username() if is_authenticated else None,
        }

    def validate(self, attrs):
        try:
            data = super().validate(attrs)
            return data
        except User.DoesNotExist:
            logger.warning(
                "Token refresh failed",
                extra={
                    **self._failure_log_context(),
                    "exception_class": User.DoesNotExist.__name__,
                },
            )
            raise InvalidToken()
        except Exception as e:
            if isinstance(e, (InvalidToken, TokenError)):
                logger.warning(
                    "Token refresh failed",
                    extra={
                        **self._failure_log_context(),
                        "exception_class": e.__class__.__name__,
                    },
                )
            else:
                logger.error(
                    "Token refresh failed",
                    exc_info=True,
                    extra={
                        **self._failure_log_context(),
                        "exception_class": e.__class__.__name__,
                    },
                )
            raise


def _cookie_auth_rejected(request):
    reason = cookie_csrf_failure(request)
    if reason is None:
        return None
    logger.warning("Rejected cookie-authenticated auth request", extra={"reason": reason})
    return error_response(reason, code="csrf_failed", status_code=status.HTTP_403_FORBIDDEN)


class LoggingTokenRefreshView(BaseTokenRefreshView):
    """Rotate the refresh cookie and return a fresh access token.

    The refresh token is read only from the httpOnly cookie, never the body.
    """

    serializer_class = LoggingTokenRefreshSerializer
    authentication_classes = []

    def post(self, request, *args, **kwargs):
        rejected = _cookie_auth_rejected(request)
        if rejected is not None:
            return rejected

        refresh_token = get_refresh_cookie(request)
        if not refresh_token:
            return error_response(
                "No refresh token.",
                code="refresh_token_missing",
                status_code=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = self.get_serializer(data={"refresh": refresh_token})
        try:
            serializer.is_valid(raise_exception=True)
        except (AuthenticationFailed, TokenError):
            response = error_response(
                "Refresh token is invalid or expired.",
                code="token_not_valid",
                status_code=status.HTTP_401_UNAUTHORIZED,
            )
            return clear_refresh_cookie(response)

        return move_refresh_to_cookie(Response(dict(serializer.validated_data), status=status.HTTP_200_OK))


class LogoutView(APIView):
    """Blacklist the refresh cookie's token and clear the cookie.

    Lives under the refresh cookie's path so the browser sends the cookie.
    Needs no access token, so an expired session can still log out.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        rejected = _cookie_auth_rejected(request)
        if rejected is not None:
            return rejected

        refresh_token = get_refresh_cookie(request)
        if refresh_token:
            # An invalid, expired or already-blacklisted token needs no revoking.
            with contextlib.suppress(TokenError):
                RefreshToken(refresh_token).blacklist()

        return clear_refresh_cookie(Response(status=status.HTTP_204_NO_CONTENT))


class WebSocketTicketView(APIView):
    """Trade the caller's access token for a single-use WebSocket ticket."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        return Response({"ticket": issue_ws_ticket(request.user), "expires_in": TICKET_TTL_SECONDS})
