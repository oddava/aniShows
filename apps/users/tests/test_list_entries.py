from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from ...animes.models import Anime, Genre
from ..models import UserAnimeList, UserProfile

User = get_user_model()


class ListEntryIntegrityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="lister", email="l@example.com", password="x")
        UserProfile.objects.filter(user=self.user).update(email_verified=True)
        self.client.force_authenticate(user=self.user)
        self.first = Anime.objects.create(title="First", slug="first", episode_count=12)
        self.second = Anime.objects.create(title="Second", slug="second", episode_count=12)

    def test_create_without_status_defaults_to_plan_to_watch(self):
        response = self.client.post("/api/v1/lists/", {"anime_id": self.first.id}, format="json")

        self.assertEqual(response.status_code, 201)
        entry = UserAnimeList.objects.get(user=self.user, anime=self.first)
        self.assertEqual(entry.status, UserAnimeList.UserAnimeStatus.plan_to_watch)

    def test_update_cannot_repoint_entry_to_another_anime(self):
        entry = UserAnimeList.objects.create(user=self.user, anime=self.first, status="Watching")
        UserAnimeList.objects.create(user=self.user, anime=self.second, status="Watching")

        response = self.client.patch(
            f"/api/v1/lists/{entry.id}/", {"anime_id": self.second.id, "score": 7}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual((entry.anime_id, entry.score), (self.first.id, 7))

    def test_cannot_edit_someone_elses_entry(self):
        other = User.objects.create_user(username="other", email="o@example.com", password="x")
        entry = UserAnimeList.objects.create(user=other, anime=self.first, status="Watching")

        response = self.client.patch(f"/api/v1/lists/{entry.id}/", {"score": 1}, format="json")

        self.assertIn(response.status_code, (403, 404))
        entry.refresh_from_db()
        self.assertEqual(entry.score, 0)


class FriendsWatchingPrivacyTests(APITestCase):
    def test_private_mutual_is_not_listed(self):
        from ..models import UserFollow, UserProfile

        me = User.objects.create_user(username="me1", email="me@example.com", password="x")
        friend = User.objects.create_user(username="friend", email="f@example.com", password="x")
        UserFollow.objects.create(follower=me, following=friend)
        UserFollow.objects.create(follower=friend, following=me)
        anime = Anime.objects.create(title="Shared", slug="shared", episode_count=12)
        UserAnimeList.objects.create(user=friend, anime=anime, status="Watching")
        self.client.force_authenticate(user=me)
        url = "/api/v1/follows/friends/watching/"

        self.assertEqual(len(self.client.get(url, {"anime_id": anime.id}).data), 1)

        UserProfile.objects.filter(user=friend).update(is_private=True)
        self.assertEqual(len(self.client.get(url, {"anime_id": anime.id}).data), 0)


class DottedUsernameRouteTests(APITestCase):
    def test_follow_routes_accept_dots_in_usernames(self):
        """The username validator allows '.', so the routes must too."""
        User.objects.create_user(username="john.doe", email="j@example.com", password="x")
        viewer = User.objects.create_user(username="viewer", email="v@example.com", password="x")
        self.client.force_authenticate(user=viewer)

        for route in ("followers", "following", "mutuals", "check"):
            with self.subTest(route=route):
                response = self.client.get(f"/api/v1/follows/{route}/john.doe/")
                self.assertEqual(response.status_code, 200)


# --------------------------------------------------------------------------- G3 P0-1/P0-8/P1-1

LISTS_URL = "/api/v1/lists/"
SUMMARY_URL = "/api/v1/lists/summary/"


def _verified_user(username):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="x"
    )
    UserProfile.objects.filter(user=user).update(email_verified=True)
    return user


class ListQueryTests(APITestCase):
    def setUp(self):
        self.user = _verified_user("pager")
        self.client.force_authenticate(user=self.user)

    def _bulk_watching(self, count):
        animes = Anime.objects.bulk_create(
            Anime(title=f"Show {i:03d}", slug=f"show-{i:03d}", episode_count=12)
            for i in range(count)
        )
        UserAnimeList.objects.bulk_create(
            UserAnimeList(user=self.user, anime=anime, status="Watching") for anime in animes
        )

    def test_all_entries_are_reachable_in_pages_with_the_real_count(self):
        self._bulk_watching(120)
        seen = []
        page = 1
        while True:
            response = self.client.get(
                LISTS_URL,
                {
                    "username": "pager",
                    "status": "Watching",
                    "page_size": 50,
                    "page": page,
                    "ordering": "title",
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["count"], 120)
            seen.extend(row["anime"]["title"] for row in response.data["results"])
            if not response.data["next"]:
                break
            page += 1

        self.assertEqual(page, 3)
        self.assertEqual(len(set(seen)), 120)

    def test_server_search_finds_an_entry_from_the_last_page(self):
        self._bulk_watching(120)

        response = self.client.get(
            LISTS_URL,
            {"username": "pager", "status": "Watching", "q": "show 115", "page_size": 50},
        )

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["anime"]["title"], "Show 115")

    def test_search_matches_the_japanese_title(self):
        anime = Anime.objects.create(title="Frieren", title_jp="Sousou no Frieren", slug="frieren")
        UserAnimeList.objects.create(user=self.user, anime=anime, status="Watching")

        response = self.client.get(LISTS_URL, {"q": "sousou"})

        self.assertEqual(response.data["count"], 1)

    def test_every_ordering(self):
        rows = [
            # title, total, watched, score, started, finished
            ("Alpha", 12, 6, 7, date(2024, 3, 1), date(2024, 4, 1)),
            ("Bravo", 10, 9, 9, date(2024, 1, 1), None),
            ("Charlie", 0, 3, 5, None, date(2024, 6, 1)),
        ]
        for title, total, watched, score, started, finished in rows:
            anime = Anime.objects.create(title=title, slug=title.lower(), episode_count=total)
            UserAnimeList.objects.create(
                user=self.user,
                anime=anime,
                status="Watching",
                episodes_watched=watched,
                score=score,
                started_at=started,
                finished_at=finished,
            )

        def titles(ordering):
            response = self.client.get(LISTS_URL, {"ordering": ordering})
            self.assertEqual(response.status_code, 200, ordering)
            return [row["anime"]["title"] for row in response.data["results"]]

        self.assertEqual(titles("-updated_at"), ["Charlie", "Bravo", "Alpha"])
        self.assertEqual(titles("title"), ["Alpha", "Bravo", "Charlie"])
        self.assertEqual(titles("-score"), ["Bravo", "Alpha", "Charlie"])
        self.assertEqual(titles("-progress"), ["Bravo", "Alpha", "Charlie"])  # unknown last
        self.assertEqual(titles("started_at"), ["Bravo", "Alpha", "Charlie"])  # no date last
        self.assertEqual(titles("-finished_at"), ["Charlie", "Alpha", "Bravo"])

    def test_invalid_status_and_ordering_are_400(self):
        self.assertEqual(self.client.get(LISTS_URL, {"status": "watching_now"}).status_code, 400)
        self.assertEqual(self.client.get(LISTS_URL, {"ordering": "-id"}).status_code, 400)

    def test_private_profile_list_is_empty_for_others(self):
        self._bulk_watching(3)
        UserProfile.objects.filter(user=self.user).update(is_private=True)
        self.client.force_authenticate(user=_verified_user("peeker"))

        response = self.client.get(LISTS_URL, {"username": "pager"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)

    def test_owner_still_sees_a_private_list(self):
        self._bulk_watching(3)
        UserProfile.objects.filter(user=self.user).update(is_private=True)

        self.assertEqual(self.client.get(LISTS_URL, {"username": "pager"}).data["count"], 3)

    def test_unknown_user_is_404(self):
        self.assertEqual(self.client.get(LISTS_URL, {"username": "nobody"}).status_code, 404)


class ListUpsertTests(APITestCase):
    def setUp(self):
        self.user = _verified_user("upserter")
        self.client.force_authenticate(user=self.user)
        self.anime = Anime.objects.create(title="Upsert", slug="upsert", episode_count=12)

    def test_post_creates_then_updates_one_row(self):
        first = self.client.post(
            LISTS_URL, {"anime_id": self.anime.id, "status": "Watching"}, format="json"
        )
        second = self.client.post(LISTS_URL, {"anime_id": self.anime.id, "score": 8}, format="json")

        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(UserAnimeList.objects.filter(user=self.user).count(), 1)
        self.assertEqual((second.data["status"], second.data["score"]), ("Watching", 8))

    def test_upsert_applies_the_transition_rules_against_the_existing_row(self):
        UserAnimeList.objects.create(
            user=self.user, anime=self.anime, status="Watching", episodes_watched=11
        )

        response = self.client.post(
            LISTS_URL, {"anime_id": self.anime.id, "episodes_watched": 12}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "Completed")
        self.assertIsNotNone(response.data["finished_at"])

    def test_snake_case_status_alias_is_accepted(self):
        response = self.client.post(
            LISTS_URL, {"anime_id": self.anime.id, "status": "plan_to_watch"}, format="json"
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "Plan to Watch")

    def test_finish_before_start_is_400(self):
        response = self.client.post(
            LISTS_URL,
            {"anime_id": self.anime.id, "started_at": "2025-05-02", "finished_at": "2025-05-01"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("finished_at", str(response.data))

    def test_database_constraint_violation_is_400_not_500(self):
        """If a bad combination ever slips past the rules, the CHECK constraint answers 400."""
        entry = UserAnimeList.objects.create(user=self.user, anime=self.anime, status="Watching")
        other = Anime.objects.create(title="Other", slug="other", episode_count=12)
        bad_dates = {"started_at": "2025-05-02", "finished_at": "2025-05-01"}

        def passthrough(instance, attrs, anime, today, strict=True):
            return dict(attrs)

        with patch("apps.users.serializers.lists.normalize_entry", passthrough):
            patched = self.client.patch(f"{LISTS_URL}{entry.id}/", bad_dates, format="json")
            created = self.client.post(
                LISTS_URL,
                {"anime_id": other.id, "status": "Watching", **bad_dates},
                format="json",
            )

        self.assertEqual((patched.status_code, created.status_code), (400, 400))
        entry.refresh_from_db()
        self.assertIsNone(entry.finished_at)
        self.assertFalse(UserAnimeList.objects.filter(user=self.user, anime=other).exists())

    def test_check_constraints_exist_in_the_database(self):
        cases = [
            {"score": 11},
            {"score": -1},
            {"episodes_watched": -1},
            {"total_rewatches": -1},
            {"started_at": date(2025, 5, 2), "finished_at": date(2025, 5, 1)},
        ]
        for fields in cases:
            with (
                self.subTest(case=repr(fields)),
                self.assertRaises(IntegrityError),
                transaction.atomic(),
            ):
                UserAnimeList.objects.create(
                    user=self.user, anime=self.anime, status="Watching", **fields
                )

    def test_notes_limit_is_400(self):
        response = self.client.post(
            LISTS_URL, {"anime_id": self.anime.id, "notes": "n" * 5001}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("notes", str(response.data))


class ListSummaryTests(APITestCase):
    def setUp(self):
        self.user = _verified_user("summarist")
        self.client.force_authenticate(user=self.user)
        self.action = Genre.objects.create(name="Action", slug="action")
        self.drama = Genre.objects.create(name="Drama", slug="drama")

    def _entry(self, title, *, status, episodes=0, score=0, duration=24, genres=()):
        anime = Anime.objects.create(
            title=title, slug=title.lower(), episode_count=24, duration_minutes=duration
        )
        anime.genres.set(genres)
        return UserAnimeList.objects.create(
            user=self.user, anime=anime, status=status, episodes_watched=episodes, score=score
        )

    def test_summary_shape_and_numbers(self):
        self._entry("A", status="Watching", episodes=2, score=8, genres=[self.action])
        self._entry(
            "B",
            status="Completed",
            episodes=24,
            score=6,
            duration=0,
            genres=[self.action, self.drama],
        )
        self._entry("C", status="Plan to Watch")

        data = self.client.get(SUMMARY_URL, {"username": "summarist"}).data

        self.assertEqual(
            data["counts"],
            {"Watching": 1, "Completed": 1, "On Hold": 0, "Dropped": 0, "Plan to Watch": 1},
        )
        self.assertEqual(data["total"], 3)
        self.assertEqual(data["episodes_watched"], 26)
        self.assertEqual(data["minutes"], 26 * 24)  # duration 0 counts as 24 minutes
        self.assertEqual(data["mean_score"], 7.0)
        self.assertEqual(data["score_histogram"]["8"], 1)
        self.assertEqual(data["score_histogram"]["6"], 1)
        self.assertEqual(sorted(data["score_histogram"], key=int), [str(n) for n in range(1, 11)])
        self.assertEqual(sum(data["score_histogram"].values()), 2)
        self.assertEqual(
            data["top_genres"],
            [
                {"name": "Action", "slug": "action", "count": 2},
                {"name": "Drama", "slug": "drama", "count": 1},
            ],
        )
        self.assertIsNotNone(data["updated_at"])

    def test_own_summary_without_username_and_anonymous_empty(self):
        self._entry("A", status="Watching")
        self.assertEqual(self.client.get(SUMMARY_URL).data["total"], 1)

        self.client.force_authenticate(user=None)
        empty = self.client.get(SUMMARY_URL).data
        self.assertEqual((empty["total"], empty["mean_score"], empty["top_genres"]), (0, None, []))

    def test_private_summary_is_empty_for_others_and_unknown_user_404(self):
        self._entry("A", status="Watching")
        UserProfile.objects.filter(user=self.user).update(is_private=True)
        self.client.force_authenticate(user=_verified_user("outsider"))

        self.assertEqual(self.client.get(SUMMARY_URL, {"username": "summarist"}).data["total"], 0)
        self.assertEqual(self.client.get(SUMMARY_URL, {"username": "ghost"}).status_code, 404)

    def test_summary_is_cached_and_dropped_on_list_change(self):
        entry = self._entry("A", status="Watching", episodes=1)
        self.client.get(SUMMARY_URL)  # cold

        with CaptureQueriesContext(connection) as warm:
            cached = self.client.get(SUMMARY_URL).data
        self.assertFalse(
            [q for q in warm.captured_queries if "users_useranimelist" in q["sql"]],
            "a warm summary must not aggregate again",
        )
        self.assertEqual(cached["episodes_watched"], 1)

        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f"{LISTS_URL}{entry.id}/", {"episodes_watched": 5}, format="json")

        self.assertEqual(self.client.get(SUMMARY_URL).data["episodes_watched"], 5)
