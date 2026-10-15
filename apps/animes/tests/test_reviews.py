"""Review API Tests

Tests for:
- Creating reviews (requires anime on list)
- Updating own reviews
- Cannot update others' reviews
- Deleting reviews
- Cannot delete others' reviews
- XSS prevention in review text
"""
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ...core.models import Notification
from ...users.models import UserAnimeList, UserProfile
from ..models import Anime, Review, ReviewReaction, ReviewVote

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

    def test_create_review_stores_text_verbatim(self):
        """Review text is stored exactly as typed."""
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

        # Stored as typed: reviews are rendered as text (React escapes), and
        # escaping here showed apostrophes as "&#x27;" and broke exports.
        review = Review.objects.get(user=self.user, anime=self.anime)
        self.assertEqual(review.text, data['text'])
        self.assertEqual(response.data['text'], data['text'])

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
        self.assertIn('rating_story', response.data['errors'])


class ReviewInteractionTests(APITestCase):
    """Tests for review votes and reactions."""

    def setUp(self):
        self.author = User.objects.create_user(
            username="author",
            email="author@example.com",
            password="password123",
        )
        self.voter = User.objects.create_user(
            username="voter",
            email="voter@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=self.author, defaults={"email_verified": True})
        UserProfile.objects.update_or_create(user=self.voter, defaults={"email_verified": True})

        self.anime = Anime.objects.create(
            title="Review Interaction Anime",
            slug="review-interaction-anime",
            synopsis="Anime for review interaction tests",
            anime_type="TV",
            status="Airing",
        )
        self.review = Review.objects.create(
            user=self.author,
            anime=self.anime,
            rating=8,
            text="A detailed review that should support multiple interactions.",
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.voter)

    def test_vote_switch_replaces_existing_vote_and_repeating_toggles_off(self):
        """A user can have one active vote per review."""
        votes_url = reverse("reviews-votes", args=[self.review.id])

        helpful_response = self.client.post(
            votes_url,
            {"vote_type": ReviewVote.VoteType.HELPFUL},
            format="json",
        )
        self.assertEqual(helpful_response.status_code, status.HTTP_200_OK)
        self.assertTrue(helpful_response.data["active"])

        dislike_response = self.client.post(
            votes_url,
            {"vote_type": ReviewVote.VoteType.DISLIKE},
            format="json",
        )
        self.assertEqual(dislike_response.status_code, status.HTTP_200_OK)
        self.assertTrue(dislike_response.data["active"])
        self.assertEqual(dislike_response.data["vote_type"], ReviewVote.VoteType.DISLIKE)
        self.assertEqual(
            ReviewVote.objects.filter(user=self.voter, review=self.review).count(),
            1,
        )
        self.assertEqual(
            ReviewVote.objects.get(user=self.voter, review=self.review).vote_type,
            ReviewVote.VoteType.DISLIKE,
        )

        toggle_off_response = self.client.post(
            votes_url,
            {"vote_type": ReviewVote.VoteType.DISLIKE},
            format="json",
        )
        self.assertEqual(toggle_off_response.status_code, status.HTTP_200_OK)
        self.assertFalse(toggle_off_response.data["active"])
        self.assertFalse(
            ReviewVote.objects.filter(
                user=self.voter,
                review=self.review,
            ).exists()
        )

    def test_helpful_votes_create_aggregated_review_like_notifications(self):
        votes_url = reverse("reviews-votes", args=[self.review.id])
        other_voter = User.objects.create_user(
            username="other-voter",
            email="other-voter-like@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=other_voter, defaults={"email_verified": True})

        response = self.client.post(
            votes_url,
            {"vote_type": ReviewVote.VoteType.HELPFUL},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(user=other_voter)
        response = self.client.post(
            votes_url,
            {"vote_type": ReviewVote.VoteType.HELPFUL},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        notification = Notification.objects.get(
            user=self.author,
            notification_type=Notification.NotificationType.REVIEW_LIKE,
            data__review_id=self.review.id,
        )
        self.assertEqual(notification.data["liker_count"], 2)
        self.assertEqual(notification.data["liker_username"], "other-voter")
        self.assertEqual(
            notification.message,
            "other-voter and 1 other liked your review of Review Interaction Anime",
        )

    def test_review_like_notification_keeps_actor_when_one_positive_signal_remains(self):
        votes_url = reverse("reviews-votes", args=[self.review.id])
        reactions_url = reverse("reviews-reactions", args=[self.review.id])

        self.client.post(votes_url, {"vote_type": ReviewVote.VoteType.HELPFUL}, format="json")
        self.client.post(
            reactions_url,
            {"reaction_type": ReviewReaction.ReactionType.HEART},
            format="json",
        )

        self.client.post(votes_url, {"vote_type": ReviewVote.VoteType.HELPFUL}, format="json")

        notification = Notification.objects.get(
            user=self.author,
            notification_type=Notification.NotificationType.REVIEW_LIKE,
            data__review_id=self.review.id,
        )
        self.assertEqual(notification.data["liker_count"], 1)
        self.assertEqual(notification.data["liker_username"], "voter")

    def test_review_list_includes_vote_and_reaction_state(self):
        """Serialized reviews expose counts and active states for the current user."""
        ReviewVote.objects.create(
            user=self.voter,
            review=self.review,
            vote_type=ReviewVote.VoteType.HELPFUL,
        )
        other_voter = User.objects.create_user(
            username="other-voter",
            email="other-voter@example.com",
            password="password123",
        )
        ReviewVote.objects.create(
            user=other_voter,
            review=self.review,
            vote_type=ReviewVote.VoteType.DISLIKE,
        )
        ReviewReaction.objects.create(
            user=self.voter,
            review=self.review,
            reaction_type=ReviewReaction.ReactionType.HEART,
        )
        ReviewReaction.objects.create(
            user=self.author,
            review=self.review,
            reaction_type=ReviewReaction.ReactionType.HEART,
        )

        response = self.client.get(reverse("reviews-list"), {"anime": self.anime.slug})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data["results"][0]

        self.assertEqual(payload["helpful_count"], 1)
        self.assertEqual(payload["dislike_count"], 1)
        self.assertEqual(payload["user_votes"], {"helpful": True, "dislike": False})

        reactions = {item["type"]: item for item in payload["reactions"]}
        self.assertEqual(reactions["heart"]["count"], 2)
        self.assertTrue(reactions["heart"]["active"])
        self.assertEqual(reactions["thumbs_up"]["count"], 0)
        self.assertFalse(reactions["thumbs_up"]["active"])

    def test_review_list_query_count_stays_constant(self):
        """Review list should not issue per-review vote/reaction queries."""
        for index in range(2, 6):
            reviewer = User.objects.create_user(
                username=f"reviewer{index}",
                email=f"reviewer{index}@example.com",
                password="password123",
            )
            UserProfile.objects.update_or_create(
                user=reviewer,
                defaults={"email_verified": True},
            )
            review = Review.objects.create(
                user=reviewer,
                anime=self.anime,
                rating=7,
                text=f"Review {index}",
            )
            ReviewVote.objects.create(
                user=self.voter,
                review=review,
                vote_type=ReviewVote.VoteType.HELPFUL,
            )
            ReviewReaction.objects.create(
                user=self.voter,
                review=review,
                reaction_type=ReviewReaction.ReactionType.HEART,
            )

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse("reviews-list"), {"anime": self.anime.slug})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # settings, count, reviews, then genre / studio / social-account prefetches.
        self.assertLessEqual(len(queries), 6, "\n".join(q["sql"][:160] for q in queries.captured_queries))

    def test_reactions_toggle_per_emoji(self):
        """Each reaction type toggles independently for a review."""
        reactions_url = reverse("reviews-reactions", args=[self.review.id])

        heart_response = self.client.post(
            reactions_url,
            {"reaction_type": ReviewReaction.ReactionType.HEART},
            format="json",
        )
        self.assertEqual(heart_response.status_code, status.HTTP_200_OK)
        self.assertTrue(heart_response.data["active"])

        laugh_response = self.client.post(
            reactions_url,
            {"reaction_type": ReviewReaction.ReactionType.LAUGH},
            format="json",
        )
        self.assertEqual(laugh_response.status_code, status.HTTP_200_OK)
        self.assertTrue(laugh_response.data["active"])
        self.assertEqual(
            ReviewReaction.objects.filter(user=self.voter, review=self.review).count(),
            2,
        )

        toggle_off_response = self.client.post(
            reactions_url,
            {"reaction_type": ReviewReaction.ReactionType.HEART},
            format="json",
        )
        self.assertEqual(toggle_off_response.status_code, status.HTTP_200_OK)
        self.assertFalse(toggle_off_response.data["active"])
        self.assertFalse(
            ReviewReaction.objects.filter(
                user=self.voter,
                review=self.review,
                reaction_type=ReviewReaction.ReactionType.HEART,
            ).exists()
        )

    def test_users_cannot_vote_on_their_own_reviews(self):
        """Authors cannot helpful/dislike their own reviews."""
        self.client.force_authenticate(user=self.author)

        response = self.client.post(
            reverse("reviews-votes", args=[self.review.id]),
            {"vote_type": ReviewVote.VoteType.HELPFUL},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["detail"], "Cannot vote on your own review")
        self.assertEqual(response.data["code"], "review_vote_failed")


class AnimeReviewPaginationTests(APITestCase):
    """Tests for anime detail review pagination."""

    def setUp(self):
        self.anime = Anime.objects.create(
            title="Paginated Review Anime",
            slug="paginated-review-anime",
            synopsis="Anime for review pagination tests",
            anime_type="TV",
            status="Airing",
        )

        for index in range(25):
            reviewer = User.objects.create_user(
                username=f"pagination-user-{index}",
                email=f"pagination-user-{index}@example.com",
                password="password123",
            )
            Review.objects.create(
                user=reviewer,
                anime=self.anime,
                rating=8,
                text=f"Review {index}",
            )

        self.client = APIClient()

    def test_anime_reviews_action_uses_standard_pagination(self):
        """Anime review action should honor the shared page_size query param."""
        response = self.client.get(
            reverse("anime-reviews", args=[self.anime.slug]),
            {"page_size": 5},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 25)
        self.assertEqual(len(response.data["results"]), 5)
        self.assertIsNotNone(response.data["next"])
