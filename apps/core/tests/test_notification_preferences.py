import importlib

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from ..models import NotificationPreference
from ..services import notification_preferences as prefs

User = get_user_model()
migration_0011 = importlib.import_module("apps.core.migrations.0011_notifications_preferences")


class PreferenceServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("prefs", "p@example.com", "pw-123456")

    def test_missing_row_means_defaults(self):
        self.assertEqual(prefs.get_preferences(self.user.pk), prefs.defaults())
        self.assertFalse(prefs.defaults()["likes"]["push"])

    @override_settings(NEW_USER_EMAIL_EPISODES=False)
    def test_new_user_email_default_is_a_setting(self):
        self.assertFalse(prefs.defaults()["episodes"]["email"])

    def test_normalize_drops_unknown_keys_and_merges_defaults(self):
        stored = {
            "episodes": {"push": False, "sms": True},
            "nope": {"in_app": False},
            "likes": "garbage",
            "account": {"in_app": False},
        }
        result = prefs.normalize(stored)
        self.assertFalse(result["episodes"]["push"])
        self.assertNotIn("sms", result["episodes"])
        self.assertNotIn("nope", result)
        self.assertEqual(result["likes"], prefs.defaults()["likes"])
        self.assertTrue(result["account"]["in_app"])  # locked

    def test_partial_update_keeps_other_keys(self):
        prefs.update_preferences(self.user.pk, {"replies": {"push": False}})
        prefs.update_preferences(self.user.pk, {"likes": {"push": True}})
        stored = prefs.get_preferences(self.user.pk)
        self.assertFalse(stored["replies"]["push"])
        self.assertTrue(stored["likes"]["push"])

    def test_replace_starts_from_defaults(self):
        prefs.update_preferences(self.user.pk, {"replies": {"push": False}})
        result = prefs.update_preferences(self.user.pk, {"likes": {"push": True}}, replace=True)
        self.assertTrue(result["replies"]["push"])

    def test_invalid_updates_raise(self):
        for update in (
            {"nope": {"push": True}},
            {"replies": {"email": True}},
            {"replies": {"push": "yes"}},
            {"account": {"in_app": False}},
            ["not", "an", "object"],
        ):
            with self.subTest(update=update), self.assertRaises(prefs.PreferenceError):
                prefs.apply_update(prefs.defaults(), update)

    def test_preferences_for_runs_one_query(self):
        other = User.objects.create_user("other", "o@example.com", "pw-123456")
        prefs.update_preferences(other.pk, {"follows": {"push": False}})
        with self.assertNumQueries(1):
            result = prefs.preferences_for([self.user.pk, other.pk])
        self.assertTrue(result[self.user.pk]["follows"]["push"])
        self.assertFalse(result[other.pk]["follows"]["push"])


class LegacyMigrationMappingTests(TestCase):
    def test_mapping_copies_the_four_flags(self):
        mapped = migration_0011.legacy_to_preferences(False, True, False, True)
        self.assertEqual(
            mapped,
            {
                "episodes": {"in_app": True, "push": True, "email": False},
                "replies": {"in_app": True, "push": False},
                "likes": {"in_app": True, "push": False},
                "follows": {"in_app": True, "push": True},
                "account": {"in_app": True, "push": True},
            },
        )

    def test_copy_creates_one_row_per_profile_and_is_rerunnable(self):
        from django.apps import apps

        user = User.objects.create_user("legacy", "l@example.com", "pw-123456")
        profile = user.userprofile
        profile.email_new_episodes = False
        profile.push_new_follower = False
        profile.save(update_fields=["email_new_episodes", "push_new_follower"])

        migration_0011.copy_legacy_flags(apps, None)
        migration_0011.copy_legacy_flags(apps, None)

        row = NotificationPreference.objects.get(user=user)
        self.assertFalse(row.preferences["episodes"]["email"])
        self.assertFalse(row.preferences["follows"]["push"])
        self.assertEqual(NotificationPreference.objects.filter(user=user).count(), 1)


class PreferenceApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("api", "api@example.com", "pw-123456")
        self.client.force_authenticate(self.user)
        self.url = reverse("notification_preferences")

    def test_get_returns_preferences_and_schema(self):
        body = self.client.get(self.url).json()
        self.assertEqual(body["preferences"], prefs.defaults())
        categories = {c["key"]: c for c in body["schema"]["categories"]}
        self.assertEqual(categories["episodes"]["channels"], ["in_app", "push", "email"])
        self.assertEqual(categories["account"]["locked"], ["in_app"])

    def test_patch_is_partial(self):
        response = self.client.patch(self.url, {"replies": {"push": False}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["preferences"]["replies"]["push"])
        self.assertTrue(response.json()["preferences"]["follows"]["push"])

    def test_put_replaces(self):
        self.client.patch(self.url, {"replies": {"push": False}}, format="json")
        body = self.client.put(self.url, {"likes": {"push": True}}, format="json").json()
        self.assertTrue(body["preferences"]["replies"]["push"])
        self.assertTrue(body["preferences"]["likes"]["push"])

    def test_bad_updates_are_400(self):
        for payload in ({"nope": {"push": True}}, {"account": {"in_app": False}}):
            with self.subTest(payload=payload):
                response = self.client.patch(self.url, payload, format="json")
                self.assertEqual(response.status_code, 400)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))
