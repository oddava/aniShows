from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode

from ..models import UserProfile
from ..tokens import EmailChangeTokenGenerator, normalize_email
from .auth_service import AuthService, lock_user_sessions, revoke_all_sessions
from .cache import invalidate_user_caches
from .email_service import EmailService

User = get_user_model()


@dataclass(slots=True)
class AccountManagementResult:
    payload: dict
    status_code: int


def change_password(user, new_password, email_service: EmailService | None = None):
    """Set a new password and end every session; the caller re-issues its own."""
    user.set_password(new_password)
    user.save(update_fields=["password"])
    revoke_all_sessions(user)
    (email_service or EmailService()).send_password_changed_notice(user)
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


def _pending_email_result(message: str, profile) -> AccountManagementResult:
    return AccountManagementResult(
        payload={"message": message, "pending_email": profile.pending_email or None},
        status_code=200,
    )


def _set_pending_email(profile, address: str) -> None:
    profile.pending_email = address
    profile.pending_email_requested_at = timezone.now() if address else None
    profile.save(update_fields=["pending_email", "pending_email_requested_at"])
    transaction.on_commit(
        lambda: invalidate_user_caches(profile.user_id, trigger_stats_update=False)
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

    new_email = normalize_email(new_email if isinstance(new_email, str) else "")
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

    # Accepted residual enumeration (spec A18): the caller is signed in and,
    # for password accounts, re-entered the password; the request is throttled.
    auth_service = AuthService()
    # An address equal to another user's (email-shaped) username would take
    # that username's sign-in over, so it counts as in use too.
    if auth_service.email_exists(new_email, exclude_pk=user.pk) or auth_service.username_exists(
        new_email, exclude_pk=user.pk
    ):
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    # The address waits on the profile until its owner clicks the link; the
    # link itself carries only uid and token (A14). The user-row lock orders
    # this against a confirm running at the same moment.
    with transaction.atomic():
        lock_user_sessions(user.pk)
        profile, _ = UserProfile.objects.get_or_create(user=user)
        _set_pending_email(profile, new_email)
    # The token covers pending_email_requested_at; mint it from this profile,
    # not a copy cached on request.user before the request.
    user.userprofile = profile
    email_service.send_email_change_confirmation(user, new_email)
    email_service.send_email_change_requested_notice(user, new_email)
    return _pending_email_result(
        "Confirmation email sent to your new email address. Please check your inbox.", profile
    )


def resend_email_change(user, email_service: EmailService) -> AccountManagementResult:
    """Send the confirmation link again to the pending address."""
    profile = UserProfile.objects.filter(user=user).first()
    if profile is None or not profile.pending_email:
        return AccountManagementResult(
            payload={"error": "There is no email change waiting for confirmation."},
            status_code=400,
        )
    user.userprofile = profile  # fresh pending_email_requested_at for the token
    email_service.send_email_change_confirmation(user, profile.pending_email)
    return _pending_email_result("Confirmation email sent again.", profile)


def cancel_email_change(user) -> AccountManagementResult:
    """Forget the pending address; links already sent stop working."""
    with transaction.atomic():
        lock_user_sessions(user.pk)  # ordered against a concurrent confirm
        profile, _ = UserProfile.objects.get_or_create(user=user)
        if profile.pending_email:
            _set_pending_email(profile, "")
    return _pending_email_result("Email change cancelled.", profile)


def confirm_email_change(uidb64, token, new_email_encoded=None, email_service=None):
    if not isinstance(uidb64, str) or not isinstance(token, str) or not uidb64 or not token:
        return AccountManagementResult(
            payload={"error": "Missing required fields"}, status_code=400
        )

    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.select_related("userprofile").get(pk=uid)
        # Links from before pending_email (3-segment form, one release): the
        # address they carry must be the one waiting on the profile.
        legacy_email = (
            normalize_email(force_str(urlsafe_base64_decode(new_email_encoded)))
            if isinstance(new_email_encoded, str) and new_email_encoded
            else None
        )
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return AccountManagementResult(payload={"error": "Invalid link"}, status_code=400)

    invalid = AccountManagementResult(
        payload={"error": "Invalid or expired link"},
        status_code=400,
    )
    profile = getattr(user, "userprofile", None)
    if profile is None:
        return invalid
    new_email = normalize_email(profile.pending_email)
    if not new_email or (legacy_email is not None and legacy_email != new_email):
        return invalid

    # The token covers the current address and the pending one, so it stops
    # working once used, cancelled or replaced by another request.
    if not EmailChangeTokenGenerator(new_email).check_token(user, token):
        return invalid

    # Re-checked here: a link issued before another account took the address (or
    # a username equal to it, which login would then shadow) must not apply.
    auth_service = AuthService()
    if auth_service.email_exists(new_email, exclude_pk=user.pk) or auth_service.username_exists(
        new_email, exclude_pk=user.pk
    ):
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    old_email = user.email
    try:
        with transaction.atomic():
            # Two submits of one link (two tabs, a mail prefetcher) must not both
            # apply it: lock the user, then re-check the token on fresh rows.
            # (No select_related: FOR UPDATE cannot cover the outer join to the profile.)
            user = User.objects.select_for_update().get(pk=user.pk)
            profile = UserProfile.objects.get(user=user)
            user.userprofile = profile  # the token covers its pending fields
            if normalize_email(profile.pending_email) != new_email or not (
                EmailChangeTokenGenerator(new_email).check_token(user, token)
            ):
                return invalid
            user.email = new_email
            user.save(update_fields=["email"])
            profile.email_verified = True
            profile.pending_email = ""
            profile.pending_email_requested_at = None
            profile.save(
                update_fields=["email_verified", "pending_email", "pending_email_requested_at"]
            )
    except IntegrityError:
        # Another account claimed the address after the check above.
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    invalidate_user_caches(user.id, user.username, trigger_stats_update=False)
    # Whoever holds a session may have started this; every device signs in
    # again with the new address (A32). The old address hears about it.
    revoke_all_sessions(user)
    (email_service or EmailService()).send_email_changed_notice(user, old_email, new_email)
    return AccountManagementResult(
        payload={
            "message": "Email changed successfully! Please sign in again with your new email."
        },
        status_code=200,
    )
