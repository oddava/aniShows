"""Review API Tests

Tests for:
- Creating reviews (requires anime on list)
- Updating own reviews
- Cannot update others' reviews
- Deleting reviews
- Cannot delete others' reviews
- XSS prevention in review text
"""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ...core.models import Notification
from ...users.middleware.activity_middleware import activity_throttle_key
from ...users.models import UserAnimeList, UserProfile
from ..models import Anime, Review, ReviewReaction, ReviewReport, ReviewVote
from ..views.reviews import ReviewWriteThrottle

User = get_user_model()


class ReviewCreationTests(APITestCase):
    """Tests for review creation."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="password123"
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": True})

        self.anime = Anime.objects.create(
            title="Test Anime",
            slug="test-anime",
            synopsis="A test anime synopsis",
            anime_type="TV",
            status="Airing",
        )

        self.reviews_url = reverse("reviews-list")
        self.client = APIClient()
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)

    def test_create_review_requires_anime_on_list(self):
        """Test that creating a review requires the anime to be on user's list."""
        data = {"anime_slug": "test-anime", "rating": 8, "text": "Great anime!"}
        response = self.client.post(self.reviews_url, data)
        # Should fail because anime is not on user's list
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_review_with_anime_on_list(self):
        """Test successful review creation when anime is on user's list."""
        # Add anime to list first
        UserAnimeList.objects.create(user=self.user, anime=self.anime, status="Completed")

        data = {"anime_slug": "test-anime", "rating": 9, "text": "Amazing anime! Highly recommend."}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Review.objects.filter(user=self.user, anime=self.anime).exists())

    def test_create_review_stores_text_verbatim(self):
        """Review text is stored exactly as typed."""
        UserAnimeList.objects.create(user=self.user, anime=self.anime, status="Completed")

        data = {
            "anime_slug": "test-anime",
            "rating": 7,
            "text": '<script>alert("xss")</script> Nice anime!',
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # Stored as typed: reviews are rendered as text (React escapes), and
        # escaping here showed apostrophes as "&#x27;" and broke exports.
        review = Review.objects.get(user=self.user, anime=self.anime)
        self.assertEqual(review.text, data["text"])
        self.assertEqual(response.data["text"], data["text"])

    def test_create_review_unauthenticated(self):
        """Test that unauthenticated users cannot create reviews."""
        self.client.logout()
        data = {"anime_slug": "test-anime", "rating": 8, "text": "Great!"}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class ReviewPermissionTests(APITestCase):
    """Tests for review permissions."""

    def setUp(self):
        self.user1 = User.objects.create_user(
            username="user1", email="user1@example.com", password="password123"
        )
        self.user2 = User.objects.create_user(
            username="user2", email="user2@example.com", password="password123"
        )
        UserProfile.objects.update_or_create(user=self.user1, defaults={"email_verified": True})
        UserProfile.objects.update_or_create(user=self.user2, defaults={"email_verified": True})

        self.anime = Anime.objects.create(
            title="Test Anime",
            slug="test-anime",
            synopsis="A test anime synopsis",
            anime_type="TV",
            status="Airing",
        )

        # User1's review
        UserAnimeList.objects.create(user=self.user1, anime=self.anime, status="Completed")
        self.review = Review.objects.create(
            user=self.user1, anime=self.anime, rating=8, text="Original review text"
        )

        self.client = APIClient()

    def test_update_own_review(self):
        """Test that users can update their own reviews."""
        self.client.force_authenticate(user=self.user1)
        detail_url = reverse("reviews-detail", args=[self.review.id])

        data = {"rating": 9, "text": "Updated review text"}
        response = self.client.patch(detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.review.refresh_from_db()
        self.assertEqual(self.review.rating, 9)
        self.assertIn("Updated", self.review.text)

    def test_cannot_update_others_review(self):
        """Test that users cannot update other users' reviews."""
        self.client.force_authenticate(user=self.user2)
        detail_url = reverse("reviews-detail", args=[self.review.id])

        data = {"rating": 1, "text": "Hacked review!"}
        response = self.client.patch(detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Verify original review unchanged
        self.review.refresh_from_db()
        self.assertEqual(self.review.rating, 8)

    def test_delete_own_review(self):
        """Test that users can delete their own reviews."""
        self.client.force_authenticate(user=self.user1)
        detail_url = reverse("reviews-detail", args=[self.review.id])

        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Review.objects.filter(id=self.review.id).exists())

    def test_cannot_delete_others_review(self):
        """Test that users cannot delete other users' reviews."""
        self.client.force_authenticate(user=self.user2)
        detail_url = reverse("reviews-detail", args=[self.review.id])

        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Review.objects.filter(id=self.review.id).exists())


class ReviewValidationTests(APITestCase):
    """Tests for review validation."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="password123"
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": True})

        self.anime = Anime.objects.create(
            title="Test Anime",
            slug="test-anime",
            synopsis="A test anime synopsis",
            anime_type="TV",
            status="Airing",
        )
        UserAnimeList.objects.create(user=self.user, anime=self.anime, status="Completed")

        self.reviews_url = reverse("reviews-list")
        self.client = APIClient()
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)

    def test_rating_required(self):
        """Test that rating is required."""
        data = {"anime_slug": "test-anime", "text": "Review without rating"}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rating_bounds(self):
        """Test that rating must be between 1 and 10."""
        # Rating too low
        data = {"anime_slug": "test-anime", "rating": 0, "text": "Test"}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Rating too high
        data = {"anime_slug": "test-anime", "rating": 11, "text": "Test"}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_review_text_optional(self):
        """Test that review text is optional (rating-only reviews are valid)."""
        data = {"anime_slug": "test-anime", "rating": 8}
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_spoiler_flag(self):
        """Test that spoiler flag works correctly."""
        data = {
            "anime_slug": "test-anime",
            "rating": 8,
            "text": "This contains spoilers!",
            "has_spoilers": True,
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        review = Review.objects.get(user=self.user, anime=self.anime)
        self.assertTrue(review.has_spoilers)


class ReviewSubRatingTests(APITestCase):
    """Tests for sub-ratings fields."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="password123"
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": True})

        self.anime = Anime.objects.create(
            title="Test Anime",
            slug="test-anime",
            synopsis="A test anime synopsis",
            anime_type="TV",
            status="Airing",
        )
        UserAnimeList.objects.create(user=self.user, anime=self.anime, status="Completed")

        self.reviews_url = reverse("reviews-list")
        self.client = APIClient()
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)

    def test_create_review_with_sub_ratings(self):
        """Test creating review with sub ratings works."""
        data = {
            "anime_slug": "test-anime",
            "rating": 8,
            "rating_story": 9,
            "rating_animation": 10,
            "rating_music": 7,
            "rating_characters": 8,
            "text": "Detailed review",
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
            "anime_slug": "test-anime",
            "rating": 8,
            "rating_story": 11,  # Invalid
            "text": "Invalid stats",
        }
        response = self.client.post(self.reviews_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("rating_story", response.data["errors"])


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

        # The once-a-minute activity write is not part of this view's cost.
        cache.add(activity_throttle_key(self.voter.id), True)
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse("reviews-list"), {"anime": self.anime.slug})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # settings, count, reviews, then genre / studio / social-account prefetches.
        self.assertLessEqual(
            len(queries), 6, "\n".join(q["sql"][:160] for q in queries.captured_queries)
        )

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


def _verified_user(username):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="password123"
    )
    UserProfile.objects.update_or_create(user=user, defaults={"email_verified": True})
    return user


def _anime(slug):
    return Anime.objects.create(title=slug.title(), slug=slug, anime_type="TV", status="Airing")


class ReviewAnimeImmutableTests(APITestCase):
    def setUp(self):
        self.user = _verified_user("mover")
        self.anime = _anime("first-anime")
        self.other_anime = _anime("second-anime")
        UserAnimeList.objects.create(user=self.user, anime=self.other_anime, status="Completed")
        self.review = Review.objects.create(user=self.user, anime=self.anime, rating=7)
        self.client.force_authenticate(user=self.user)
        self.url = reverse("reviews-detail", args=[self.review.id])

    def test_patch_with_another_anime_is_rejected(self):
        response = self.client.patch(self.url, {"anime_slug": "second-anime"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data["errors"]["anime_slug"], ["A review cannot be moved to another anime."]
        )
        self.review.refresh_from_db()
        self.assertEqual(self.review.anime_id, self.anime.id)

    def test_patch_with_the_same_anime_is_accepted(self):
        response = self.client.patch(
            self.url, {"anime_slug": "first-anime", "rating": 9}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.review.refresh_from_db()
        self.assertEqual(self.review.rating, 9)


class ReviewWriteThrottleTests(APITestCase):
    def test_review_writes_are_throttled(self):
        user = _verified_user("fastwriter")
        review = Review.objects.create(user=user, anime=_anime("throttled-anime"), rating=5)
        self.client.force_authenticate(user=user)
        url = reverse("reviews-detail", args=[review.id])

        with patch.object(ReviewWriteThrottle, "rate", "2/minute", create=True):
            cache.clear()
            statuses = [
                self.client.patch(url, {"rating": rating}, format="json").status_code
                for rating in (6, 7, 8)
            ]
            throttled = self.client.patch(url, {"rating": 9}, format="json")

        self.assertEqual(statuses, [200, 200, 429])
        self.assertEqual(throttled.data["code"], "throttled")


class ReviewReportWorkflowTests(APITestCase):
    def setUp(self):
        self.author = _verified_user("reported-author")
        self.reporter = _verified_user("reporter")
        self.moderator = _verified_user("moderator")
        self.review = Review.objects.create(
            user=self.author, anime=_anime("reported-anime"), rating=4
        )
        self.client.force_authenticate(user=self.reporter)

    def _report(self, review, reason="spam", description=""):
        return self.client.post(
            reverse("reviews-report", args=[review.id]),
            {"reason": reason, "description": description},
            format="json",
        )

    def test_open_report_is_updated_on_re_report(self):
        first = self._report(self.review, "spam")
        second = self._report(self.review, "spoiler", "Ending spoiled")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertTrue(first.data["created"])
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertFalse(second.data["created"])
        self.assertEqual(second.data["status"], ReviewReport.Status.OPEN)
        report = ReviewReport.objects.get(review=self.review, reporter=self.reporter)
        self.assertEqual((report.reason, report.description), ("spoiler", "Ending spoiled"))

    def test_closed_report_is_never_reopened(self):
        self._report(self.review, "spam", "first")
        resolved_at = timezone.now()
        ReviewReport.objects.filter(review=self.review).update(
            status=ReviewReport.Status.DISMISSED,
            resolved_by=self.moderator,
            resolved_at=resolved_at,
            resolution_notes="Not spam",
        )

        response = self._report(self.review, "harassment", "second")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], ReviewReport.Status.DISMISSED)
        self.assertFalse(response.data["created"])
        report = ReviewReport.objects.get(review=self.review, reporter=self.reporter)
        self.assertEqual(report.status, ReviewReport.Status.DISMISSED)
        self.assertEqual(report.resolved_by_id, self.moderator.id)
        self.assertEqual(report.resolved_at, resolved_at)
        self.assertEqual(report.resolution_notes, "Not spam")
        self.assertEqual((report.reason, report.description), ("spam", "first"))

    @override_settings(REVIEW_REPORTS_PER_DAY=2)
    def test_daily_report_cap(self):
        reviews = [
            Review.objects.create(
                user=_verified_user(f"author{index}"), anime=self.review.anime, rating=5
            )
            for index in range(3)
        ]
        self.assertEqual(self._report(reviews[0]).status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._report(reviews[1]).status_code, status.HTTP_201_CREATED)

        limited = self._report(reviews[2])
        re_report = self._report(reviews[0], "other")

        self.assertEqual(limited.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(limited.data["code"], "report_limit")
        self.assertFalse(ReviewReport.objects.filter(review=reviews[2]).exists())
        self.assertEqual(re_report.status_code, status.HTTP_200_OK)

    @override_settings(REVIEW_REPORTS_PER_DAY=1)
    def test_reports_older_than_a_day_do_not_count(self):
        old_review = Review.objects.create(
            user=_verified_user("old-author"), anime=self.review.anime, rating=5
        )
        self._report(old_review)
        ReviewReport.objects.update(created_at=timezone.now() - timedelta(days=1, minutes=1))

        self.assertEqual(self._report(self.review).status_code, status.HTTP_201_CREATED)

    def test_own_review_cannot_be_reported(self):
        self.client.force_authenticate(user=self.author)

        response = self._report(self.review)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "review_report_failed")


class ReviewInteractionResponseTests(APITestCase):
    def setUp(self):
        self.author = _verified_user("int-author")
        self.voter = _verified_user("int-voter")
        self.review = Review.objects.create(
            user=self.author, anime=_anime("interaction-anime"), rating=8
        )
        ReviewVote.objects.create(
            user=_verified_user("int-other"),
            review=self.review,
            vote_type=ReviewVote.VoteType.DISLIKE,
        )
        self.client.force_authenticate(user=self.voter)

    def test_vote_response_carries_fresh_counts(self):
        response = self.client.post(
            reverse("reviews-votes", args=[self.review.id]),
            {"vote_type": ReviewVote.VoteType.HELPFUL},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["helpful_count"], 1)
        self.assertEqual(response.data["dislike_count"], 1)
        self.assertEqual(response.data["user_votes"], {"helpful": True, "dislike": False})
        self.assertEqual(len(response.data["reactions"]), len(ReviewReaction.ReactionType.values))

    def test_reaction_response_carries_fresh_counts(self):
        response = self.client.post(
            reverse("reviews-reactions", args=[self.review.id]),
            {"reaction_type": ReviewReaction.ReactionType.HEART},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        heart = next(item for item in response.data["reactions"] if item["type"] == "heart")
        self.assertEqual(heart["count"], 1)
        self.assertTrue(heart["active"])
        self.assertEqual(response.data["dislike_count"], 1)

    def test_own_review_cannot_be_reacted_to(self):
        self.client.force_authenticate(user=self.author)

        response = self.client.post(
            reverse("reviews-reactions", args=[self.review.id]),
            {"reaction_type": ReviewReaction.ReactionType.HEART},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "own_review")
        self.assertFalse(ReviewReaction.objects.filter(review=self.review).exists())

    def test_heart_after_helpful_vote_does_not_notify_again(self):
        self.client.post(
            reverse("reviews-votes", args=[self.review.id]),
            {"vote_type": ReviewVote.VoteType.HELPFUL},
            format="json",
        )
        with patch("apps.animes.services.reviews.notify") as notify:
            self.client.post(
                reverse("reviews-reactions", args=[self.review.id]),
                {"reaction_type": ReviewReaction.ReactionType.HEART},
                format="json",
            )

        notify.assert_not_called()


class ReviewListVisibilityTests(APITestCase):
    def setUp(self):
        self.private_author = _verified_user("private-author")
        UserProfile.objects.filter(user=self.private_author).update(is_private=True)
        Review.objects.create(user=self.private_author, anime=_anime("private-anime"), rating=6)

    def _list(self):
        return self.client.get(reverse("reviews-list"), {"user": "private-author"})

    def test_private_user_reviews_are_hidden_from_others(self):
        self.assertEqual(self._list().data["results"], [])
        self.client.force_authenticate(user=_verified_user("stranger"))
        self.assertEqual(self._list().data["results"], [])

    def test_private_user_sees_their_own_reviews_with_full_anime(self):
        self.private_author.refresh_from_db()
        self.client.force_authenticate(user=self.private_author)

        results = self._list().data["results"]

        self.assertEqual(len(results), 1)
        self.assertIn("genres", results[0]["anime"])

    def test_anime_page_still_lists_private_users_reviews_with_compact_anime(self):
        response = self.client.get(reverse("reviews-list"), {"anime": "private-anime"})

        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(
            set(response.data["results"][0]["anime"]),
            {"id", "title", "title_jp", "slug", "cover_image", "cover_image_small", "rating"},
        )


class ReviewListOrderingAndBudgetTests(APITestCase):
    def setUp(self):
        self.anime = _anime("budget-anime")
        self.viewer = _verified_user("budget-viewer")
        self.voters = [_verified_user(f"budget-voter{index}") for index in range(6)]

    def _review_with_votes(self, name, helpful, dislike):
        review = Review.objects.create(user=_verified_user(name), anime=self.anime, rating=7)
        for index, voter in enumerate(self.voters[: helpful + dislike]):
            vote_type = (
                ReviewVote.VoteType.HELPFUL if index < helpful else ReviewVote.VoteType.DISLIKE
            )
            ReviewVote.objects.create(user=voter, review=review, vote_type=vote_type)
        return review

    def test_most_helpful_uses_the_wilson_lower_bound(self):
        no_votes = self._review_with_votes("no-votes", 0, 0)
        split = self._review_with_votes("split", 3, 3)
        one_helpful = self._review_with_votes("one-helpful", 1, 0)
        mostly_helpful = self._review_with_votes("mostly-helpful", 5, 1)

        response = self.client.get(reverse("reviews-list"), {"anime": self.anime.slug})

        ids = [item["id"] for item in response.data["results"]]
        # Raw helpful counts would rank "split" (3 of 6) above "one helpful" (1 of 1).
        self.assertEqual(ids, [mostly_helpful.id, one_helpful.id, split.id, no_votes.id])

    def test_twenty_reviews_with_votes_and_reactions_stay_within_budget(self):
        for index in range(20):
            review = self._review_with_votes(f"budget-author{index}", index % 3, index % 2)
            ReviewReaction.objects.create(
                user=self.viewer, review=review, reaction_type=ReviewReaction.ReactionType.LAUGH
            )
            ReviewReaction.objects.create(
                user=self.voters[0], review=review, reaction_type=ReviewReaction.ReactionType.HEART
            )
        self.client.force_authenticate(user=self.viewer)
        cache.add(activity_throttle_key(self.viewer.id), True)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(
                reverse("reviews-list"), {"anime": self.anime.slug, "page_size": 20}
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 20)
        self.assertLessEqual(
            len(queries), 8, "\n".join(q["sql"][:160] for q in queries.captured_queries)
        )
        laugh = next(r for r in response.data["results"][0]["reactions"] if r["type"] == "laugh")
        self.assertEqual(laugh, {"type": "laugh", "emoji": "😂", "count": 1, "active": True})
