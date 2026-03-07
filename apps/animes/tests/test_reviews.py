"""
Review API Tests

Tests for:
- Creating reviews (requires anime on list)
- Updating own reviews
- Cannot update others' reviews
- Deleting reviews
- Cannot delete others' reviews
- XSS prevention in review text
"""
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient
from rest_framework import status
from django.contrib.auth import get_user_model
from apps.animes.models import Anime, Review
from apps.users.models import UserProfile, UserAnimeList

User = get_user_model()

class ReviewCreationTests(APITestCase):
    """Tests for review creation."""
    
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
        
        self.reviews_url = reverse('reviews-list')
        self.client = APIClient()
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)
    
    def test_create_review_requires_anime_on_list(self):
        """Test that creating a review requires the anime to be on user's list."""
        data = {
            'anime_slug': 'test-anime',
            'rating': 8,
            'text': 'Great anime!'
        }
        response = self.client.post(self.reviews_url, data)
        # Should fail because anime is not on user's list
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
    
    def test_create_review_with_anime_on_list(self):
        """Test successful review creation when anime is on user's list."""
        # Add anime to list first
        UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status='Completed'
        )
        
        data = {
            'anime_slug': 'test-anime',
            'rating': 9,
            'text': 'Amazing anime! Highly recommend.'
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            Review.objects.filter(user=self.user, anime=self.anime).exists()
        )
    
    def test_create_review_xss_prevention(self):
        """Test that review text is sanitized against XSS."""
        UserAnimeList.objects.create(
            user=self.user,
            anime=self.anime,
            status='Completed'
        )
        
        data = {
            'anime_slug': 'test-anime',
            'rating': 7,
            'text': '<script>alert("xss")</script> Nice anime!'
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        review = Review.objects.get(user=self.user, anime=self.anime)
        self.assertNotIn('<script>', review.text)
        self.assertIn('&lt;script&gt;', review.text)  # Escaped
    
    def test_create_review_unauthenticated(self):
        """Test that unauthenticated users cannot create reviews."""
        self.client.logout()
        data = {
            'anime_slug': 'test-anime',
            'rating': 8,
            'text': 'Great!'
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

class ReviewPermissionTests(APITestCase):
    """Tests for review permissions."""
    
    def setUp(self):
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
        
        self.anime = Anime.objects.create(
            title='Test Anime',
            slug='test-anime',
            synopsis='A test anime synopsis',
            anime_type='TV',
            status='Airing'
        )
        
        # User1's review
        UserAnimeList.objects.create(user=self.user1, anime=self.anime, status='Completed')
        self.review = Review.objects.create(
            user=self.user1,
            anime=self.anime,
            rating=8,
            text='Original review text'
        )
        
        self.client = APIClient()
    
    def test_update_own_review(self):
        """Test that users can update their own reviews."""
        self.client.force_authenticate(user=self.user1)
        detail_url = reverse('reviews-detail', args=[self.review.id])
        
        data = {'rating': 9, 'text': 'Updated review text'}
        response = self.client.patch(detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        self.review.refresh_from_db()
        self.assertEqual(self.review.rating, 9)
        self.assertIn('Updated', self.review.text)
    
    def test_cannot_update_others_review(self):
        """Test that users cannot update other users' reviews."""
        self.client.force_authenticate(user=self.user2)
        detail_url = reverse('reviews-detail', args=[self.review.id])
        
        data = {'rating': 1, 'text': 'Hacked review!'}
        response = self.client.patch(detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        
        # Verify original review unchanged
        self.review.refresh_from_db()
        self.assertEqual(self.review.rating, 8)
    
    def test_delete_own_review(self):
        """Test that users can delete their own reviews."""
        self.client.force_authenticate(user=self.user1)
        detail_url = reverse('reviews-detail', args=[self.review.id])
        
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Review.objects.filter(id=self.review.id).exists())
    
    def test_cannot_delete_others_review(self):
        """Test that users cannot delete other users' reviews."""
        self.client.force_authenticate(user=self.user2)
        detail_url = reverse('reviews-detail', args=[self.review.id])
        
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Review.objects.filter(id=self.review.id).exists())

class ReviewValidationTests(APITestCase):
    """Tests for review validation."""
    
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
        UserAnimeList.objects.create(user=self.user, anime=self.anime, status='Completed')
        
        self.reviews_url = reverse('reviews-list')
        self.client = APIClient()
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)
    
    def test_rating_required(self):
        """Test that rating is required."""
        data = {
            'anime_slug': 'test-anime',
            'text': 'Review without rating'
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
    
    def test_rating_bounds(self):
        """Test that rating must be between 1 and 10."""
        # Rating too low
        data = {'anime_slug': 'test-anime', 'rating': 0, 'text': 'Test'}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        
        # Rating too high
        data = {'anime_slug': 'test-anime', 'rating': 11, 'text': 'Test'}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
    
    def test_review_text_optional(self):
        """Test that review text is optional (rating-only reviews are valid)."""
        data = {
            'anime_slug': 'test-anime',
            'rating': 8
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
    
    
    def test_spoiler_flag(self):
        """Test that spoiler flag works correctly."""
        data = {
            'anime_slug': 'test-anime',
            'rating': 8,
            'text': 'This contains spoilers!',
            'has_spoilers': True
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        review = Review.objects.get(user=self.user, anime=self.anime)
        self.assertTrue(review.has_spoilers)

class ReviewSubRatingTests(APITestCase):
    """Tests for sub-ratings fields."""
    
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
        UserAnimeList.objects.create(user=self.user, anime=self.anime, status='Completed')
        
        self.reviews_url = reverse('reviews-list')
        self.client = APIClient()
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)

    def test_create_review_with_sub_ratings(self):
        """Test creating review with sub ratings works."""
        data = {
            'anime_slug': 'test-anime',
            'rating': 8,
            'rating_story': 9,
            'rating_animation': 10,
            'rating_music': 7,
            'rating_characters': 8,
            'text': 'Detailed review'
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        review = Review.objects.get(user=self.user, anime=self.anime)
        self.assertEqual(review.rating, 8)
        self.assertEqual(review.rating_story, 9)
        self.assertEqual(review.rating_animation, 10)
        self.assertEqual(review.rating_music, 7)
        self.assertEqual(review.rating_characters, 8)

    def test_sub_rating_bounds(self):
        """Test sub ratings respect 1-10 bounds."""
        data = {
            'anime_slug': 'test-anime',
            'rating': 8,
            'rating_story': 11, # Invalid
            'text': 'Invalid stats'
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('rating_story', response.data)

