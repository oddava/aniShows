"""Avatars and banners leave storage with their profile or when replaced (A10)."""

from datetime import timedelta
from unittest.mock import patch

from botocore.exceptions import EndpointConnectionError
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from root.storage_backends import MediaStorage

from ..models import UserProfile
from ..services.account_management_service import delete_account
from ..services.celery_tasks import UserTaskService
from ..services.profile_update_service import update_user_profile

User = get_user_model()

AVATAR = "avatars/1/old-avatar.webp"
BANNER = "banners/1/old-banner.webp"


class MediaCleanupTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pictured", email="pictured@example.com", password="securepass123"
        )
        UserProfile.objects.filter(user=self.user).update(avatar=AVATAR, banner=BANNER)
        self.user.refresh_from_db()
        delete_patcher = patch.object(MediaStorage, "delete", autospec=True)
        self.storage_delete = delete_patcher.start()
        self.addCleanup(delete_patcher.stop)

    def deleted_names(self):
        return sorted(call.args[1] for call in self.storage_delete.call_args_list)

    def test_account_delete_removes_both_files_after_commit(self):
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            delete_account(self.user, "securepass123")
        self.storage_delete.assert_not_called()  # nothing before the commit

        for callback in callbacks:
            callback()
        self.assertEqual(self.deleted_names(), [AVATAR, BANNER])

    def test_unverified_purge_removes_files(self):
        User.objects.filter(pk=self.user.pk).update(date_joined=timezone.now() - timedelta(days=30))
        with self.captureOnCommitCallbacks(execute=True):
            result = UserTaskService.cleanup_unverified_accounts(days=7)

        self.assertEqual(result["deleted_count"], 1)
        self.assertEqual(self.deleted_names(), [AVATAR, BANNER])

    def test_admin_style_queryset_delete_removes_files(self):
        with self.captureOnCommitCallbacks(execute=True):
            User.objects.filter(pk=self.user.pk).delete()
        self.assertEqual(self.deleted_names(), [AVATAR, BANNER])

    @patch.object(
        MediaStorage, "save", autospec=True, side_effect=lambda storage, name, *a, **k: name
    )
    def test_replacing_the_avatar_deletes_only_the_old_avatar(self, _save):
        new_avatar = SimpleUploadedFile("new.webp", b"RIFF....WEBP", content_type="image/webp")
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"avatar": new_avatar})

        profile = UserProfile.objects.get(user=self.user)
        self.assertNotEqual(profile.avatar.name, AVATAR)
        self.assertEqual(self.deleted_names(), [AVATAR])

    def test_removing_the_banner_deletes_it(self):
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"remove_banner": True})

        self.assertFalse(UserProfile.objects.get(user=self.user).banner)
        self.assertEqual(self.deleted_names(), [BANNER])

    def test_a_bio_edit_deletes_nothing(self):
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"bio": "hello"})
        self.storage_delete.assert_not_called()

    def test_a_rolled_back_update_deletes_nothing(self):
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    update_user_profile(self.user, {"remove_banner": True})
                    raise RuntimeError("roll back after the deletion was queued")
            except RuntimeError:
                pass
        self.assertTrue(UserProfile.objects.get(user=self.user).banner)
        self.storage_delete.assert_not_called()

    def test_storage_errors_are_swallowed(self):
        self.storage_delete.side_effect = EndpointConnectionError(endpoint_url="http://minio")
        with self.captureOnCommitCallbacks(execute=True):
            delete_account(self.user, "securepass123")
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())
        self.assertEqual(self.storage_delete.call_count, 2)

    def test_profile_without_images_deletes_nothing(self):
        UserProfile.objects.filter(user=self.user).update(avatar=None, banner=None)
        self.user.refresh_from_db()
        with self.captureOnCommitCallbacks(execute=True):
            delete_account(self.user, "securepass123")
        self.storage_delete.assert_not_called()
