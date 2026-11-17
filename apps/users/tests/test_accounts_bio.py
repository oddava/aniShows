"""Bios keep only the classes the renderer understands (A11, P1-6)."""

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import UserProfile
from ..serializers.accounts import sanitize_bio

User = get_user_model()


class SanitizeBioTests(SimpleTestCase):
    def test_arbitrary_classes_are_dropped(self):
        cleaned = sanitize_bio('<div class="fixed inset-0 z-50">gotcha</div>')
        self.assertEqual(cleaned, "<div>gotcha</div>")

    def test_a_mix_of_allowed_and_unknown_classes_drops_the_attribute(self):
        self.assertNotIn("class", sanitize_bio('<span class="is-spoiler fixed">x</span>'))

    def test_spoiler_class_and_alignment_survive(self):
        self.assertEqual(
            sanitize_bio('<span class="is-spoiler">x</span>'), '<span class="is-spoiler">x</span>'
        )
        self.assertEqual(sanitize_bio('<p align="center">hi</p>'), '<p align="center">hi</p>')
        self.assertIn('data-align="left"', sanitize_bio('<img src="a.png" data-align="left">'))

    def test_other_global_attributes_stay_blocked(self):
        cleaned = sanitize_bio('<p style="position:fixed" onclick="x()" id="y">hi</p>')
        self.assertEqual(cleaned, "<p>hi</p>")

    def test_sanitizing_is_idempotent(self):
        for bio in (
            "a < b & c > d",
            "**bold** and `code` > quote",
            '<p align="right">x</p><script>alert(1)</script>',
            '<div class="fixed">y</div>',
        ):
            with self.subTest(bio=bio):
                once = sanitize_bio(bio)
                self.assertEqual(sanitize_bio(once), once)


class BioPatchTests(APITestCase):
    def test_patch_stores_the_bio_without_the_class(self):
        user = User.objects.create_user(username="bioed", email="b@example.com", password="x")
        self.client.force_authenticate(user)
        response = self.client.patch(
            reverse("user_profile"), {"bio": '<div class="fixed inset-0">x</div>'}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(UserProfile.objects.get(user=user).bio, "<div>x</div>")


class ResanitizeBiosCommandTests(TestCase):
    def setUp(self):
        self.dirty = User.objects.create_user(username="dirty", email="d@example.com", password="x")
        self.clean = User.objects.create_user(username="clean", email="c@example.com", password="x")
        UserProfile.objects.filter(user=self.dirty).update(
            bio='<div class="fixed inset-0 z-50">overlay</div>'
        )
        UserProfile.objects.filter(user=self.clean).update(bio="Just **markdown**.")

    def _run(self, *args):
        out = StringIO()
        call_command("resanitize_bios", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_counts_without_saving(self):
        self.assertIn("would change 1", self._run("--dry-run"))
        self.assertIn("class=", UserProfile.objects.get(user=self.dirty).bio or "")

    def test_run_cleans_only_what_changed_and_is_idempotent(self):
        self.assertIn("changed 1", self._run("--batch-size", "1"))
        self.assertEqual(UserProfile.objects.get(user=self.dirty).bio, "<div>overlay</div>")
        self.assertEqual(UserProfile.objects.get(user=self.clean).bio, "Just **markdown**.")
        self.assertIn("changed 0", self._run())
