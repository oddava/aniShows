import time
from typing import Dict

from allauth.account import app_settings as allauth_account_settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.http import HttpRequest
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from ...core.services.admin_settings_service import is_email_verification_required
from ..models import UserProfile
from ..tokens import email_verification_token_generator
from .user_queryset import filter_username_ci, get_annotated_user_queryset

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


def live_refresh_tokens(user):
    """Unexpired, non-blacklisted refresh tokens of ``user``: one per signed-in device.

    Rotation blacklists each token as it is replaced, so every device holds
    exactly one live token.
    """
    return OutstandingToken.objects.filter(
        user=user, blacklistedtoken__isnull=True, expires_at__gt=timezone.now()
    )


def lock_user_sessions(user_id) -> None:
    """Row-lock the user so session revocation and refresh rotation run one at a time.

    Without it, a refresh rotating concurrently with a revocation could create
    its new refresh token after the revocation listed the live ones, and that
    token would survive. Callers hold a transaction. Lock order is always the
    user row, then token rows.
    """
    User.objects.select_for_update().filter(pk=user_id).exists()


def revoke_other_sessions(user, keep_jti: str) -> int | None:
    """Blacklist every live refresh token of ``user`` except ``keep_jti``; return how many.

    Returns None, revoking nothing, when ``keep_jti`` is no longer live once the
    lock is held (it rotated meanwhile): the caller asks the device to retry.
    """
    with transaction.atomic():
        lock_user_sessions(user.pk)
        if not live_refresh_tokens(user).filter(jti=keep_jti).exists():
            return None
        others = list(live_refresh_tokens(user).exclude(jti=keep_jti))
        BlacklistedToken.objects.bulk_create(
            [BlacklistedToken(token=token) for token in others], ignore_conflicts=True
        )
    return len(others)


def flush_expired_tokens(batch_size: int = 5000) -> int:
    """Delete expired outstanding tokens in batches; their blacklist rows cascade (A20)."""
    deleted = 0
    now = timezone.now()
    while True:
        ids = list(
            OutstandingToken.objects.filter(expires_at__lte=now).values_list("id", flat=True)[
                :batch_size
            ]
        )
        if not ids:
            return deleted
        OutstandingToken.objects.filter(id__in=ids).delete()
        deleted += len(ids)


def revoke_all_sessions(user) -> None:
    """Blacklist every refresh token issued to ``user`` (all devices log out)."""
    with transaction.atomic():
        lock_user_sessions(user.pk)
        BlacklistedToken.objects.bulk_create(
            [
                BlacklistedToken(token=token)
                for token in OutstandingToken.objects.filter(
                    user=user, blacklistedtoken__isnull=True
                )
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
                filter_username_ci(User.objects.all(), normalized_username).only("username").first()
            )
            return user.username if user else normalized_username

        if email:
            normalized_email = email.strip()
            user = User.objects.filter(email__iexact=normalized_email).only("username").first()
            return user.username if user else normalized_email

        return None

    def username_exists(self, username: str, *, exclude_pk: int | None = None) -> bool:
        queryset = filter_username_ci(User.objects.all(), username)
        if exclude_pk is not None:
            queryset = queryset.exclude(pk=exclude_pk)
        return queryset.exists()

    def email_exists(self, email: str, *, exclude_pk: int | None = None) -> bool:
        queryset = User.objects.filter(email__iexact=email)
        if exclude_pk is not None:
            queryset = queryset.exclude(pk=exclude_pk)
        return queryset.exists()

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
