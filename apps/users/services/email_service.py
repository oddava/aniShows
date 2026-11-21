import httpx
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMultiAlternatives, send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from ...shared.celery import observed_shared_task
from ...shared.logger import logger
from ..tokens import EmailChangeTokenGenerator, email_verification_token_generator
from .email_layout import BRAND, action_email_html

SECURITY_NOTICE_FOOTER = (
    "If this was you, you can ignore this email. If it wasn't, reset your password "
    f"at {settings.FRONTEND_URL}/forgot-password and contact us."
)


IGNORE_IF_NOT_YOU = "If this wasn't you, you can safely ignore this email."


def mask_email(address: str) -> str:
    """``alice@example.com`` -> ``a***@example.com`` (for notices and logs)."""
    local, sep, domain = (address or "").partition("@")
    if not sep:
        return "***"
    return f"{local[:1]}***@{domain}"


def _masked(recipient_list) -> list[str]:
    """Recipients as they may appear in logs (A19): never the full address."""
    return [mask_email(str(address)) for address in recipient_list or []]


def link_validity() -> str:
    """How long emailed links last, e.g. "3 days" (PASSWORD_RESET_TIMEOUT)."""
    seconds = int(settings.PASSWORD_RESET_TIMEOUT)
    days, remainder = divmod(seconds, 86400)
    if days and not remainder:
        return f"{days} day{'s' if days != 1 else ''}"
    hours = max(1, round(seconds / 3600))
    return f"{hours} hour{'s' if hours != 1 else ''}"


# The cleanup task's own default; the beat entry below normally sets the same.
_DEFAULT_UNVERIFIED_DAYS = 7


def unverified_account_days() -> int:
    """Days an unverified account is kept before the daily cleanup removes it.

    Read from the ``user-maintenance-daily`` beat entry (``unverified_days``)
    so the email states what the cleanup really does.
    """
    schedule = getattr(settings, "CELERY_BEAT_SCHEDULE", None) or {}
    kwargs = (schedule.get("user-maintenance-daily") or {}).get("kwargs") or {}
    try:
        return int(kwargs.get("unverified_days", _DEFAULT_UNVERIFIED_DAYS))
    except (TypeError, ValueError):
        return _DEFAULT_UNVERIFIED_DAYS


def link_expiry_line() -> str:
    """The one sentence every link email uses for expiry."""
    return f"This link expires in {link_validity()} and works once."


class EmailService:
    """Handle email operations asynchronously."""

    def send_verification_email(self, user):
        """Queue verification email."""
        token = email_verification_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        verify_link = f"{settings.FRONTEND_URL}/verify-email/{uid}/{token}/"

        resend_url = f"{settings.FRONTEND_URL}/verification-pending"
        expiry = (
            f"{link_expiry_line()} If it expires, you can request a new one at {resend_url}. "
            f"Accounts that are not verified within {unverified_account_days()} days "
            "are removed automatically."
        )
        send_email_task.delay(
            subject=f"Verify your email - {BRAND}",
            message=self._get_verification_message(verify_link, expiry),
            recipient_list=[user.email],
            html_message=action_email_html(
                heading=f"Welcome to {BRAND}",
                lines=[
                    f"Hi {user.username}, confirm this email address to finish setting up "
                    "your account."
                ],
                button_label="Verify my email",
                button_url=verify_link,
                notes=[expiry, IGNORE_IF_NOT_YOU],
            ),
        )

    def send_password_reset_email(self, user):
        """Queue password reset email."""
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        reset_link = f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}/"

        expiry = (
            f"{link_expiry_line()} You can request a new one any time at "
            f"{settings.FRONTEND_URL}/forgot-password."
        )
        ignore = f"{IGNORE_IF_NOT_YOU} Your password stays the same."
        message = f"""Someone asked to reset the password of your {BRAND} account ({user.username}).

Choose a new password here:

{reset_link}

{expiry}

{ignore}
"""
        send_email_task.delay(
            subject=f"Reset your password - {BRAND}",
            message=message,
            recipient_list=[user.email],
            html_message=action_email_html(
                heading="Reset your password",
                lines=[
                    f"Someone asked to reset the password of your {BRAND} account "
                    f"({user.username})."
                ],
                button_label="Choose a new password",
                button_url=reset_link,
                notes=[expiry, ignore],
            ),
        )

    def send_email_change_confirmation(self, user, new_email):
        """Queue email change confirmation email.

        The link carries only uid and token: the address waits on the profile
        (``pending_email``), so it never lands in URLs, logs or analytics (A14).
        """
        token = EmailChangeTokenGenerator(new_email).make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        confirm_link = f"{settings.FRONTEND_URL}/confirm-email-change/{uid}/{token}/"

        expiry = (
            f"{link_expiry_line()} You can send a new one from your account settings "
            f"at {settings.FRONTEND_URL}/settings?tab=account."
        )
        ignore = f"{IGNORE_IF_NOT_YOU} Nothing changes unless the link is used."
        message = f"""You asked to change the email address of your {BRAND} account ({user.username}).

Confirm your new email address here:

{confirm_link}

{expiry}

{ignore}
"""

        send_email_task.delay(
            subject=f"Confirm your new email - {BRAND}",
            message=message,
            recipient_list=[new_email],
            html_message=action_email_html(
                heading="Confirm your new email",
                lines=[
                    f"You asked to change the email address of your {BRAND} account "
                    f"({user.username}) to this one."
                ],
                button_label="Confirm my new email",
                button_url=confirm_link,
                notes=[expiry, ignore],
            ),
        )

    def _send_notice(self, address: str, subject: str, body: str) -> None:
        """A security notice; nothing is sent when there is no address."""
        if not address:
            return
        send_email_task.delay(
            subject=subject,
            message=f"{body}\n\n{SECURITY_NOTICE_FOOTER}",
            recipient_list=[address],
        )

    def send_password_changed_notice(self, user) -> None:
        """Tell the account's address that its password was changed or reset."""
        self._send_notice(
            user.email,
            f"Your {BRAND} password was changed",
            f"The password for your {BRAND} account ({user.username}) was just changed, "
            "and every device was signed out.",
        )

    def send_email_change_requested_notice(self, user, new_email: str) -> None:
        """Tell the *current* address that a change to ``new_email`` was requested."""
        self._send_notice(
            user.email,
            f"Email change requested - {BRAND}",
            f"Someone asked to change the email of your {BRAND} account ({user.username}) "
            f"to {mask_email(new_email)}. Nothing changes unless that address confirms it.",
        )

    def send_email_changed_notice(self, user, old_email: str, new_email: str) -> None:
        """Tell the *previous* address that the account now uses ``new_email``."""
        self._send_notice(
            old_email,
            f"Your {BRAND} email was changed",
            f"The email of your {BRAND} account ({user.username}) was changed to "
            f"{mask_email(new_email)}, and every device was signed out.",
        )

    def _get_verification_message(self, link: str, expiry: str) -> str:
        return f"""Welcome to {BRAND}!

Confirm this email address to finish setting up your account:

{link}

{expiry}

{IGNORE_IF_NOT_YOU}
"""


def _response_excerpt(response: httpx.Response | None, limit: int = 300) -> str:
    if response is None:
        return ""
    return (response.text or "")[:limit]


@observed_shared_task(retry_policy="standard")
def send_email_task(self, subject, message, recipient_list, html_message=None, headers=None):
    """Celery task for sending emails through Resend HTTP API.

    ``headers`` (e.g. ``List-Unsubscribe``) is passed through to the message; the
    default ``None`` sends exactly what this task sent before it existed.
    """
    try:
        from_email = settings.DEFAULT_FROM_EMAIL
        resend_api_key = settings.RESEND_API_KEY
        email_backend = settings.EMAIL_BACKEND
        resend_base_url = settings.RESEND_API_URL.rstrip("/")

        # In tests/local dev, respect Django email backend when Resend isn't configured.
        local_backends = (
            "django.core.mail.backends.locmem.EmailBackend",
            "django.core.mail.backends.console.EmailBackend",
            "django.core.mail.backends.filebased.EmailBackend",
        )
        if email_backend in local_backends:
            if headers:
                mail = EmailMultiAlternatives(
                    subject=subject,
                    body=message,
                    from_email=from_email,
                    to=recipient_list,
                    headers=dict(headers),
                )
                if html_message:
                    mail.attach_alternative(html_message, "text/html")
                sent_count = mail.send(fail_silently=False)
            else:
                sent_count = send_mail(
                    subject=subject,
                    message=message,
                    from_email=from_email,
                    recipient_list=recipient_list,
                    html_message=html_message,
                    fail_silently=False,
                )
            logger.info(
                "Email sent via Django backend %s to %s (count=%s)",
                email_backend,
                _masked(recipient_list),
                sent_count,
            )
            return {
                "backend": email_backend,
                "sent_count": sent_count,
                "to": _masked(recipient_list),
            }

        if not resend_api_key:
            raise ValueError("RESEND_API_KEY is not configured")

        payload = {
            "from": from_email,
            "to": recipient_list,
            "subject": subject,
            "text": message or "",
        }
        if html_message:
            payload["html"] = html_message
        if headers:
            payload["headers"] = dict(headers)

        request_headers = {
            "Authorization": f"Bearer {resend_api_key}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=settings.RESEND_REQUEST_TIMEOUT) as client:
            response = client.post(
                f"{resend_base_url}/emails",
                headers=request_headers,
                json=payload,
            )
            response.raise_for_status()
            try:
                data = response.json()
            except ValueError as exc:
                logger.warning(
                    "Email provider returned invalid JSON; retrying",
                    extra={"recipient_list": _masked(recipient_list)},
                    exc_info=True,
                )
                raise self.retry(exc=exc, countdown=60)

        message_id = data.get("id")
        logger.info(
            "Email sent successfully via Resend to %s (id=%s)",
            _masked(recipient_list),
            message_id,
        )
        return {"id": message_id, "to": _masked(recipient_list)}
    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        logger.warning(
            "Transient email delivery failure; retrying",
            extra={"recipient_list": _masked(recipient_list)},
            exc_info=True,
        )
        raise self.retry(exc=exc, countdown=60)
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 429 or (status_code is not None and status_code >= 500):
            logger.warning(
                "Email provider returned retryable response; retrying",
                extra={
                    "recipient_list": _masked(recipient_list),
                    "status_code": status_code,
                    "response_excerpt": _response_excerpt(exc.response),
                },
            )
            raise self.retry(exc=exc, countdown=60)

        logger.error(
            "Email provider rejected message without retry",
            extra={
                "recipient_list": _masked(recipient_list),
                "status_code": status_code,
                "response_excerpt": _response_excerpt(exc.response),
            },
            exc_info=True,
        )
        raise
    except ValueError:
        logger.error(
            "Email delivery misconfigured",
            extra={"recipient_list": _masked(recipient_list)},
            exc_info=True,
        )
        raise
    except Exception as exc:
        logger.exception("Failed to send email", extra={"recipient_list": _masked(recipient_list)})
        raise self.retry(exc=exc, countdown=60)
