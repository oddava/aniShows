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
