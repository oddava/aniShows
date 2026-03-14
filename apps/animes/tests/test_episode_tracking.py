from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.animes.models import Anime
from apps.users.models import UserAnimeList

User = get_user_model()

class EpisodeTrackingTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser', email='test@example.com', password='password123')
        # Manually verify email
        self.user.userprofile.email_verified = True
        self.user.userprofile.save()
        self.client.force_authenticate(user=self.user)

        # Create anime with episodes
        self.anime = Anime.objects.create(
            title='Test Anime',
            slug='test-anime',
            episode_count=12,
            status='Finished'
        )

        # Create anime with 0 episodes (e.g. upcoming or unknown)
        self.anime_unknown = Anime.objects.create(
            title='Unknown Anime',
            slug='unknown-anime',
            episode_count=0,
            status='Upcoming'
        )

        self.url = reverse('lists-list')

    def test_add_anime_with_episodes(self):
        """Test adding anime with specific episodes watched."""
        data = {
            'anime_id': self.anime.id,
            'status': 'Watching',
            'episodes_watched': 5
        }
        response = self.client.post(self.url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['episodes_watched'], 5)
        # 5/12 = 41.66% -> 41%
        self.assertEqual(response.data['progress'], 41)

    def test_update_episodes_progress(self):
        """Test updating episodes updates progress."""
        user_list = UserAnimeList.objects.create(user=self.user, anime=self.anime, status='Watching', episodes_watched=0)
        url = reverse('lists-detail', args=[user_list.id])

        data = {'episodes_watched': 6}
        response = self.client.patch(url, data)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['episodes_watched'], 6)
        self.assertEqual(response.data['progress'], 50)

    def test_auto_complete(self):
        """Test status automatically changes to Completed when all episodes watched."""
        user_list = UserAnimeList.objects.create(user=self.user, anime=self.anime, status='Watching', episodes_watched=11)
        url = reverse('lists-detail', args=[user_list.id])

        data = {'episodes_watched': 12}
        response = self.client.patch(url, data)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'Completed')

    def test_status_completed_autofill(self):
        """Test that setting status to Completed automatically fills episodes."""
        data = {
            'anime_id': self.anime.id,
            'status': 'Completed'
        }
        response = self.client.post(self.url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], 'Completed')
        self.assertEqual(response.data['episodes_watched'], self.anime.episode_count)

    def test_cannot_exceed_total(self):
        """Test validation error when exceeding total episodes."""
        data = {
            'anime_id': self.anime.id,
            'status': 'Watching',
            'episodes_watched': 13
        }
        response = self.client.post(self.url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('episodes_watched', response.data)

    def test_cannot_set_negative_episodes(self):
        """Negative episode counts should be rejected."""
        data = {
            'anime_id': self.anime.id,
            'status': 'Watching',
            'episodes_watched': -1
        }
        response = self.client.post(self.url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('episodes_watched', response.data)

    def test_unknown_episode_count(self):
        """Test behavior with 0/unknown total episodes."""
        data = {
            'anime_id': self.anime_unknown.id,
            'status': 'Watching',
            'episodes_watched': 5
        }
        response = self.client.post(self.url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['episodes_watched'], 5)
        self.assertEqual(response.data['progress'], 0)
