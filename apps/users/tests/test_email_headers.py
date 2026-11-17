"""send_email_task(headers=...) (G1 contract for G4's List-Unsubscribe)."""

from django.core import mail
from django.core.mail import EmailMultiAlternatives
from django.test import TestCase

from ..services.email_service import send_email_task


class EmailHeadersTests(TestCase):
    def test_without_headers_nothing_changes(self):
        send_email_task.apply(kwargs={"subject": "S", "message": "M", "recipient_list": ["a@b.c"]})
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn("List-Unsubscribe", mail.outbox[0].extra_headers)

    def test_headers_reach_the_message(self):
        send_email_task.apply(
            kwargs={
                "subject": "S",
                "message": "M",
                "recipient_list": ["a@b.c"],
                "html_message": "<p>M</p>",
                "headers": {"List-Unsubscribe": "<https://example.com/u>"},
            }
        )
        message = mail.outbox[0]
        assert isinstance(message, EmailMultiAlternatives)
        self.assertEqual(message.extra_headers["List-Unsubscribe"], "<https://example.com/u>")
        self.assertEqual(message.alternatives[0][1], "text/html")


class EmailCopyAndPrivacyTests(TestCase):
    """Emails say how long links last and what to do if it wasn't you; logs mask addresses (A19)."""

    def setUp(self):
        from django.contrib.auth import get_user_model

        self.user = get_user_model().objects.create_user(
            username="reader", email="reader@example.com", password="x"
        )

    def test_link_emails_state_expiry_and_ignore_advice(self):
        from ..services.email_service import EmailService

        service = EmailService()
        service.send_password_reset_email(self.user)
        service.send_verification_email(self.user)
        service.send_email_change_confirmation(self.user, "next@example.com")

        self.assertEqual(len(mail.outbox), 3)
        for message in mail.outbox:
            with self.subTest(subject=message.subject):
                self.assertIn("valid for 3 days", message.body)
                self.assertIn("If this wasn't you", message.body)

    def test_link_validity_follows_the_setting(self):
        from django.test import override_settings

        from ..services.email_service import link_validity

        with override_settings(PASSWORD_RESET_TIMEOUT=86400):
            self.assertEqual(link_validity(), "1 day")
        with override_settings(PASSWORD_RESET_TIMEOUT=7200):
            self.assertEqual(link_validity(), "2 hours")

    def test_logs_and_results_never_hold_the_full_address(self):
        from unittest.mock import patch

        with patch("apps.users.services.email_service.logger") as logger:
            result = send_email_task.apply(
                kwargs={"subject": "S", "message": "M", "recipient_list": ["secret@example.com"]}
            ).get()

        logged = repr(logger.mock_calls)
        self.assertNotIn("secret@example.com", logged)
        self.assertIn("s***@example.com", logged)
        self.assertEqual(result["to"], ["s***@example.com"])
        self.assertEqual(mail.outbox[0].to, ["secret@example.com"])
