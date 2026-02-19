from rest_framework import status, permissions, serializers
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
import logging

from apps.users import throttling
from apps.animes.serializers import RegisterSerializer, UserSerializer
from apps.users.services.auth_service import AuthService
from apps.users.services.email_service import EmailService
from apps.users.services.cache import invalidate_user_caches

logger = logging.getLogger(__name__)
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


class RegisterView(APIView):
    """Handle user registration with email verification."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.RegisterRateThrottle]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.auth_service = AuthService()
        self.email_service = EmailService()

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = self.auth_service.register_user(serializer.validated_data)

        # Send verification email asynchronously
        self.email_service.send_verification_email(user)

        return Response(
            {
                "message": "Registration successful. Please check your email to verify your account."
            },
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.StrictUserRateThrottle]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.auth_service = AuthService()

    def get(self, request, uid=None, token=None):
        """Handle GET request from email verification link."""
        # Support both URL path parameters and query parameters
        uidb64 = uid or request.query_params.get("uid")
        token = token or request.query_params.get("token")

        if not uidb64 or not token:
            return Response(
                {"error": "Missing UID or Token"}, status=status.HTTP_400_BAD_REQUEST
            )

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
        elif (
            user
            and getattr(user, "userprofile", None)
            and user.userprofile.email_verified
        ):
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

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")

        if not uidb64 or not token:
            return Response(
                {"error": "Missing UID or Token"}, status=status.HTTP_400_BAD_REQUEST
            )

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
        elif (
            user
            and getattr(user, "userprofile", None)
            and user.userprofile.email_verified
        ):
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


class ResendVerificationView(APIView):
    """Resend verification email for users who didn't receive it or whose token expired."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.PasswordResetRateThrottle]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.email_service = EmailService()

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response(
                {"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.select_related("userprofile").get(email=email)
            profile = getattr(user, "userprofile", None)
            if profile and profile.email_verified:
                # Already verified, don't reveal this for security
                raise User.DoesNotExist
        except User.DoesNotExist:
            # Don't reveal user existence - return success anyway
            return Response(
                {
                    "message": "If an account with this email exists and is pending verification, a new link has been sent."
                },
                status=status.HTTP_200_OK,
            )

        # Send verification email
        self.email_service.send_verification_email(user)

        return Response(
            {
                "message": "If an account with this email exists and is pending verification, a new link has been sent."
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.PasswordResetRateThrottle]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.email_service = EmailService()

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response(
                {"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Don't reveal user existence
            return Response(
                {
                    "message": "If an account exists with this email, a reset link has been sent."
                },
                status=status.HTTP_200_OK,
            )

        # Send password reset email
        self.email_service.send_password_reset_email(user)

        return Response(
            {
                "message": "If an account exists with this email, a reset link has been sent."
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.StrictUserRateThrottle]

    def post(self, request):
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
            return Response(
                {"error": "Invalid link"}, status=status.HTTP_400_BAD_REQUEST
            )

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


from rest_framework_simplejwt.views import TokenRefreshView as BaseTokenRefreshView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer


class LoggingTokenRefreshSerializer(TokenRefreshSerializer):
    """Token refresh serializer with logging for failed attempts."""

    def validate(self, attrs):
        try:
            data = super().validate(attrs)
            logger.info(f"Token refresh successful for user")
            return data
        except Exception as e:
            refresh_token = attrs.get("refresh", "unknown")
            token_preview = (
                f"{refresh_token[:20]}..." if len(refresh_token) > 20 else refresh_token
            )
            logger.warning(
                f"Token refresh failed: {str(e)}, token_preview={token_preview}"
            )
            raise


class LoggingTokenRefreshView(BaseTokenRefreshView):
    """Token refresh view with logging for monitoring authentication issues."""

    serializer_class = LoggingTokenRefreshSerializer
    throttle_classes = [throttling.LoginRateThrottle]
