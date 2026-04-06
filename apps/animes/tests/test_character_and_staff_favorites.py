from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.animes.models import (
    Anime,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Staff,
    UserFavoriteCharacter,
    UserFavoriteStaff,
)
from apps.users.models import UserProfile

User = get_user_model()


class CharacterAndStaffFavoriteTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="tester",
            email="tester@example.com",
            password="password123",
        )
        self.other_user = User.objects.create_user(
            username="otheruser",
            email="other@example.com",
            password="password123",
        )
        self.private_user = User.objects.create_user(
            username="privateuser",
            email="private@example.com",
            password="password123",
        )

        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": True})
        UserProfile.objects.update_or_create(user=self.other_user, defaults={"email_verified": True})
        UserProfile.objects.update_or_create(
            user=self.private_user,
            defaults={"email_verified": True, "is_private": True},
        )
        self.user.refresh_from_db()
        self.other_user.refresh_from_db()
        self.private_user.refresh_from_db()

        self.character = Character.objects.create(name="Frieren", description="Mage")
        self.staff = Staff.objects.create(name="Atsumi Tanezaki", description="Voice actor")
        self.anime = Anime.objects.create(
            title="Frieren",
            slug="frieren",
            synopsis="Journey",
            anime_type="TV",
            status="Finished",
        )
        AnimeCharacter.objects.create(
            anime=self.anime,
            character=self.character,
            role=AnimeCharacter.Role.MAIN,
            voice_actor=self.staff,
        )
        AnimeStaff.objects.create(
            anime=self.anime,
            staff=self.staff,
            role="Series Composition",
        )

    def test_character_detail_includes_favorite_state(self):
        UserFavoriteCharacter.objects.create(user=self.user, character=self.character)
        UserFavoriteCharacter.objects.create(user=self.other_user, character=self.character)
        self.client.force_authenticate(user=self.user)

        response = self.client.get(reverse("characters-detail", args=[self.character.id]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["favorite_count"], 2)
        self.assertTrue(response.data["is_favorite"])
        self.assertEqual(len(response.data["anime_roles"]), 1)
        self.assertEqual(response.data["anime_roles"][0]["voice_actor"]["id"], self.staff.id)

    def test_staff_detail_includes_favorite_state(self):
        UserFavoriteStaff.objects.create(user=self.user, staff=self.staff)
        UserFavoriteStaff.objects.create(user=self.other_user, staff=self.staff)
        self.client.force_authenticate(user=self.user)

        response = self.client.get(reverse("staff-detail", args=[self.staff.id]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["favorite_count"], 2)
        self.assertTrue(response.data["is_favorite"])

    def test_toggle_character_favorite_returns_updated_count(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            reverse("character-favorites-toggle"),
            {"character_id": self.character.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_favorite"])
        self.assertEqual(response.data["favorite_count"], 1)

        response = self.client.post(
            reverse("character-favorites-toggle"),
            {"character_id": self.character.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["is_favorite"])
        self.assertEqual(response.data["favorite_count"], 0)

    def test_toggle_staff_favorite_returns_updated_count(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            reverse("staff-favorites-toggle"),
            {"staff_id": self.staff.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_favorite"])
        self.assertEqual(response.data["favorite_count"], 1)

    def test_private_user_character_favorites_are_hidden(self):
        UserFavoriteCharacter.objects.create(user=self.private_user, character=self.character)

        response = self.client.get(
            reverse("character-favorites-list"),
            {"username": self.private_user.username},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"], [])

    def test_private_user_staff_favorites_are_hidden(self):
        UserFavoriteStaff.objects.create(user=self.private_user, staff=self.staff)

        response = self.client.get(
            reverse("staff-favorites-list"),
            {"username": self.private_user.username},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"], [])
