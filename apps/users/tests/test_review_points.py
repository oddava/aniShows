from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db.models import F
from django.test import TestCase

from ...animes.models import Anime, Review, ReviewVote
from ..models import UserProfile

User = get_user_model()


class ReviewVotePointsTests(TestCase):
    def setUp(self):
        self.author = User.objects.create_user(username="author", email="a@example.com", password="x")
        anime = Anime.objects.create(title="A", slug="a", episode_count=1)
        self.review = Review.objects.create(user=self.author, anime=anime, rating=8, text="t")
        self.voters = [
            User.objects.create_user(username=f"v{i}", email=f"v{i}@example.com", password="x")
            for i in range(2)
        ]

    def _points(self):
        return UserProfile.objects.get(user=self.author).points

    def test_votes_add_and_remove_points(self):
        helpful = ReviewVote.objects.create(
            user=self.voters[0], review=self.review, vote_type=ReviewVote.VoteType.HELPFUL
        )
        ReviewVote.objects.create(
            user=self.voters[1], review=self.review, vote_type=ReviewVote.VoteType.DISLIKE
        )
        self.assertEqual(self._points(), 0)

        helpful.delete()
        self.assertEqual(self._points(), -1)

    def test_concurrent_vote_is_not_lost(self):
        """Another vote landing between our read and write must survive."""
        real_get_or_create = UserProfile.objects.get_or_create

        def get_or_create_then_concurrent_vote(*args, **kwargs):
            result = real_get_or_create(*args, **kwargs)
            UserProfile.objects.filter(user=self.author).update(points=F("points") + 1)
            return result

        with patch.object(
            UserProfile.objects, "get_or_create", side_effect=get_or_create_then_concurrent_vote
        ):
            ReviewVote.objects.create(
                user=self.voters[0], review=self.review, vote_type=ReviewVote.VoteType.HELPFUL
            )

        self.assertEqual(self._points(), 2)
