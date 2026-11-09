from unittest.mock import call, patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from ..models import UserProfile
from ..services.profile_update_service import update_user_profile

User = get_user_model()


class ProfileUpdateServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="serviceuser",
            email="service@example.com",
            password="password123",
        )
        self.profile, _ = UserProfile.objects.update_or_create(user=self.user, defaults={"social_links": []})

    @patch("apps.users.services.profile_update_service.invalidate_user_caches")
    def test_updates_only_changed_non_file_fields(self, mock_invalidate):
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"bio": "hello world"})

        self.profile.refresh_from_db()
        self.assertEqual(self.profile.bio, "hello world")
        mock_invalidate.assert_called_once_with(self.user.id, self.user.username)

    @patch("apps.users.services.profile_update_service.invalidate_user_caches")
    def test_updates_profile_primary_color(self, mock_invalidate):
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"profile_primary_color": "#ef4444"})

        self.profile.refresh_from_db()
        self.assertEqual(self.profile.profile_primary_color, "#ef4444")
        mock_invalidate.assert_called_once_with(self.user.id, self.user.username)

    @patch("apps.users.services.profile_update_service.invalidate_user_caches")
    def test_updates_show_adult_content(self, mock_invalidate):
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"show_adult_content": True})

        self.profile.refresh_from_db()
        self.assertTrue(self.profile.show_adult_content)
        mock_invalidate.assert_called_once_with(self.user.id, self.user.username)

    @patch("apps.users.services.profile_update_service.invalidate_user_caches")
    def test_updates_preferred_timezone(self, mock_invalidate):
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"preferred_timezone": "America/New_York"})

        self.profile.refresh_from_db()
        self.assertEqual(self.profile.preferred_timezone, "America/New_York")
        mock_invalidate.assert_called_once_with(self.user.id, self.user.username)

    @patch("apps.users.services.profile_update_service.invalidate_user_caches")
    def test_username_change_updates_user_and_profile_in_single_transaction(self, mock_invalidate):
        with self.captureOnCommitCallbacks(execute=True):
            update_user_profile(self.user, {"username": "renamed-user"})

        self.user.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.user.username, "renamed-user")
        self.assertIsNotNone(self.profile.last_username_change)
        self.assertEqual(
            mock_invalidate.call_args_list,
            [
                call(self.user.id, "renamed-user"),
                # The public profile cached under the old name must go too.
                call(self.user.id, "serviceuser", trigger_stats_update=False),
            ],
        )

    def test_username_change_rejects_invalid_characters_and_reserved_names(self):
        from rest_framework.exceptions import ValidationError

        for bad in ("has space", "a/b", "<b>x</b>", "me", "ME"):
            with self.subTest(username=bad), self.assertRaises(ValidationError):
                update_user_profile(self.user, {"username": bad})

        self.user.refresh_from_db()
        self.assertEqual(self.user.username, "serviceuser")
