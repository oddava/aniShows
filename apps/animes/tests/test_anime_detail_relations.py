from unittest.mock import patch

from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from ..models import Anime, AnimeCharacter, AnimeStaff, Character, Staff


class AnimeDetailRelationPaginationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.enrich_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.enrich_patcher.start()
        self.addCleanup(self.enrich_patcher.stop)

        self.anime = Anime.objects.create(
            title="Long Runner",
            slug="long-runner",
            synopsis="A very long anime.",
            anime_type="TV",
            status="Finished",
        )

    def test_characters_endpoint_returns_paginated_results(self):
        voice_actor = Staff.objects.create(name="Voice Actor")
        for index in range(1, 56):
            character = Character.objects.create(name=f"Character {index:02d}")
            AnimeCharacter.objects.create(
                anime=self.anime,
                character=character,
                role=AnimeCharacter.Role.SUPPORTING,
                voice_actor=voice_actor,
            )

        response = self.client.get(
            reverse("anime-characters", args=[self.anime.slug]),
            {"page": 2, "page_size": 20},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 55)
        self.assertEqual(len(response.data["results"]), 20)
        self.assertEqual(response.data["results"][0]["character"]["name"], "Character 21")
        self.assertIsNotNone(response.data["next"])
        self.assertIsNotNone(response.data["previous"])

    def test_staff_endpoint_returns_paginated_results(self):
        for index in range(1, 56):
            staff = Staff.objects.create(name=f"Staff {index:02d}")
            AnimeStaff.objects.create(
                anime=self.anime,
                staff=staff,
                role=f"Role {index:02d}",
            )

        response = self.client.get(
            reverse("anime-staff", args=[self.anime.slug]),
            {"page": 3, "page_size": 20},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 55)
        self.assertEqual(len(response.data["results"]), 15)
        self.assertEqual(response.data["results"][0]["staff"]["name"], "Staff 41")
        self.assertIsNone(response.data["next"])
        self.assertIsNotNone(response.data["previous"])

    def test_detail_payload_includes_relation_totals(self):
        voice_actor = Staff.objects.create(name="Voice Actor")
        for index in range(1, 4):
            character = Character.objects.create(name=f"Character {index:02d}")
            AnimeCharacter.objects.create(
                anime=self.anime,
                character=character,
                role=AnimeCharacter.Role.SUPPORTING,
                voice_actor=voice_actor,
            )

        for index in range(1, 3):
            staff = Staff.objects.create(name=f"Staff {index:02d}")
            AnimeStaff.objects.create(
                anime=self.anime,
                staff=staff,
                role=f"Role {index:02d}",
            )

        response = self.client.get(reverse("anime-detail", args=[self.anime.slug]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["character_count"], 3)
        self.assertEqual(response.data["staff_count"], 2)
