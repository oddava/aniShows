from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode

from .email_service import EmailService

User = get_user_model()


@dataclass(slots=True)
class AccountManagementResult:
    payload: dict
    status_code: int


def change_password(user, new_password):
    user.set_password(new_password)
    user.save()
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

    if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
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
        new_email = force_str(urlsafe_base64_decode(new_email_encoded))
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return AccountManagementResult(payload={"error": "Invalid link"}, status_code=400)

    if not default_token_generator.check_token(user, token):
        return AccountManagementResult(
            payload={"error": "Invalid or expired link"},
            status_code=400,
        )

    if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    user.email = new_email
    user.save()

    profile = getattr(user, "userprofile", None)
    if profile:
        profile.email_verified = True
        profile.save()

    return AccountManagementResult(
        payload={"message": "Email changed successfully!"},
        status_code=200,
    )
