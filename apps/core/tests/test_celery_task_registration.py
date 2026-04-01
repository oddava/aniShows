from django.test import SimpleTestCase

from root.celery import app


class CeleryTaskRegistrationTests(SimpleTestCase):
    def test_send_email_task_is_registered(self):
        self.assertIn("apps.users.services.email_service.send_email_task", app.tasks)

    def test_async_logging_tasks_are_registered(self):
        self.assertIn("apps.core.tasks.logging_tasks.log_request_async", app.tasks)
        self.assertIn("apps.core.tasks.logging_tasks.log_audit_async", app.tasks)
        self.assertIn("apps.core.tasks.logging_tasks.log_exception_async", app.tasks)
