import time
from typing import Dict

from allauth.account import app_settings as allauth_account_settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.http import HttpRequest
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from ...core.services.admin_settings_service import is_email_verification_required
from ..models import UserProfile
from ..tokens import email_verification_token_generator
from .user_queryset import get_annotated_user_queryset

User = get_user_model()

VERIFY_SUCCESS = "verified"
VERIFY_ALREADY_VERIFIED = "already_verified"
VERIFY_INVALID = "invalid"


# Epoch seconds of the sign-in that started this token chain. Rotation copies
# custom claims, so it survives refreshes; only a new sign-in moves it forward.
AUTH_TIME_CLAIM = "auth_time"
REAUTH_MAX_AGE_SECONDS = 600


def add_session_claims(token, user, *, auth_time: int | None = None):
    """Put G1's claims on a fresh refresh token and return it.

    Claims stay minimal: email and role flags come from /users/me/, never
    from a decoded token.
    """
    token["user_id"] = user.id
    token["username"] = user.username
    token[AUTH_TIME_CLAIM] = int(time.time()) if auth_time is None else int(auth_time)
    return token


def issue_refresh_token(user, *, auth_time: int | None = None) -> RefreshToken:
    """A refresh token (and, via ``.access_token``, its access token) for ``user``."""
    return add_session_claims(RefreshToken.for_user(user), user, auth_time=auth_time)


def token_auth_time(token) -> int | None:
    """The ``auth_time`` claim of a validated token, or None when absent or malformed."""
    value = token.get(AUTH_TIME_CLAIM) if token is not None and hasattr(token, "get") else None
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value)


class ReauthRequired(PermissionDenied):
    default_detail = "Please confirm it's you by signing in again."
    default_code = "reauth_required"


def require_recent_auth(request, max_age: int = REAUTH_MAX_AGE_SECONDS) -> None:
    """Raise ``ReauthRequired`` (403) unless a passwordless user signed in recently.

    Accounts with a password prove themselves with it on each sensitive action.
    Accounts without one (Google sign-in) would otherwise let a stolen 15-minute
    access token set a password, change the email or delete the account (A06),
    so those need a sign-in within ``max_age`` seconds.
    """
    if request.user.has_usable_password():
        return
    auth_time = token_auth_time(request.auth)
    if auth_time is None or time.time() - auth_time > max_age:
        raise ReauthRequired()


def revoke_all_sessions(user) -> None:
    """Blacklist every refresh token issued to ``user`` (all devices log out)."""
    BlacklistedToken.objects.bulk_create(
        [
            BlacklistedToken(token=token)
            for token in OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True)
        ],
        ignore_conflicts=True,
    )


class AuthService:
    """Handles authentication business logic."""

    def normalize_login_identifier(
        self, *, username: str | None = None, email: str | None = None
    ) -> str | None:
        """Map a login identifier to the account's canonical username.

        An unknown identifier is returned as given (stripped) rather than
        ``None``, so the caller authenticates it and fails exactly as it would
        for a wrong password.
        """
        if username:
            normalized_username = username.strip()
            if "@" in normalized_username:
                user = (
                    User.objects.filter(email__iexact=normalized_username).only("username").first()
                )
                return user.username if user else normalized_username

            user = (
                User.objects.filter(username__iexact=normalized_username).only("username").first()
            )
            return user.username if user else normalized_username

        if email:
            normalized_email = email.strip()
            user = User.objects.filter(email__iexact=normalized_email).only("username").first()
            return user.username if user else normalized_email

        return None

    def username_exists(self, username: str, *, exclude_pk: int | None = None) -> bool:
        queryset = User.objects.filter(username__iexact=username)
        if exclude_pk is not None:
            queryset = queryset.exclude(pk=exclude_pk)
        return queryset.exists()

    def email_exists(self, email: str, *, exclude_pk: int | None = None) -> bool:
        queryset = User.objects.filter(email__iexact=email)
        if exclude_pk is not None:
            queryset = queryset.exclude(pk=exclude_pk)
        return queryset.exists()

    def validate_registration_credentials(self, username: str, email: str) -> None:
        generic_message = "Unable to create account. The email or username may already be in use."
        if self.username_exists(username):
            raise ValidationError(generic_message)
        if self.email_exists(email):
            raise ValidationError(generic_message)

    def register_user(self, data: Dict) -> User:
        """Create a new user with profile."""
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=data["username"],
                    email=data["email"],
                    password=data["password"],
                )
        except IntegrityError as exc:
            # Lost a race with a concurrent sign-up for the same name or email.
            raise ValidationError(
                "Unable to create account. The email or username may already be in use."
            ) from exc
        verification_required = is_email_verification_required()
        # Profile is auto-created via signal; sync verification state with panel settings.
        profile = getattr(user, "userprofile", None)
        if profile:
            profile.email_verified = not verification_required
            profile.save()
        return user

    def finalize_social_login(self, request: HttpRequest, login) -> User:
        if not login.is_existing:
            if allauth_account_settings.UNIQUE_EMAIL and self.email_exists(login.user.email):
                raise ValidationError(_("User is already registered with this e-mail address."))

            login.lookup()
            try:
                login.save(request, connect=True)
            except IntegrityError as exc:
                raise ValidationError(
                    _("User is already registered with this e-mail address.")
                ) from exc

        return login.account.user

    def verify_email(self, uidb64: str, token: str) -> tuple[str, User | None]:
        """Verify email with a single-use token.

        Returns ``(outcome, user)`` where outcome is one of the ``VERIFY_*``
        constants; ``user`` is None for ``VERIFY_INVALID``.
        """
        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            # Get user with annotations for proper serializer output
            user = get_annotated_user_queryset().get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return VERIFY_INVALID, None

        profile = getattr(user, "userprofile", None)
        if profile is None:
            return VERIFY_INVALID, None

        if email_verification_token_generator.check_token(user, token):
            # Conditional update so concurrent requests with the same link
            # can't both count as the first verification.
            claimed = UserProfile.objects.filter(pk=profile.pk, email_verified=False).update(
                email_verified=True
            )
            profile.email_verified = True
            return (VERIFY_SUCCESS if claimed else VERIFY_ALREADY_VERIFIED), user

        if (
            profile.email_verified
            and email_verification_token_generator.was_valid_before_verification(user, token)
        ):
            return VERIFY_ALREADY_VERIFIED, user

        return VERIFY_INVALID, None
