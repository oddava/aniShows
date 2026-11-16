"""profile_visibility (G1 contract) applies today's is_private rule."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.http import Http404
from django.test import TestCase

from ..services.profile_visibility import can_view_profile, get_visible_user_or_404

User = get_user_model()


class ProfileVisibilityTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", "owner@example.com", "pw-123456")
        self.other = User.objects.create_user("other", "other@example.com", "pw-123456")

    def _make_private(self):
        self.owner.userprofile.is_private = True
        self.owner.userprofile.save(update_fields=["is_private"])

    def test_public_profile_is_visible_to_everyone(self):
        for viewer in (None, AnonymousUser(), self.other, self.owner):
            self.assertTrue(can_view_profile(self.owner, viewer))

    def test_private_profile_is_visible_to_its_owner_only(self):
        self._make_private()
        self.assertTrue(can_view_profile(self.owner, self.owner))
        for viewer in (None, AnonymousUser(), self.other):
            self.assertFalse(can_view_profile(self.owner, viewer))

    def test_get_visible_user_or_404(self):
        self.assertEqual(get_visible_user_or_404("owner", self.other), self.owner)
        self._make_private()
        with self.assertRaises(Http404):
            get_visible_user_or_404("owner", self.other)
        with self.assertRaises(Http404):
            get_visible_user_or_404("nobody", self.other)
