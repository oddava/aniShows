from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from rest_framework.test import APITestCase

User = get_user_model()


class EmailConstraintTests(TestCase):
    def test_case_variant_duplicate_is_rejected_by_the_database(self):
        User.objects.create_user(username="one", email="Same@Example.com", password="x")

        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(username="two", email="same@example.com", password="x")

    def test_blank_emails_may_repeat(self):
        User.objects.create_user(username="one", email="", password="x")
        User.objects.create_user(username="two", email="", password="x")


class RegistrationRaceTests(APITestCase):
    def test_losing_a_signup_race_is_a_400_not_a_500(self):
        User.objects.create_user(username="first", email="race@example.com", password="x")

        # Both requests passed the availability check before either inserted.
        with (
            patch("apps.users.services.auth_service.AuthService.username_exists", return_value=False),
            patch("apps.users.services.auth_service.AuthService.email_exists", return_value=False),
        ):
            response = self.client.post(
                reverse("register"),
                {"username": "second", "email": "RACE@example.com", "password": "N3w-Passphrase!"},
            )

        self.assertEqual(response.status_code, 400)


class DuplicateEmailMigrationTests(TransactionTestCase):
    before = [("users", "0036_userprofile_preferred_timezone")]
    after = [("users", "0037_customuser_email_ci_unique")]

    def tearDown(self):
        User.objects.all().delete()
        MigrationExecutor(connection).migrate(self.after)

    def test_migration_stops_with_instructions_when_duplicates_exist(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        old_user = executor.loader.project_state(self.before).apps.get_model("users", "CustomUser")
        old_user.objects.create(username="alice", email="dup@example.com")
        old_user.objects.create(username="bob", email="DUP@example.com")

        executor = MigrationExecutor(connection)
        with self.assertRaisesMessage(RuntimeError, "dup@example.com: "):
            executor.migrate(self.after)

        old_user.objects.filter(username="bob").update(email="bob@example.com")
        MigrationExecutor(connection).migrate(self.after)
