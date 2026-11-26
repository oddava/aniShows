"""Syncs keep writing the SEO description until an admin takes it over."""

from django.test import SimpleTestCase, TestCase

from ...admin_api.tests.helpers import bearer_client, make_user
from ..models import Anime
from ..services.provider_base import merge_for_update


class MetaDescriptionMergeTests(SimpleTestCase):
    def test_a_placeholder_is_replaced_by_the_synopsis(self):
        # Offline imports start with the title; the next sync must replace it.
        anime = Anime(title="Frieren", meta_description="Frieren")
        merged = merge_for_update(anime, {"meta_description": "An elf mage outlives her party..."})
        self.assertEqual(merged["meta_description"], "An elf mage outlives her party...")

    def test_an_admin_locked_description_survives_a_sync(self):
        anime = Anime(title="Frieren", meta_description="Written by an admin.")
        anime.meta_description_locked = True
        merged = merge_for_update(
            anime, {"meta_description": "From the new synopsis...", "title": "Frieren"}
        )
        self.assertNotIn("meta_description", merged)
        self.assertEqual(merged["title"], "Frieren")


class MetaDescriptionAdminEditTests(TestCase):
    def setUp(self):
        self.client = bearer_client(make_user("seo-root", role="superuser"))
        self.anime = Anime.objects.create(title="Frieren", synopsis="x", meta_description="Frieren")

    def _patch(self, text):
        return self.client.patch(
            f"/api/v1/admin/anime/{self.anime.pk}/", {"meta_description": text}, format="json"
        )

    def test_writing_locks_it_and_clearing_hands_it_back(self):
        response = self._patch("  A quiet fantasy about time.  ")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["meta_description_locked"])
        self.anime.refresh_from_db()
        self.assertEqual(
            (self.anime.meta_description, self.anime.meta_description_locked),
            ("A quiet fantasy about time.", True),
        )
        self.assertEqual(self._patch("").status_code, 200)
        self.anime.refresh_from_db()
        self.assertFalse(self.anime.meta_description_locked)
