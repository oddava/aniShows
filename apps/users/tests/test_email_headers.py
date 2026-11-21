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
                self.assertIn("This link expires in 3 days and works once.", message.body)
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


class AccountEmailBrandingTests(TestCase):
    """One brand spelling, honest expiry copy and an HTML part for link emails (A3)."""

    def setUp(self):
        from django.contrib.auth import get_user_model

        self.user = get_user_model().objects.create_user(
            username="reader<b>", email="reader@example.com", password="x"
        )

    def _send_all(self):
        from ..services.email_service import EmailService

        service = EmailService()
        service.send_verification_email(self.user)
        service.send_password_reset_email(self.user)
        service.send_email_change_confirmation(self.user, "next@example.com")
        service.send_password_changed_notice(self.user)
        service.send_email_change_requested_notice(self.user, "next@example.com")
        service.send_email_changed_notice(self.user, "old@example.com", "next@example.com")
        return list(mail.outbox)

    def test_every_outgoing_account_email_spells_the_brand_one_way(self):
        messages = self._send_all()

        self.assertEqual(len(messages), 6)
        for message in messages:
            with self.subTest(subject=message.subject):
                self.assertIn("AniShows", message.subject)
                parts = [message.subject, message.body] + [
                    content for content, _ in getattr(message, "alternatives", [])
                ]
                for part in parts:
                    self.assertNotIn("aniShows", part)

    def test_verification_subject_and_expiry_copy_match_the_real_rules(self):
        from django.conf import settings

        from ..services.email_service import EmailService

        EmailService().send_verification_email(self.user)
        message = mail.outbox[0]

        self.assertEqual(message.subject, "Verify your email - AniShows")
        self.assertIn("This link expires in 3 days and works once.", message.body)
        self.assertIn(
            f"request a new one at {settings.FRONTEND_URL}/verification-pending", message.body
        )
        self.assertIn("not verified within 7 days are removed automatically", message.body)
        # The old copy said "valid for" in one place and "deleted after" in another.
        self.assertNotIn("valid for", message.body)
        self.assertNotIn("deleted after", message.body)

    def test_link_emails_carry_an_html_part_with_one_button_and_the_same_link(self):
        import re

        from ..services.email_service import EmailService

        service = EmailService()
        service.send_verification_email(self.user)
        service.send_password_reset_email(self.user)
        service.send_email_change_confirmation(self.user, "next@example.com")

        for message, label in zip(
            mail.outbox,
            ["Verify my email", "Choose a new password", "Confirm my new email"],
            strict=True,
        ):
            with self.subTest(subject=message.subject):
                assert isinstance(message, EmailMultiAlternatives)
                html, mimetype = message.alternatives[0]
                self.assertEqual(mimetype, "text/html")
                link = re.search(
                    r"https?://\S+/(?:verify-email|reset-password|confirm-email-change)/\S+/",
                    message.body,
                ).group(0)
                self.assertIn(f'href="{link}"', html)
                self.assertIn(f">{label}</a>", html)
                self.assertIn('name="color-scheme" content="light dark"', html)
                self.assertIn("expires in 3 days", html)
                # The plain-text part stays the full message.
                self.assertIn(link, message.body)
                # User-controlled text is escaped in the HTML part.
                self.assertNotIn("reader<b>", html)
                self.assertIn("reader&lt;b&gt;", html)

    def test_security_notices_stay_plain_text(self):
        from ..services.email_service import EmailService

        EmailService().send_password_changed_notice(self.user)

        self.assertEqual(getattr(mail.outbox[0], "alternatives", []), [])

    def test_unverified_window_follows_the_cleanup_schedule(self):
        from django.conf import settings
        from django.test import override_settings

        from ..services.email_service import unverified_account_days

        self.assertEqual(
            unverified_account_days(),
            settings.CELERY_BEAT_SCHEDULE["user-maintenance-daily"]["kwargs"]["unverified_days"],
        )
        schedule = {"user-maintenance-daily": {"kwargs": {"unverified_days": 14}}}
        with override_settings(CELERY_BEAT_SCHEDULE=schedule):
            self.assertEqual(unverified_account_days(), 14)
        with override_settings(CELERY_BEAT_SCHEDULE={}):
            self.assertEqual(unverified_account_days(), 7)
