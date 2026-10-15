from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from ...users.models import UserProfile
from ..services.celery_tasks import CoreTaskService

User = get_user_model()


class LinkMetadataTaskTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="links", email="l@example.com", password="x")
        self.profile, _ = UserProfile.objects.update_or_create(
            user=self.user,
            defaults={"social_links": [{"url": "https://github.com/a", "value": "https://github.com/a"}]},
        )

    def test_edit_saved_during_fetch_is_not_overwritten(self):
        edited = [
            {"url": "https://github.com/a", "value": "https://github.com/a"},
            {"url": "https://x.com/b", "value": "https://x.com/b"},
        ]

        def fetch_while_user_edits(url):
            # The user saves a new set of links while the slow fetch runs.
            UserProfile.objects.filter(pk=self.profile.pk).update(social_links=edited)
            return {"title": "GitHub"}

        with patch(
            "apps.core.services.celery_tasks.MetadataService.fetch_metadata",
            side_effect=fetch_while_user_edits,
        ):
            CoreTaskService.fetch_multiple_link_metadata(["https://github.com/a"], self.user.id)

        self.profile.refresh_from_db()
        self.assertEqual(len(self.profile.social_links), 2)
        self.assertEqual(self.profile.social_links[0]["metadata"], {"title": "GitHub"})
        self.assertNotIn("metadata", self.profile.social_links[1])
