import contextlib
from collections.abc import Mapping
from datetime import UTC, datetime

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import generics, status
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed, Throttled, ValidationError
from rest_framework.fields import CharField, EmailField, Field
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView as BaseTokenRefreshView

from ...core.api_errors import error_response
from ...core.services.admin_settings_service import is_registration_enabled
from ...shared.errors import CACHE_ERRORS
from ...shared.logger import logger
from ...shared.throttling import refuse_on_cache_outage, warn_cache_outage
from .. import throttling
from ..auth_cookies import (
    clear_refresh_cookie,
    cookie_auth_rejected,
    end_django_session,
    get_refresh_cookie,
    move_refresh_to_cookie,
)
from ..serializers.accounts import RegisterSerializer
from ..services.auth_flow_service import (
    AuthFlowError,
    password_reset_confirm_flow,
    password_reset_flow,
    register_user_flow,
    resend_verification_flow,
    verify_email_flow,
)
from ..services.auth_service import (
    AuthService,
    add_session_claims,
    live_refresh_tokens,
    lock_user_sessions,
    revoke_other_sessions,
    token_auth_time,
)
from ..services.device_sessions import (
    CurrentSessionError,
    SessionNotFoundError,
    begin_device_session,
    end_device_session,
    list_device_sessions,
    revoke_device_session,
    rotate_device_session,
)
from ..services.email_service import EmailService
from ..services.ws_ticket_service import TICKET_TTL_SECONDS, issue_ws_ticket

User = get_user_model()


LOGIN_IDENTIFIER_REQUIRED = "Enter a username or email."


class _StrictStringMixin(Field):
    """Reject non-string input instead of coercing it (DRF turns ``5`` into ``"5"``)."""

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class _LoginCharField(_StrictStringMixin, CharField):
    pass


class _LoginEmailField(_StrictStringMixin, EmailField):
    pass


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Blank is allowed so "neither given" gets one clear message in validate().
        self.fields["username"] = _LoginCharField(required=False, allow_blank=True)
        self.fields["email"] = _LoginEmailField(required=False, allow_blank=True)
        self.fields["password"] = _LoginCharField(
            write_only=True, trim_whitespace=False, style={"input_type": "password"}
        )

    @classmethod
    def get_token(cls, user):
        # Also used for Google sign-in (REST_AUTH JWT_TOKEN_CLAIMS_SERIALIZER),
        # so both kinds of sign-in stamp auth_time.
        return add_session_claims(super().get_token(user), user)

    def validate(self, attrs):
        # Log in with a username or an email. Whichever is given, an unknown
        # identifier still reaches authenticate() (which hashes a dummy
        # password), so it fails with the same 401 as a wrong password and
        # does not reveal whether an account exists.
        username = (attrs.get("username") or "").strip()
        email = (attrs.get("email") or "").strip()
        if not username and not email:
            raise ValidationError({"username": [LOGIN_IDENTIFIER_REQUIRED]}, code="required")

        attrs["username"] = AuthService().normalize_login_identifier(
            username=username or None, email=None if username else email
        )
        return super().validate(attrs)


class CustomTokenObtainPairView(TokenObtainPairView):
    """Handle login with username/email support.

    Returns the access token in the body; the refresh token is set as an
    httpOnly cookie.
    """

    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [throttling.LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        # Login CSRF (A08): the same header + Origin check as refresh/logout,
        # so a cross-site form cannot sign the victim into another account.
        rejected = cookie_auth_rejected(request)
        if rejected is not None:
            return rejected

        # Keyed on the identifier as typed (lowercased), not the resolved
        # account: an account-wide lock would show through any other spelling
        # and confirm which email belongs to a known username. So a username and
        # its email have separate counters (at most 2x10 guesses per window).
        identifier = _login_identifier(request_body(request))
        identifier_throttle = throttling.LoginIdentifierThrottle(identifier) if identifier else None
        if identifier_throttle is not None:
            try:
                wait = identifier_throttle.begin_attempt()
            except CACHE_ERRORS:
                # Fail closed: without the counter guesses would be unlimited.
                refuse_on_cache_outage("login identifier throttle")
            if wait is not None:
                raise Throttled(wait=wait)

        try:
            response = super().post(request, *args, **kwargs)
        except AuthenticationFailed:
            raise  # stays counted
        except Exception:
            # A 400 (bad input) never reached the password check.
            _release_login_attempt(identifier_throttle)
            raise
        # Only this attempt's slot: earlier failures expire with the window.
        _release_login_attempt(identifier_throttle)
        _begin_session_from(request, response)
        return move_refresh_to_cookie(response)


def _begin_session_from(request, response) -> None:
    """A sign-in response carries a new refresh token: record this device (BUG-008)."""
    data = getattr(response, "data", None)
    if getattr(response, "status_code", None) == 200 and isinstance(data, dict):
        refresh = data.get("refresh")
        if isinstance(refresh, str) and refresh:
            begin_device_session(request, refresh)


def _release_login_attempt(identifier_throttle) -> None:
    """Give back a slot; the cache failing now leaves it counted until the window ends."""
    if identifier_throttle is None:
        return
    try:
        identifier_throttle.release_attempt()
    except CACHE_ERRORS:
        warn_cache_outage("login identifier release")


def request_body(request) -> Mapping:
    """``request.data`` when it is an object, else ``{}`` (a JSON array or string body).

    Views read fields with ``.get()``; a non-object body must be a 400 from the
    usual missing-field checks, not an AttributeError (500).
    """
    data = request.data
    return data if isinstance(data, Mapping) else {}


def _login_identifier(data: Mapping) -> str | None:
    """The username or email a login attempt names, if it is a usable string."""
    for field in ("username", "email"):
        value = data.get(field)
        if isinstance(value, str) and value.strip():
            return value
    return None


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
        username = validated_data.get("username") or ""
        email = validated_data.get("email") or ""

        # An address that equals an existing (legacy, email-shaped) username
        # would take that username's sign-in over, so it counts as in use.
        if (
            self.auth_service.username_exists(username)
            or self.auth_service.email_exists(email)
            or self.auth_service.username_exists(email)
        ):
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

        result = register_user_flow(
            serializer.validated_data, self.auth_service, self.email_service
        )
        headers = self.get_success_headers(serializer.data)
        return Response(result.payload, status=result.status_code, headers=headers)


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
        if self.action == "resend_verification":
            return [throttling.ResendVerificationRateThrottle()]
        if self.action == "password_reset":
            return [throttling.PasswordResetRateThrottle()]
        if self.action in ["verify_email", "password_reset_confirm"]:
            return [throttling.StrictUserRateThrottle()]
        return super().get_throttles()

    @action(detail=False, methods=["post"])
    def verify_email(self, request, **kwargs):
        """Verify email from the link's URL kwargs (or POST data).

        POST-only so mail scanners and link prefetchers that GET the URL
        can't consume the single-use token.
        """
        # It sets the refresh cookie, so it needs the login-CSRF check (A08).
        rejected = cookie_auth_rejected(request)
        if rejected is not None:
            return rejected

        body = request_body(request)
        uidb64 = kwargs.get("uid") or body.get("uid")
        token = kwargs.get("token") or body.get("token")

        try:
            result = verify_email_flow(uidb64, token, request, self.auth_service)
        except AuthFlowError as exc:
            return error_response(
                exc.message,
                code="email_verification_failed",
                status_code=exc.status_code,
            )

        response = Response(result.payload, status=result.status_code)
        _begin_session_from(request, response)
        return move_refresh_to_cookie(response)

    @action(detail=False, methods=["post"])
    def resend_verification(self, request):
        """Resend verification email."""
        try:
            result = resend_verification_flow(
                request_body(request).get("email"), self.email_service
            )
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
            result = password_reset_flow(request_body(request).get("email"), self.email_service)
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
        body = request_body(request)
        try:
            result = password_reset_confirm_flow(
                body.get("uid"),
                body.get("token"),
                body.get("password"),
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
            with transaction.atomic():
                # Two requests with the same refresh token (two tabs, a
                # retried request) would both pass the blacklist check before
                # either blacklists it, and both get a new token. Lock the
                # token's row so the second waits and then sees it blacklisted.
                token = self.token_class(attrs["refresh"])
                # User row first (as revocation does), so a concurrent "sign
                # out everywhere" cannot miss the token this rotation creates.
                lock_user_sessions(token.get(jwt_settings.USER_ID_CLAIM))
                OutstandingToken.objects.select_for_update().filter(
                    jti=token[jwt_settings.JTI_CLAIM]
                ).first()
                data = super().validate(attrs)
                if data.get("refresh"):
                    # The device's row follows its token (BUG-008).
                    rotate_device_session(
                        self.context.get("request"),
                        str(token[jwt_settings.JTI_CLAIM]),
                        data["refresh"],
                    )
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


class LoggingTokenRefreshView(BaseTokenRefreshView):
    """Rotate the refresh cookie and return a fresh access token.

    The refresh token is read only from the httpOnly cookie, never the body.
    """

    serializer_class = LoggingTokenRefreshSerializer
    authentication_classes = []

    def post(self, request, *args, **kwargs):
        rejected = cookie_auth_rejected(request)
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
            # The JWT session is over (revoked, expired or rotated away); a
            # Django session must not outlive it.
            end_django_session(request)
            response = error_response(
                "Refresh token is invalid or expired.",
                code="token_not_valid",
                status_code=status.HTTP_401_UNAUTHORIZED,
            )
            return clear_refresh_cookie(response)

        return move_refresh_to_cookie(
            Response(dict(serializer.validated_data), status=status.HTTP_200_OK)
        )


class LogoutView(APIView):
    """Blacklist the refresh cookie's token and clear the cookie.

    Lives under the refresh cookie's path so the browser sends the cookie.
    Needs no access token, so an expired session can still log out.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        rejected = cookie_auth_rejected(request)
        if rejected is not None:
            return rejected

        refresh_token = get_refresh_cookie(request)
        if refresh_token:
            # An invalid, expired or already-blacklisted token needs no revoking.
            with contextlib.suppress(TokenError):
                RefreshToken(refresh_token).blacklist()
            end_device_session(refresh_token)

        end_django_session(request)
        return clear_refresh_cookie(Response(status=status.HTTP_204_NO_CONTENT))


def _cookie_session(request) -> RefreshToken | None:
    """The request's live refresh token (cookie), or None if missing, invalid or revoked."""
    raw = get_refresh_cookie(request)
    if not raw:
        return None
    try:
        token = RefreshToken(raw)  # type: ignore[arg-type]
        token.check_blacklist()
    except TokenError:
        return None
    return token


class _CookieSessionView(APIView):
    """Base for the device-session endpoints under the refresh cookie's path."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def _session_or_error(self, request):
        rejected = cookie_auth_rejected(request)
        if rejected is not None:
            return None, None, rejected
        token = _cookie_session(request)
        user = (
            User.objects.filter(pk=token.get(jwt_settings.USER_ID_CLAIM), is_active=True).first()
            if token is not None
            else None
        )
        if token is None or user is None:
            return (
                None,
                None,
                error_response(
                    "Refresh token is invalid or expired.",
                    code="token_not_valid",
                    status_code=status.HTTP_401_UNAUTHORIZED,
                ),
            )
        return token, user, None


class SessionsView(_CookieSessionView):
    """``{active, current_since, sessions}``: devices signed in to this account.

    ``sessions`` lists each device (label, signed in, last active, which one
    is this one), so one can be signed out on its own (A20, P1-11, BUG-008).
    """

    def get(self, request):
        token, user, error = self._session_or_error(request)
        if error is not None:
            return error
        auth_time = token_auth_time(token)
        sessions = list_device_sessions(user, str(token[jwt_settings.JTI_CLAIM]))
        return Response(
            {
                "active": len(sessions),
                "current_since": (
                    datetime.fromtimestamp(auth_time, tz=UTC).isoformat() if auth_time else None
                ),
                "sessions": sessions,
            }
        )


class RevokeSessionView(_CookieSessionView):
    """Sign out one other device (BUG-008). This device signs out with Log out."""

    def post(self, request, session_id: int):
        token, user, error = self._session_or_error(request)
        if error is not None:
            return error
        try:
            revoke_device_session(user, session_id, str(token[jwt_settings.JTI_CLAIM]))
        except SessionNotFoundError:
            return error_response(
                "That device is not signed in.",
                code="session_not_found",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        except CurrentSessionError:
            return error_response(
                "This is the device you are using; sign out instead.",
                code="current_session",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        logger.info("Signed out one device", extra={"user_id": user.pk})
        return Response({"active": live_refresh_tokens(user).count()})


class RevokeOtherSessionsView(_CookieSessionView):
    """Sign out every other device; this one (the cookie's token) stays signed in."""

    def post(self, request):
        token, user, error = self._session_or_error(request)
        if error is not None:
            return error
        revoked = revoke_other_sessions(user, keep_jti=token[jwt_settings.JTI_CLAIM])
        if revoked is None:
            # This device's token rotated (another tab) between the check and
            # the lock; keeping it would sign this device out instead.
            return error_response(
                "This session just changed. Please try again.",
                code="session_changed",
                status_code=status.HTTP_409_CONFLICT,
            )
        logger.info("Signed out other devices", extra={"user_id": user.pk, "revoked": revoked})
        return Response({"revoked": revoked, "active": live_refresh_tokens(user).count()})


class WebSocketTicketView(APIView):
    """Trade the caller's access token for a single-use WebSocket ticket."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        return Response({"ticket": issue_ws_ticket(request.user), "expires_in": TICKET_TTL_SECONDS})
