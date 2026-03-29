import httpx
from celery import shared_task
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from apps.shared.logger import logger


class EmailService:
    """Handle email operations asynchronously."""

    def send_verification_email(self, user):
        """Queue verification email."""
        token = default_token_generator.make_token(user)
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
        token = default_token_generator.make_token(user)
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

@shared_task(bind=True, max_retries=3)
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
            data = response.json()

        message_id = data.get("id")
        logger.info(
            "Email sent successfully via Resend to %s (id=%s)",
            recipient_list,
            message_id,
        )
        return {"id": message_id, "to": recipient_list}
    except Exception as exc:
        logger.exception(f"Failed to send email to {recipient_list}: {exc}")
        raise self.retry(exc=exc, countdown=60)
