from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework_simplejwt.tokens import RefreshToken

from ...core.services.admin_settings_service import is_email_verification_required
from ..serializers.users import UserSerializer
from .auth_service import revoke_all_sessions
from .cache import invalidate_user_caches

User = get_user_model()


class AuthFlowError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class AuthFlowResult:
    payload: dict
    status_code: int


def build_auth_response(user, request, message: str) -> AuthFlowResult:
    refresh = RefreshToken.for_user(user)
    payload = {
        "message": message,
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": UserSerializer(user, context={"request": request}).data,
    }
    return AuthFlowResult(payload=payload, status_code=200)


def verify_email_flow(uidb64: str | None, token: str | None, request, auth_service) -> AuthFlowResult:
    if not uidb64 or not token:
        raise AuthFlowError("Missing UID or Token", 400)

    newly_verified, user = auth_service.verify_email(uidb64, token)

    if newly_verified:
        invalidate_user_caches(user.id, user.username)
        return build_auth_response(user, request, "Email verified successfully!")

    # A reused link must not mint a new session: report success, no tokens.
    if user and getattr(user, "userprofile", None) and user.userprofile.email_verified:
        return AuthFlowResult(payload={"message": "Email already verified"}, status_code=200)

    raise AuthFlowError("Invalid or expired token", 400)


def resend_verification_flow(email: str | None, email_service) -> AuthFlowResult:
    if not email:
        raise AuthFlowError("Email is required", 400)

    users = User.objects.select_related("userprofile").filter(
        email__iexact=email.strip(), userprofile__email_verified=False
    )
    for user in users:
        email_service.send_verification_email(user)

    return AuthFlowResult(
        payload={
            "message": (
                "If an account with this email exists and is pending verification, "
                "a new link has been sent."
            )
        },
        status_code=200,
    )


def password_reset_flow(email: str | None, email_service) -> AuthFlowResult:
    if not email:
        raise AuthFlowError("Email is required", 400)

    # filter(), not get(): legacy rows may share an email up to case.
    for user in User.objects.filter(email__iexact=email.strip(), is_active=True):
        email_service.send_password_reset_email(user)

    return AuthFlowResult(
        payload={"message": "If an account exists with this email, a reset link has been sent."},
        status_code=200,
    )


def password_reset_confirm_flow(uidb64: str | None, token: str | None, password: str | None) -> AuthFlowResult:
    if not all([uidb64, token, password]):
        raise AuthFlowError("Missing required fields", 400)

    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist) as exc:
        raise AuthFlowError("Invalid link", 400) from exc

    if not default_token_generator.check_token(user, token):
        raise AuthFlowError("Invalid or expired link", 400)

    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        raise AuthFlowError(" ".join(exc.messages), 400) from exc

    user.set_password(password)
    user.save(update_fields=["password"])
    # Whoever prompted the reset may hold a session; end them all.
    revoke_all_sessions(user)
    return AuthFlowResult(
        payload={"message": "Password has been reset successfully."},
        status_code=200,
    )


def register_user_flow(validated_data, auth_service, email_service) -> AuthFlowResult:
    user = auth_service.register_user(validated_data)

    if is_email_verification_required():
        email_service.send_verification_email(user)
        message = "Registration successful. Please check your email to verify your account."
    else:
        message = "Registration successful. Email verification is currently optional."

    return AuthFlowResult(
        payload={"message": message},
        status_code=201,
    )
