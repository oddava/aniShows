from django.test import SimpleTestCase

from ..services.celery_admin_service import (
    CeleryTaskValidationError,
    validate_task_invocation,
)


class CeleryAdminTaskValidationTests(SimpleTestCase):
    def test_rejects_non_allowlisted_task(self):
        with self.assertRaisesMessage(CeleryTaskValidationError, "not allowed"):
            validate_task_invocation(
                task_path="apps.users.tasks.delete_everything",
                args=[],
                kwargs={},
            )

    def test_rejects_unknown_kwargs(self):
        with self.assertRaisesMessage(CeleryTaskValidationError, "Unknown task argument"):
            validate_task_invocation(
                task_path="apps.animes.tasks.sync.sync_anime_catalog",
                args=[],
                kwargs={"sync_type": "trending", "surprise": True},
            )

    def test_rejects_invalid_arg_containers(self):
        with self.assertRaisesMessage(CeleryTaskValidationError, "Task args must be a JSON list"):
            validate_task_invocation(
                task_path="apps.animes.tasks.sync.sync_anime_catalog",
                args="",
                kwargs={"sync_type": "trending"},
            )

        with self.assertRaisesMessage(
            CeleryTaskValidationError,
            "Task kwargs must be a JSON object",
        ):
            validate_task_invocation(
                task_path="apps.animes.tasks.sync.sync_anime_catalog",
                args=[],
                kwargs="",
            )

    def test_rejects_invalid_enum_and_range_values(self):
        with self.assertRaisesMessage(CeleryTaskValidationError, "sync_type must be one of"):
            validate_task_invocation(
                task_path="apps.animes.tasks.sync.sync_anime_catalog",
                args=[],
                kwargs={"sync_type": "everything"},
            )

        with self.assertRaisesMessage(CeleryTaskValidationError, "limit must be at most 500"):
            validate_task_invocation(
                task_path="apps.animes.tasks.sync.sync_anime_catalog",
                args=[],
                kwargs={"sync_type": "trending", "limit": 501},
            )

    def test_cleanup_task_cannot_target_new_accounts(self):
        with self.assertRaisesMessage(CeleryTaskValidationError, "days must be at least 7"):
            validate_task_invocation(
                task_path="apps.users.tasks.cleanup_unverified_accounts",
                args=[],
                kwargs={"days": 1},
            )

    def test_valid_invocation_fills_defaults(self):
        args, kwargs = validate_task_invocation(
            task_path="apps.animes.tasks.sync.sync_anime_catalog",
            args=[],
            kwargs={"sync_type": "trending"},
        )

        self.assertEqual(args, [])
        self.assertEqual(kwargs, {"sync_type": "trending", "limit": 50})
