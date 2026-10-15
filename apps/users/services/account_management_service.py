from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode

from ..tokens import EmailChangeTokenGenerator, normalize_email
from .auth_service import AuthService, revoke_all_sessions
from .email_service import EmailService

User = get_user_model()


@dataclass(slots=True)
class AccountManagementResult:
    payload: dict
    status_code: int


def change_password(user, new_password):
    """Set a new password and end every session; the caller re-issues its own."""
    user.set_password(new_password)
    user.save(update_fields=["password"])
    revoke_all_sessions(user)
    return AccountManagementResult(
        payload={"message": "Password changed successfully"},
        status_code=200,
    )


def delete_account(user, password):
    if user.has_usable_password():
        if not password:
            return AccountManagementResult(
                payload={"error": "Your current password is required to delete your account."},
                status_code=400,
            )
        if not user.check_password(password):
            return AccountManagementResult(
                payload={"error": "The password you entered is incorrect."},
                status_code=400,
            )

    with transaction.atomic():
        user.delete()

    return AccountManagementResult(
        payload={"message": "Account deleted successfully"},
        status_code=200,
    )


def request_email_change(user, new_email, password, email_service: EmailService):
    if user.has_usable_password():
        if not password:
            return AccountManagementResult(
                payload={"error": "Your current password is required to change your email."},
                status_code=400,
            )
        if not user.check_password(password):
            return AccountManagementResult(
                payload={"error": "The password you entered is incorrect."},
                status_code=400,
            )

    new_email = normalize_email(new_email)
    try:
        validate_email(new_email)
    except ValidationError:
        return AccountManagementResult(
            payload={"error": "Enter a valid email address."},
            status_code=400,
        )

    if new_email == normalize_email(user.email):
        return AccountManagementResult(
            payload={"error": "This is already your email address."},
            status_code=400,
        )

    if AuthService().email_exists(new_email, exclude_pk=user.pk):
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    email_service.send_email_change_confirmation(user, new_email)
    return AccountManagementResult(
        payload={
            "message": "Confirmation email sent to your new email address. Please check your inbox."
        },
        status_code=200,
    )


def confirm_email_change(uidb64, token, new_email_encoded):
    if not all([uidb64, token, new_email_encoded]):
        return AccountManagementResult(payload={"error": "Missing required fields"}, status_code=400)

    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
        new_email = normalize_email(force_str(urlsafe_base64_decode(new_email_encoded)))
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return AccountManagementResult(payload={"error": "Invalid link"}, status_code=400)

    # The token is bound to this exact new address and to the current one, so
    # it cannot be replayed or pointed at an address the user never confirmed.
    if not EmailChangeTokenGenerator(new_email).check_token(user, token):
        return AccountManagementResult(
            payload={"error": "Invalid or expired link"},
            status_code=400,
        )

    if AuthService().email_exists(new_email, exclude_pk=user.pk):
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    try:
        with transaction.atomic():
            user.email = new_email
            user.save(update_fields=["email"])

            profile = getattr(user, "userprofile", None)
            if profile:
                profile.email_verified = True
                profile.save(update_fields=["email_verified"])
    except IntegrityError:
        # Another account claimed the address after the check above.
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    return AccountManagementResult(
        payload={"message": "Email changed successfully!"},
        status_code=200,
    )
