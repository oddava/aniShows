"""A badge's uploaded image can be removed, so the badge shows its icon again."""

from unittest.mock import patch

from django.test import TestCase

from ...core.models import AuditLog
from ...users.models import Badge
from .helpers import bearer_client, make_user

URL = "/api/v1/admin/badges/"


class BadgeImageRemovalTests(TestCase):
    def setUp(self):
        self.root = bearer_client(make_user("badge-root", role="superuser"))
        self.badge = Badge.objects.create(name="Founder", description="Early member", icon="star")
        Badge.objects.filter(pk=self.badge.pk).update(image="badges/founder.png")

    def test_remove_image_clears_it_deletes_the_file_and_audits(self):
        with (
            patch("apps.users.views.admin_badges.delete_files_on_commit") as delete_files,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.root.patch(
                f"{URL}{self.badge.pk}/", {"remove_image": "true"}, format="multipart"
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["image"])
        self.badge.refresh_from_db()
        self.assertFalse(self.badge.image)
        [files] = delete_files.call_args.args
        self.assertEqual([file.name for file in files], ["badges/founder.png"])
        row = AuditLog.objects.get(entity_type="Badge")
        self.assertEqual(
            (row.previous_state["image"], row.new_state["image"]), ("badges/founder.png", "")
        )

    def test_a_plain_update_keeps_the_image(self):
        # Test settings point media at an unconfigured S3 bucket; only the URL is stubbed.
        with patch(
            "root.storage_backends.MediaStorage.url", return_value="/media/badges/founder.png"
        ):
            response = self.root.patch(
                f"{URL}{self.badge.pk}/", {"name": "Founders"}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.badge.refresh_from_db()
        self.assertEqual(self.badge.image.name, "badges/founder.png")
