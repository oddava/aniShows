"""Anime favorites API: toggle, reorder and the error envelope (spec 5 P0-7)."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ...users.models import UserProfile
from ..models import Anime, UserFavorite
from ..views.favorites import FavoriteWriteThrottle

User = get_user_model()


def _verified_user(username):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="password123"
    )
    UserProfile.objects.update_or_create(user=user, defaults={"email_verified": True})
    return user


def _animes(count, prefix="fav"):
    return [
        Anime.objects.create(title=f"{prefix} {index}", slug=f"{prefix}-{index}")
        for index in range(count)
    ]


class FavoriteToggleTests(APITestCase):
    def setUp(self):
        self.user = _verified_user("fan")
        self.anime = _animes(1)[0]
        self.client.force_authenticate(user=self.user)
        self.url = reverse("favorites-toggle")

    def test_toggle_adds_and_removes(self):
        added = self.client.post(self.url, {"anime_id": self.anime.id}, format="json")
        removed = self.client.post(self.url, {"anime_id": self.anime.id}, format="json")

        self.assertEqual(
            added.data,
            {"is_favorite": True, "favorite_count": 1, "message": "Added to favorites"},
        )
        self.assertEqual(
            removed.data,
            {"is_favorite": False, "favorite_count": 0, "message": "Removed from favorites"},
        )

    def test_new_favorites_go_first_without_renumbering(self):
        older = _animes(2, prefix="older")
        UserFavorite.objects.create(user=self.user, anime=older[0], order=3)
        UserFavorite.objects.create(user=self.user, anime=older[1], order=5)

        self.client.post(self.url, {"anime_id": self.anime.id}, format="json")

        self.assertEqual(UserFavorite.objects.get(user=self.user, anime=self.anime).order, 2)
        self.assertEqual(
            list(
                UserFavorite.objects.filter(user=self.user, anime__in=older).values_list(
                    "order", flat=True
                )
            ),
            [3, 5],
        )

    def test_first_favorite_gets_order_zero(self):
        self.client.post(self.url, {"anime_id": self.anime.id}, format="json")

        self.assertEqual(UserFavorite.objects.get(user=self.user).order, 0)

    def test_invalid_ids_are_rejected_with_the_envelope(self):
        for payload in (
            {"anime_id": "abc"},
            {"anime_id": 0},
            {"anime_id": -4},
            {},
            {"anime_id": 2**64},
        ):
            with self.subTest(payload=payload):
                response = self.client.post(self.url, payload, format="json")

                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(response.data["code"], "validation_error")
                self.assertIn("anime_id", response.data["errors"])

    def test_missing_anime_is_404_with_the_envelope(self):
        response = self.client.post(self.url, {"anime_id": self.anime.id + 1000}, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, {"detail": "Anime not found", "code": "not_found"})

    def test_toggle_is_throttled(self):
        with patch.object(FavoriteWriteThrottle, "rate", "2/minute", create=True):
            cache.clear()
            codes = [
                self.client.post(self.url, {"anime_id": self.anime.id}, format="json").status_code
                for _ in range(3)
            ]

        self.assertEqual(codes, [200, 200, 429])


class FavoriteSurfaceTests(APITestCase):
    def setUp(self):
        self.user = _verified_user("surface")
        self.anime = _animes(1)[0]
        self.client.force_authenticate(user=self.user)

    def test_create_and_update_are_not_allowed(self):
        favorite = UserFavorite.objects.create(user=self.user, anime=self.anime)
        detail = reverse("favorites-detail", args=[favorite.id])

        create = self.client.post(reverse("favorites-list"), {"anime_id": self.anime.id})
        patch_response = self.client.patch(detail, {"order": 4}, format="json")
        put = self.client.put(detail, {"order": 4}, format="json")

        self.assertEqual(create.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(create.data["code"], "method_not_allowed")
        self.assertEqual(patch_response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(put.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_delete_and_list_still_work(self):
        favorite = UserFavorite.objects.create(user=self.user, anime=self.anime)

        listed = self.client.get(reverse("favorites-list"))
        deleted = self.client.delete(reverse("favorites-detail", args=[favorite.id]))

        self.assertEqual([item["id"] for item in listed.data["results"]], [favorite.id])
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)


class FavoriteReorderTests(APITestCase):
    def setUp(self):
        self.user = _verified_user("sorter")
        self.client.force_authenticate(user=self.user)
        self.url = reverse("favorites-reorder")
        # Every row starts at order 0, as before min(order) - 1 existed.
        self.favorites = [
            UserFavorite.objects.create(user=self.user, anime=anime, order=0)
            for anime in _animes(25)
        ]

    def _orders(self):
        return list(
            UserFavorite.objects.filter(user=self.user)
            .order_by("order", "-added_at", "id")
            .values_list("id", "order")
        )

    def test_partial_reorder_yields_a_strict_total_order(self):
        before = [favorite_id for favorite_id, _ in self._orders()]
        moved = [self.favorites[index].id for index in (20, 3, 11, 0, 7)]

        response = self.client.post(self.url, {"ids": moved}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 25)
        rows = self._orders()
        self.assertEqual([order for _, order in rows], list(range(25)))
        self.assertEqual([favorite_id for favorite_id, _ in rows[:5]], moved)
        rest = [favorite_id for favorite_id in before if favorite_id not in moved]
        self.assertEqual([favorite_id for favorite_id, _ in rows[5:]], rest)

    def test_list_follows_the_saved_order(self):
        moved = [self.favorites[index].id for index in (9, 2)]
        self.client.post(self.url, {"ids": moved}, format="json")

        response = self.client.get(reverse("favorites-list"), {"page_size": 2})

        self.assertEqual([item["id"] for item in response.data["results"]], moved)

    def test_legacy_items_payload_is_sorted_by_order(self):
        items = [
            {"id": self.favorites[4].id, "order": 1},
            {"id": self.favorites[8].id, "order": 0},
        ]

        response = self.client.post(self.url, {"items": items}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        first_two = [favorite_id for favorite_id, _ in self._orders()[:2]]
        self.assertEqual(first_two, [self.favorites[8].id, self.favorites[4].id])

    def test_malformed_payloads_are_400(self):
        other = _verified_user("someone-else")
        foreign = UserFavorite.objects.create(user=other, anime=Anime.objects.first())
        payloads = [
            [1],
            {"ids": [{"id": "x"}]},
            {"items": [{"id": "x"}]},
            {"items": [1]},
            {"ids": "1,2"},
            {"ids": []},
            {"ids": ["x"]},
            {"ids": [0]},
            {"ids": list(range(1, 502))},
            {"ids": [self.favorites[0].id, self.favorites[0].id]},
            {"ids": [self.favorites[0].id, foreign.id]},
            {},
        ]
        before = self._orders()

        for payload in payloads:
            with self.subTest(payload=str(payload)[:60]):
                response = self.client.post(self.url, payload, format="json")

                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(set(response.data) - {"errors"}, {"detail", "code"})

        self.assertEqual(self._orders(), before)
        foreign.refresh_from_db()
        self.assertEqual(foreign.order, 0)
