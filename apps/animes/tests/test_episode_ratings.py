from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ...users.models import UserProfile
from ..models import Anime, EpisodeRating

User = get_user_model()


class EpisodeRatingApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="tester",
            email="tester@example.com",
            password="password123",
        )
        self.other_user = User.objects.create_user(
            username="other",
            email="other@example.com",
            password="password123",
        )
        UserProfile.objects.filter(user__in=[self.user, self.other_user]).update(email_verified=True)
        self.anime = Anime.objects.create(
            title="Test Anime",
            slug="test-anime",
            synopsis="Anime for episode ratings.",
            anime_type="TV",
            status="Finished",
            episode_count=3,
        )
        self.list_url = reverse("anime-episode-ratings", args=[self.anime.slug])
        self.detail_url = lambda episode_number: reverse(
            "anime-episode-rating", args=[self.anime.slug, episode_number]
        )

    def test_public_episode_rating_list_returns_aggregates(self):
        EpisodeRating.objects.create(
            user=self.user,
            anime=self.anime,
            episode_number=1,
            rating="4.5",
        )
        EpisodeRating.objects.create(
            user=self.other_user,
            anime=self.anime,
            episode_number=1,
            rating="3.5",
        )
        EpisodeRating.objects.create(
            user=self.other_user,
            anime=self.anime,
            episode_number=2,
            rating="5.0",
        )

        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            [
                {
                    "episode_number": 1,
                    "average_rating": "4.00",
                    "rating_count": 2,
                    "user_rating": None,
                },
                {
                    "episode_number": 2,
                    "average_rating": "5.00",
                    "rating_count": 1,
                    "user_rating": None,
                },
                {
                    "episode_number": 3,
                    "average_rating": None,
                    "rating_count": 0,
                    "user_rating": None,
                },
            ],
        )

    def test_authenticated_episode_rating_list_includes_private_user_rating(self):
        EpisodeRating.objects.create(
            user=self.user,
            anime=self.anime,
            episode_number=1,
            rating="4.5",
        )
        EpisodeRating.objects.create(
            user=self.other_user,
            anime=self.anime,
            episode_number=1,
            rating="3.5",
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]["average_rating"], "4.00")
        self.assertEqual(response.data[0]["rating_count"], 2)
        self.assertEqual(response.data[0]["user_rating"], "4.5")

    def test_authenticated_user_can_create_and_update_episode_rating(self):
        self.client.force_authenticate(user=self.user)

        create_response = self.client.put(self.detail_url(2), {"rating": "4.5"})
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(create_response.data["episode_number"], 2)
        self.assertEqual(create_response.data["average_rating"], "4.50")
        self.assertEqual(create_response.data["rating_count"], 1)
        self.assertEqual(create_response.data["user_rating"], "4.5")

        update_response = self.client.patch(self.detail_url(2), {"rating": "5.0"})
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["average_rating"], "5.00")
        self.assertEqual(update_response.data["user_rating"], "5.0")
        self.assertEqual(
            EpisodeRating.objects.get(
                user=self.user,
                anime=self.anime,
                episode_number=2,
            ).rating,
            5,
        )

    def test_delete_episode_rating_clears_private_value(self):
        EpisodeRating.objects.create(
            user=self.user,
            anime=self.anime,
            episode_number=2,
            rating="4.5",
        )
        EpisodeRating.objects.create(
            user=self.other_user,
            anime=self.anime,
            episode_number=2,
            rating="3.5",
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.delete(self.detail_url(2))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["average_rating"], "3.50")
        self.assertEqual(response.data["rating_count"], 1)
        self.assertIsNone(response.data["user_rating"])
        self.assertFalse(
            EpisodeRating.objects.filter(
                user=self.user,
                anime=self.anime,
                episode_number=2,
            ).exists()
        )

    def test_episode_rating_rejects_invalid_increment(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.put(self.detail_url(1), {"rating": "4.3"})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("rating", response.data["errors"])

    def test_episode_rating_rejects_episode_numbers_beyond_known_count(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.put(self.detail_url(4), {"rating": "4.5"})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data["errors"]["episode_number"],
            ["Episode number cannot exceed the known episode count (3)."],
        )

    def test_episode_rating_requires_authentication(self):
        response = self.client.put(self.detail_url(1), {"rating": "4.5"})

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_watch_episodes_endpoint_includes_episode_rating_fields(self):
        EpisodeRating.objects.create(
            user=self.user,
            anime=self.anime,
            episode_number=1,
            rating="4.5",
        )
        EpisodeRating.objects.create(
            user=self.other_user,
            anime=self.anime,
            episode_number=1,
            rating="3.5",
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(reverse("anime-watch-episodes", args=[self.anime.slug]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(response.data["results"][0]["number"], 1)
        self.assertEqual(response.data["results"][0]["average_rating"], "4.00")
        self.assertEqual(response.data["results"][0]["rating_count"], 2)
        self.assertEqual(response.data["results"][0]["user_rating"], "4.5")
        self.assertIsNone(response.data["results"][1]["average_rating"])
        self.assertEqual(response.data["results"][1]["rating_count"], 0)
