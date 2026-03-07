from rest_framework import status, permissions, serializers, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView as BaseTokenRefreshView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode

from apps.users import throttling
from apps.animes.serializers import RegisterSerializer, UserSerializer
from apps.users.services.auth_service import AuthService
from apps.users.services.email_service import EmailService
from apps.users.services.cache import invalidate_user_caches
from apps.shared.logger import logger

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
        return token

    def validate(self, attrs):
        # Allow login with email or username
        email = attrs.get("email")
        username = attrs.get("username")
        password = attrs.get("password")

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
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        user = self.auth_service.register_user(serializer.validated_data)

        # Send verification email asynchronously
        self.email_service.send_verification_email(user)

        headers = self.get_success_headers(serializer.data)
        return Response(
            {"message": "Registration successful. Please check your email to verify your account."},
            status=status.HTTP_201_CREATED,
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

    def _verify_and_respond(self, request, uidb64, token):
        """Shared verification logic for email verification."""
        if not uidb64 or not token:
            return Response({"error": "Missing UID or Token"}, status=status.HTTP_400_BAD_REQUEST)

        is_valid, user = self.auth_service.verify_email(uidb64, token)

        if is_valid and user:
            # Invalidate user cache to refresh email_verified status
            invalidate_user_caches(user.id, user.username)

            # Generate tokens for auto-login
            refresh = RefreshToken.for_user(user)

            return Response(
                {
                    "message": "Email verified successfully!",
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                    "user": UserSerializer(user, context={"request": request}).data,
                },
                status=status.HTTP_200_OK,
            )
        elif user and getattr(user, "userprofile", None) and user.userprofile.email_verified:
            # Already verified, return tokens
            refresh = RefreshToken.for_user(user)
            return Response(
                {
                    "message": "Email already verified",
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                    "user": UserSerializer(user, context={"request": request}).data,
                },
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"error": "Invalid or expired token"},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            
        return self._verify_and_respond(request, uidb64, token)

    @action(detail=False, methods=["post"])
    def resend_verification(self, request):
        """Resend verification email."""
        email = request.data.get("email")
        if not email:
            return Response({"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.select_related("userprofile").get(email=email)
            profile = getattr(user, "userprofile", None)
            if profile and profile.email_verified:
                # Already verified, don't reveal this for security
                raise User.DoesNotExist
        except User.DoesNotExist:
            return Response(
                {
                    "message": "If an account with this email exists and is pending verification, a new link has been sent."
                },
                status=status.HTTP_200_OK,
            )

        self.email_service.send_verification_email(user)
        return Response(
            {
                "message": "If an account with this email exists and is pending verification, a new link has been sent."
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"])
    def password_reset(self, request):
        """Request a password reset link."""
        email = request.data.get("email")
        if not email:
            return Response({"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {"message": "If an account exists with this email, a reset link has been sent."},
                status=status.HTTP_200_OK,
            )

        self.email_service.send_password_reset_email(user)
        return Response(
            {"message": "If an account exists with this email, a reset link has been sent."},
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"])
    def password_reset_confirm(self, request):
        """Confirm password reset with the new password."""
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        password = request.data.get("password")

        if not all([uidb64, token, password]):
            return Response(
                {"error": "Missing required fields"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({"error": "Invalid link"}, status=status.HTTP_400_BAD_REQUEST)

        if default_token_generator.check_token(user, token):
            user.set_password(password)
            user.save()
            return Response(
                {"message": "Password has been reset successfully."},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"error": "Invalid or expired link"}, status=status.HTTP_400_BAD_REQUEST
            )


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