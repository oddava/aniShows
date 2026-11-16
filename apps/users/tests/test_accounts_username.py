"""Usernames are unique and looked up ignoring case (A13)."""

from typing import Any
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.http import Http404
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.test import APITestCase

from ..adapters import unique_oauth_username
from ..services.cache import get_public_profile_cache_key, invalidate_user_caches
from ..services.profile_update_service import update_user_profile
from ..services.profile_visibility import get_visible_user_or_404

User = get_user_model()

# Any-valued so mypy does not map it onto APIClient.post(follow: bool).
XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class UsernameConstraintTests(TestCase):
    def test_case_variants_cannot_coexist(self):
        User.objects.create_user(username="Bob", email="bob1@example.com", password="x")
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(username="bob", email="bob2@example.com", password="x")


class CaseInsensitiveLookupTests(APITestCase):
    def setUp(self):
        self.bob = User.objects.create_user(
            username="Bob", email="bob@example.com", password="securepass123"
        )

    def test_public_profile_resolves_any_case_to_the_canonical_name(self):
        for path_name in ("Bob", "bob", "BOB"):
            with self.subTest(path_name=path_name):
                response = self.client.get(f"/api/v1/users/{path_name}/")
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(response.data["username"], "Bob")

    def test_visibility_helper_ignores_case(self):
        self.assertEqual(get_visible_user_or_404("bOB", None), self.bob)
        with self.assertRaises(Http404):
            get_visible_user_or_404("nobody", None)

    def test_share_preview_ignores_case_and_links_the_canonical_name(self):
        response = self.client.get("/u/BOB", HTTP_USER_AGENT="Discordbot/2.0")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Bob on AniShows", response.content)

    def test_login_ignores_case(self):
        response = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "BOB", "password": "securepass123"},
            format="json",
            **XHR,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_register_refuses_a_case_variant(self):
        response = self.client.post(
            reverse("register"),
            {"username": "bob", "email": "other@example.com", "password": "N3w-Passphrase!"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(User.objects.count(), 1)

    def test_rename_refuses_a_case_variant_of_another_user(self):
        other = User.objects.create_user(username="carol", email="c@example.com", password="x")
        with self.assertRaises(DRFValidationError) as ctx:
            update_user_profile(other, {"username": "BOB"})
        self.assertIn("already taken", str(ctx.exception.detail))

    def test_cache_keys_are_lowercase(self):
        self.assertEqual(
            get_public_profile_cache_key("Bob", "anonymous"),
            get_public_profile_cache_key("bob", "anonymous"),
        )
        before = get_public_profile_cache_key("bob")
        invalidate_user_caches(self.bob.id, "BOB", trigger_stats_update=False)
        self.assertNotEqual(get_public_profile_cache_key("Bob"), before)


class OAuthUsernameTests(TestCase):
    def test_free_valid_name_is_kept(self):
        self.assertEqual(unique_oauth_username("newperson"), "newperson")

    @patch("apps.users.adapters._random_suffix", side_effect=["abcd", "ef01"])
    def test_case_variant_gets_a_suffix(self, _suffix):
        User.objects.create_user(username="Bob", email="b@example.com", password="x")
        User.objects.create_user(username="bob_abcd", email="b2@example.com", password="x")
        self.assertEqual(unique_oauth_username("bob"), "bob_ef01")

    @patch("apps.users.adapters._random_suffix", return_value="9f9f")
    def test_reserved_or_invalid_names_fall_back(self, _suffix):
        self.assertEqual(unique_oauth_username("me"), "user9f9f")
        self.assertEqual(unique_oauth_username("bad name!"), "user9f9f")

    @patch("apps.users.adapters.username_length_limits", return_value=(3, 10))
    @patch("apps.users.adapters._random_suffix", return_value="0000")
    def test_suffix_respects_the_length_limit(self, _suffix, _limits):
        User.objects.create_user(username="abcdefghij", email="l@example.com", password="x")
        result = unique_oauth_username("abcdefghij")
        self.assertEqual(result, "abcde_0000")
        self.assertLessEqual(len(result), 10)


class DuplicateUsernameMigrationTests(TransactionTestCase):
    before = [("users", "0037_customuser_email_ci_unique")]
    after = [("users", "0038_accounts_username_ci_unique")]

    def tearDown(self):
        # Migrate to the leaf first, then delete (see test_email_uniqueness).
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        User.objects.all().delete()

    def test_migration_stops_with_instructions_when_duplicates_exist(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        old_user = executor.loader.project_state(self.before).apps.get_model("users", "CustomUser")
        old_user.objects.create(username="alice", email="a1@example.com")
        old_user.objects.create(username="ALICE", email="a2@example.com")

        executor = MigrationExecutor(connection)
        with self.assertRaisesMessage(RuntimeError, "alice: "):
            executor.migrate(self.after)

        old_user.objects.filter(username="ALICE").update(username="alice2")
        MigrationExecutor(connection).migrate(self.after)


class OAuthPopulateUserTests(TestCase):
    """Google sends no username; populate_user must still apply G1's rules."""

    def _populate(self, data):
        from allauth.socialaccount.models import SocialAccount, SocialLogin

        from ..adapters import MySocialAccountAdapter

        sociallogin = SocialLogin(user=User(), account=SocialAccount(provider="google"))
        return MySocialAccountAdapter().populate_user(None, sociallogin, data)

    def test_name_comes_from_the_first_name_never_the_email(self):
        user = self._populate({"email": "mary.secret@example.com", "first_name": "Mary Jane"})
        self.assertEqual(user.username, "MaryJane")
        self.assertNotIn("secret", user.username)

    def test_taken_name_ignoring_case_gets_a_suffix(self):
        User.objects.create_user(username="Mary", email="m@example.com", password="x")
        user = self._populate({"email": "x@example.com", "first_name": "mary"})
        self.assertTrue(user.username.startswith("mary_"))

    @patch("apps.users.adapters._random_suffix", return_value="beef")
    def test_nothing_usable_falls_back(self, _suffix):
        self.assertEqual(self._populate({"email": "me@example.com"}).username, "userbeef")


class OAuthNameCharactersTests(TestCase):
    def test_at_sign_is_dropped_so_the_username_stays_usable_at_sign_in(self):
        from ..adapters import _name_candidate

        self.assertEqual(_name_candidate("ann@home"), "annhome")
        self.assertIsNone(_name_candidate("@@@"))


class RenameNormalisationTests(TestCase):
    def test_rename_to_a_fullwidth_lookalike_is_refused(self):
        User.objects.create_user(username="bob", email="b@example.com", password="x")
        other = User.objects.create_user(username="carl", email="c@example.com", password="x")
        fullwidth_bob = "".join(chr(0xFEE0 + ord(char)) for char in "bob")
        with self.assertRaises(DRFValidationError):
            update_user_profile(other, {"username": fullwidth_bob})
