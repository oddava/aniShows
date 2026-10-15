import httpx
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from ...shared.celery import observed_shared_task
from ...shared.logger import logger
from ..tokens import EmailChangeTokenGenerator, email_verification_token_generator


class EmailService:
    """Handle email operations asynchronously."""

    def send_verification_email(self, user):
        """Queue verification email."""
        token = email_verification_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        verify_link = f"{settings.FRONTEND_URL}/verify-email/{uid}/{token}/"

        send_email_task.delay(
            subject="Verify your email - aniShows",
            message=self._get_verification_message(verify_link),
            recipient_list=[user.email],
        )

    def send_password_reset_email(self, user):
        """Queue password reset email."""
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        reset_link = f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}/"

        send_email_task.delay(
            subject="Reset your password - aniShows",
            message=f"Click to reset: {reset_link}",
            recipient_list=[user.email],
        )

    def send_email_change_confirmation(self, user, new_email):
        """Queue email change confirmation email."""
        token = EmailChangeTokenGenerator(new_email).make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        new_email_encoded = urlsafe_base64_encode(force_bytes(new_email))

        confirm_link = f"{settings.FRONTEND_URL}/confirm-email-change/{uid}/{token}/{new_email_encoded}/"

        message = f"""You requested to change your email address on aniShows.

Click the link below to confirm your new email address:

{confirm_link}

If you didn't request this change, please ignore this email.
"""

        send_email_task.delay(
            subject="Confirm your new email - aniShows",
            message=message,
            recipient_list=[new_email],
        )

    def _get_verification_message(self, link: str) -> str:
        return f"""Welcome to aniShows!

Please verify your email: {link}

Note: Unverified accounts are automatically deleted after 7 days.
"""


def _response_excerpt(response: httpx.Response | None, limit: int = 300) -> str:
    if response is None:
        return ""
    return (response.text or "")[:limit]


@observed_shared_task(retry_policy="standard")
def send_email_task(self, subject, message, recipient_list, html_message=None):
    """Celery task for sending emails through Resend HTTP API."""
    try:
        from_email = settings.DEFAULT_FROM_EMAIL
        resend_api_key = settings.RESEND_API_KEY
        email_backend = getattr(settings, "EMAIL_BACKEND", "")
        resend_base_url = settings.RESEND_API_URL.rstrip("/")

        # In tests/local dev, respect Django email backend when Resend isn't configured.
        local_backends = (
            "django.core.mail.backends.locmem.EmailBackend",
            "django.core.mail.backends.console.EmailBackend",
            "django.core.mail.backends.filebased.EmailBackend",
        )
        if email_backend in local_backends:
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
                recipient_list,
                sent_count,
            )
            return {"backend": email_backend, "sent_count": sent_count, "to": recipient_list}

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

        headers = {
            "Authorization": f"Bearer {resend_api_key}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=settings.RESEND_REQUEST_TIMEOUT) as client:
            response = client.post(
                f"{resend_base_url}/emails",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            try:
                data = response.json()
            except ValueError as exc:
                logger.warning(
                    "Email provider returned invalid JSON; retrying",
                    extra={"recipient_list": recipient_list},
                    exc_info=True,
                )
                raise self.retry(exc=exc, countdown=60)

        message_id = data.get("id")
        logger.info(
            "Email sent successfully via Resend to %s (id=%s)",
            recipient_list,
            message_id,
        )
        return {"id": message_id, "to": recipient_list}
    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        logger.warning(
            "Transient email delivery failure; retrying",
            extra={"recipient_list": recipient_list},
            exc_info=True,
        )
        raise self.retry(exc=exc, countdown=60)
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 429 or (status_code is not None and status_code >= 500):
            logger.warning(
                "Email provider returned retryable response; retrying",
                extra={
                    "recipient_list": recipient_list,
                    "status_code": status_code,
                    "response_excerpt": _response_excerpt(exc.response),
                },
            )
            raise self.retry(exc=exc, countdown=60)

        logger.error(
            "Email provider rejected message without retry",
            extra={
                "recipient_list": recipient_list,
                "status_code": status_code,
                "response_excerpt": _response_excerpt(exc.response),
            },
            exc_info=True,
        )
        raise
    except ValueError:
        logger.error("Email delivery misconfigured", extra={"recipient_list": recipient_list}, exc_info=True)
        raise
    except Exception as exc:
        logger.exception("Failed to send email", extra={"recipient_list": recipient_list})
        raise self.retry(exc=exc, countdown=60)
