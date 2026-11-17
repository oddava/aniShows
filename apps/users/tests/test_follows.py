"""Follows (G5 P0-6, P0-8, P1-9): counts, self-follow guard, throttle, friends watching, search."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from ...animes.models import Anime
from ..middleware.activity_middleware import activity_throttle_key
from ..models import UserAnimeList, UserFollow, UserProfile
from ..views.follows import FollowToggleRateThrottle

User = get_user_model()

TOGGLE_URL = "/api/v1/follows/toggle/"
WATCHING_URL = "/api/v1/follows/friends/watching/"


def make_user(username: str, *, private: bool = False):
    user = User.objects.create_user(username, f"{username}@example.com", "pw-123456")
    UserProfile.objects.filter(user=user).update(email_verified=True, is_private=private)
    return User.objects.select_related("userprofile").get(pk=user.pk)


class FollowToggleTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = make_user("me")
        self.client.force_authenticate(self.me)

    def test_counts_are_not_multiplied(self):
        """I follow 3 and am followed by 2; the target is followed by 2 others."""
        target = make_user("target")
        others = [make_user(f"o{i}") for i in range(4)]
        for other in others[:2]:
            UserFollow.objects.create(follower=self.me, following=other)
            UserFollow.objects.create(follower=other, following=self.me)
            UserFollow.objects.create(follower=other, following=target)
        UserFollow.objects.create(follower=target, following=others[3])

        response = self.client.post(TOGGLE_URL, {"username": "target"}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "followed")
        self.assertEqual(
            response.data["followers_count"], UserFollow.objects.filter(following=target).count()
        )
        self.assertEqual(response.data["followers_count"], 3)
        self.assertEqual(
            response.data["following_count"], UserFollow.objects.filter(follower=self.me).count()
        )
        self.assertEqual(response.data["following_count"], 3)

        response = self.client.post(TOGGLE_URL, {"username": "target"}, format="json")
        self.assertEqual(
            (response.data["followers_count"], response.data["following_count"]), (2, 2)
        )

    def test_self_follow_is_a_400_envelope(self):
        response = self.client.post(TOGGLE_URL, {"username": "me"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "cannot_follow_self")
        self.assertFalse(UserFollow.objects.exists())

    def test_self_follow_row_violates_the_constraint(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            UserFollow.objects.create(follower=self.me, following=self.me)

    def test_toggle_is_throttled(self):
        make_user("target")
        with patch.object(FollowToggleRateThrottle, "rate", "2/minute", create=True):
            statuses = [
                self.client.post(TOGGLE_URL, {"username": "target"}, format="json").status_code
                for _ in range(3)
            ]
        self.assertEqual(statuses, [201, 200, 429])


class FriendsWatchingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = make_user("me")
        self.anime = Anime.objects.create(title="Shared", slug="shared", episode_count=12)
        self.client.force_authenticate(self.me)

    def _mutual(self, user):
        UserFollow.objects.create(follower=self.me, following=user)
        UserFollow.objects.create(follower=user, following=self.me)

    def _watching(self, user):
        UserAnimeList.objects.create(user=user, anime=self.anime, status="Watching")

    def _get(self):
        cache.add(activity_throttle_key(self.me.id), True)
        return self.client.get(WATCHING_URL, {"anime_id": self.anime.id})

    def test_only_visible_mutuals_are_listed(self):
        friend, private_friend, i_follow, follows_me = (
            make_user("friend"),
            make_user("hidden", private=True),
            make_user("ifollow"),
            make_user("followsme"),
        )
        self._mutual(friend)
        self._mutual(private_friend)
        UserFollow.objects.create(follower=self.me, following=i_follow)
        UserFollow.objects.create(follower=follows_me, following=self.me)
        for user in (friend, private_friend, i_follow, follows_me):
            self._watching(user)

        response = self._get()

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["user"]["username"] for row in response.data], ["friend"])
        self.assertEqual(response["X-Total-Count"], "1")

    def test_total_counts_past_the_cap_in_few_queries(self):
        for i in range(52):
            friend = make_user(f"f{i}")
            self._mutual(friend)
            self._watching(friend)

        with CaptureQueriesContext(connection) as queries:
            response = self._get()

        self.assertEqual(len(response.data), 50)
        self.assertEqual(response["X-Total-Count"], "52")
        self.assertLessEqual(len(queries), 4)

    def test_nobody_watching(self):
        response = self._get()
        self.assertEqual(response.data, [])
        self.assertEqual(response["X-Total-Count"], "0")

    def test_bad_anime_id_is_400(self):
        response = self.client.get(WATCHING_URL, {"anime_id": "abc"})
        self.assertEqual(response.status_code, 400)


class FollowListSearchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = make_user("owner")
        for name in ("alice", "alfred", "bob"):
            user = make_user(name)
            UserFollow.objects.create(follower=user, following=self.owner)
            UserFollow.objects.create(follower=self.owner, following=user)

    def _usernames(self, route: str, search: str) -> list[str]:
        response = self.client.get(f"/api/v1/follows/{route}/owner/", {"search": search})
        self.assertEqual(response.status_code, 200)
        return sorted(row["user"]["username"] for row in response.data["results"])

    def test_search_filters_each_list(self):
        for route in ("followers", "following", "mutuals"):
            with self.subTest(route=route):
                self.assertEqual(self._usernames(route, "AL"), ["alfred", "alice"])
                self.assertEqual(self._usernames(route, "bo"), ["bob"])

    def test_one_letter_search_is_ignored(self):
        self.assertEqual(self._usernames("followers", "a"), ["alfred", "alice", "bob"])

    def test_private_lists_stay_403(self):
        UserProfile.objects.filter(user=self.owner).update(is_private=True)
        response = self.client.get("/api/v1/follows/followers/owner/")
        self.assertEqual(response.status_code, 403)


class SelfFollowMigrationTests(TransactionTestCase):
    """0042 deletes existing self-follows, then adds the constraint; it reverses cleanly."""

    before = [("users", "0037_customuser_email_ci_unique")]
    after = [("users", "0042_community_follow_no_self")]

    def tearDown(self):
        MigrationExecutor(connection).migrate(
            MigrationExecutor(connection).loader.graph.leaf_nodes()
        )

    def test_forward_and_backward(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        old_apps = executor.loader.project_state(self.before).apps
        OldUser = old_apps.get_model("users", "CustomUser")
        OldFollow = old_apps.get_model("users", "UserFollow")
        loner = OldUser.objects.create(username="loner", email="loner@example.com")
        other = OldUser.objects.create(username="other", email="other@example.com")
        OldFollow.objects.create(follower=loner, following=loner)
        OldFollow.objects.create(follower=loner, following=other)

        executor = MigrationExecutor(connection)
        executor.migrate(self.after)
        new_follow = executor.loader.project_state(self.after).apps.get_model("users", "UserFollow")
        self.assertEqual(
            list(new_follow.objects.values_list("following__username", flat=True)), ["other"]
        )

        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        OldFollow.objects.create(follower=other, following=other)
        self.assertEqual(OldFollow.objects.count(), 2)
