"""
Anime List API Tests

Tests for:
- Adding anime to list
- Updating list entries
- Removing from list
- Permission checks (can't modify others' lists)
- Privacy checks (can't see private users' lists)
"""
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient
from rest_framework import status
from django.contrib.auth import get_user_model
from apps.animes.models import Anime, Genre, Studio
from apps.users.models import UserProfile, UserAnimeList

User = get_user_model()


class AnimeListTests(APITestCase):
    """Tests for user anime list management."""
    
    def setUp(self):
        # Create users
        self.user1 = User.objects.create_user(
            username='user1',
            email='user1@example.com',
            password='password123'
        )
        self.user2 = User.objects.create_user(
            username='user2',
            email='user2@example.com',
            password='password123'
        )
        UserProfile.objects.update_or_create(user=self.user1, defaults={'email_verified': True})
        UserProfile.objects.update_or_create(user=self.user2, defaults={'email_verified': True})
        self.user1.refresh_from_db()
        self.user2.refresh_from_db()
        
        # Create test anime
        self.anime = Anime.objects.create(
            title='Test Anime',
            slug='test-anime',
            synopsis='A test anime synopsis',
            anime_type='TV',
            status='Airing'
        )
        
        self.list_url = reverse('lists-list')
        self.client = APIClient()
    
    def test_add_anime_to_list(self):
        """Test adding anime to user's list."""
        self.client.force_authenticate(user=self.user1)
        data = {
            'anime_id': self.anime.id,
            'status': 'Watching'
        }
        response = self.client.post(self.list_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            UserAnimeList.objects.filter(user=self.user1, anime=self.anime).exists()
        )
    
    def test_add_anime_unauthenticated(self):
        """Test adding anime fails when not authenticated."""
        data = {
            'anime_id': self.anime.id,
            'status': 'Watching'
        }
        response = self.client.post(self.list_url, data)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
    
    def test_update_own_list_entry(self):
        """Test updating own anime list entry."""
        self.client.force_authenticate(user=self.user1)
        
        # First add to list
        entry = UserAnimeList.objects.create(
            user=self.user1,
            anime=self.anime,
            status='Watching',
            episodes_watched=5
        )
        
        # Update the entry
        detail_url = reverse('lists-detail', args=[entry.id])
        data = {'status': 'Completed', 'episodes_watched': 12, 'score': 8}
        response = self.client.patch(detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        entry.refresh_from_db()
        self.assertEqual(entry.status, 'Completed')
        self.assertEqual(entry.episodes_watched, 12)
        self.assertEqual(entry.score, 8)
    
    def test_cannot_update_others_list_entry(self):
        """Test that users cannot update other users' list entries."""
        # User2's entry
        entry = UserAnimeList.objects.create(
            user=self.user2,
            anime=self.anime,
            status='Watching'
        )
        
        # User1 tries to update it
        self.client.force_authenticate(user=self.user1)
        detail_url = reverse('lists-detail', args=[entry.id])
        data = {'status': 'Dropped'}
        response = self.client.patch(detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
    
    def test_delete_own_list_entry(self):
        """Test deleting own anime list entry."""
        self.client.force_authenticate(user=self.user1)
        
        entry = UserAnimeList.objects.create(
            user=self.user1,
            anime=self.anime,
            status='Watching'
        )
        
        detail_url = reverse('lists-detail', args=[entry.id])
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(UserAnimeList.objects.filter(id=entry.id).exists())
    
    def test_cannot_delete_others_list_entry(self):
        """Test that users cannot delete other users' list entries."""
        entry = UserAnimeList.objects.create(
            user=self.user2,
            anime=self.anime,
            status='Watching'
        )
        
        self.client.force_authenticate(user=self.user1)
        detail_url = reverse('lists-detail', args=[entry.id])
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(UserAnimeList.objects.filter(id=entry.id).exists())
    
    def test_view_own_list(self):
        """Test viewing own anime list."""
        self.client.force_authenticate(user=self.user1)
        
        UserAnimeList.objects.create(
            user=self.user1,
            anime=self.anime,
            status='Watching'
        )
        
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should see own entries
        self.assertGreaterEqual(len(response.data.get('results', response.data)), 1)


class PrivacyTests(APITestCase):
    """Tests for privacy settings on anime lists."""
    
    def setUp(self):
        self.user1 = User.objects.create_user(
            username='publicuser',
            email='public@example.com',
            password='password123'
        )
        self.user2 = User.objects.create_user(
            username='privateuser',
            email='private@example.com',
            password='password123'
        )
        UserProfile.objects.update_or_create(user=self.user1, defaults={'is_private': False})
        UserProfile.objects.update_or_create(user=self.user2, defaults={'is_private': True})
        
        self.anime = Anime.objects.create(
            title='Test Anime',
            slug='test-anime',
            synopsis='A test anime synopsis',
            anime_type='TV',
            status='Airing'
        )
        
        # Both users have entries
        UserAnimeList.objects.create(user=self.user1, anime=self.anime, status='Watching')
        UserAnimeList.objects.create(user=self.user2, anime=self.anime, status='Completed')
        
        self.list_url = reverse('lists-list')
        self.client = APIClient()
    
    def test_can_view_public_users_list(self):
        """Test that public users' lists are visible."""
        response = self.client.get(f"{self.list_url}?username=publicuser")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get('results', response.data)
        self.assertGreaterEqual(len(results), 1)
    
    def test_cannot_view_private_users_list(self):
        """Test that private users' lists are hidden."""
        response = self.client.get(f"{self.list_url}?username=privateuser")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get('results', response.data)
        # Should be empty for private user
        self.assertEqual(len(results), 0)


class DuplicateEntryTests(APITestCase):
    """Tests for duplicate entry prevention."""
    
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='password123'
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={'email_verified': True})

        self.anime = Anime.objects.create(
            title='Test Anime',
            slug='test-anime',
            synopsis='A test anime synopsis',
            anime_type='TV',
            status='Airing'
        )
        
        self.list_url = reverse('lists-list')
        self.client = APIClient()
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)

    def test_cannot_add_duplicate_entry(self):
        """Test that adding the same anime twice fails."""
        # First add
        data = {'anime_id': self.anime.id, 'status': 'Watching'}
        response1 = self.client.post(self.list_url, data)
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)
        
        # Try to add again
        data2 = {'anime_id': self.anime.id, 'status': 'Completed'}
        response2 = self.client.post(self.list_url, data2)
        # Should fail due to unique_together constraint
        self.assertIn(response2.status_code, [status.HTTP_400_BAD_REQUEST, status.HTTP_409_CONFLICT])
