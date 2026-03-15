from django.contrib.auth import get_user_model
from rest_framework import generics, permissions, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView as BaseTokenRefreshView

from apps.core.services.admin_settings_service import is_registration_enabled
from apps.shared.logger import logger
from apps.users import throttling
from apps.users.serializers.users import RegisterSerializer
from apps.users.services.auth_flow_service import (
    AuthFlowError,
    password_reset_confirm_flow,
    password_reset_flow,
    register_user_flow,
    resend_verification_flow,
    verify_email_flow,
)
from apps.users.services.auth_service import AuthService
from apps.users.services.email_service import EmailService

User = get_user_model()

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"] = serializers.CharField(required=False)
        self.fields["email"] = serializers.EmailField(required=False)

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # Add custom claims to the token for instant client-side decoding
        token["user_id"] = user.id
        token["username"] = user.username
        token["email"] = user.email
        token["is_staff"] = user.is_staff
        token["is_superuser"] = user.is_superuser
        return token

    def validate(self, attrs):
        # Allow login with email or username
        email = attrs.get("email")
        username = attrs.get("username")
        if username:
            username = username.strip()

            # If username looks like an email, try to find user by email
            if "@" in username:
                try:
                    user = User.objects.get(email__iexact=username)
                    attrs["username"] = user.username
                except User.DoesNotExist:
                    # Let parent handle the failure
                    attrs["username"] = username
            else:
                # Try case-insensitive username lookup
                try:
                    user = User.objects.get(username__iexact=username)
                    attrs["username"] = user.username
                except User.DoesNotExist:
                    # Use original username and let parent handle failure
                    attrs["username"] = username

        elif email:
            # Try to find user by email
            try:
                user = User.objects.get(email__iexact=email)
                attrs["username"] = user.username
            except User.DoesNotExist:
                # Let parent handle the failure
                pass

        return super().validate(attrs)


class CustomTokenObtainPairView(TokenObtainPairView):
    """Handle login with username/email support."""

    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [throttling.LoginRateThrottle]


class RegisterView(generics.CreateAPIView):
    """Handle user registration with email verification."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.RegisterRateThrottle]
    serializer_class = RegisterSerializer

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.auth_service = AuthService()
        self.email_service = EmailService()

    def create(self, request, *args, **kwargs):
        if not is_registration_enabled():
            return Response(
                {"detail": "Registration is currently disabled by the administrator."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

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
    permission_classes = [permissions.AllowAny]
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
            return Response({"error": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def resend_verification(self, request):
        """Resend verification email."""
        try:
            result = resend_verification_flow(request.data.get("email"), self.email_service)
        except AuthFlowError as exc:
            return Response({"error": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def password_reset(self, request):
        """Request a password reset link."""
        try:
            result = password_reset_flow(request.data.get("email"), self.email_service)
        except AuthFlowError as exc:
            return Response({"error": exc.message}, status=exc.status_code)

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
            return Response({"error": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)


class LoggingTokenRefreshSerializer(TokenRefreshSerializer):
    """Token refresh serializer with logging for failed attempts."""

    def validate(self, attrs):
        try:
            data = super().validate(attrs)
            return data
        except User.DoesNotExist:
            logger.warning("Token refresh failed: User does not exist")
            raise InvalidToken()
        except Exception as e:
            refresh_token = attrs.get("refresh", "unknown")
            token_preview = f"{refresh_token[:20]}..." if len(refresh_token) > 20 else refresh_token
            if isinstance(e, (InvalidToken, TokenError)):
                logger.warning(f"Token refresh failed: {str(e)}")
            else:
                logger.error(
                    f"Token refresh failed: {str(e)}, token_preview={token_preview}", exc_info=True
                )
            raise


class LoggingTokenRefreshView(BaseTokenRefreshView):
    """Token refresh view with custom logging serializer."""
    serializer_class = LoggingTokenRefreshSerializer
