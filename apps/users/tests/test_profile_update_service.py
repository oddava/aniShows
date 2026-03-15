from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.users.services.profile_update_service import update_user_profile


class ProfileUpdateServiceTests(SimpleTestCase):
    @patch("apps.users.services.profile_update_service.invalidate_user_caches")
    @patch("apps.users.services.profile_update_service.UserProfile.objects.get_or_create")
    def test_updates_only_changed_non_file_fields(self, mock_get_or_create, mock_invalidate):
        user = Mock(id=42, username="serviceuser")
        profile = Mock()
        profile.social_links = []
        mock_get_or_create.return_value = (profile, False)

        update_user_profile(user, {"bio": "hello world"})

        profile.save.assert_called_once_with(update_fields=["bio"])
        mock_invalidate.assert_called_once_with(user.id, user.username)
