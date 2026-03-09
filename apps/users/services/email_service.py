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
    """Celery task for sending emails."""
    try:
        from django.core.mail import EmailMultiAlternatives

        # Use EmailMultiAlternatives if HTML message is provided
        if html_message:
            email = EmailMultiAlternatives(
                subject=subject,
                body=message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=recipient_list,
            )
            email.attach_alternative(html_message, "text/html")
            result = email.send()
        else:
            result = send_mail(
                subject=subject,
                message=message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=recipient_list,
                fail_silently=False,
            )
        logger.info(
            f"Email sent successfully to {recipient_list}: {result} message(s) sent"
        )
        return result
    except Exception as exc:
        logger.exception(f"Failed to send email to {recipient_list}: {exc}")
        raise self.retry(exc=exc, countdown=60)
