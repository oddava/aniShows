"""Review points (G5 P1-10): recalculation, backfill, cascade deletes."""

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from ...animes.models import Anime, Review, ReviewVote
from ..models import UserProfile
from ..services.points_service import backfill_all_points, recalculate_user_points
from ..signals import recalculate_user_points as recalculate_from_signals

User = get_user_model()
HELPFUL, DISLIKE = ReviewVote.VoteType.HELPFUL, ReviewVote.VoteType.DISLIKE


def points(user) -> int:
    return UserProfile.objects.get(user=user).points


class PointsTests(TestCase):
    def setUp(self):
        self.authors = [
            User.objects.create_user(f"author{i}", f"a{i}@example.com", "x") for i in range(3)
        ]
        self.voters = [
            User.objects.create_user(f"voter{i}", f"v{i}@example.com", "x") for i in range(30)
        ]
        self.animes = [
            Anime.objects.create(title=f"A{i}", slug=f"a{i}", episode_count=1) for i in range(2)
        ]

    def _review(self, author, anime) -> Review:
        return Review.objects.create(user=author, anime=anime, rating=8, text="t")

    def _vote(self, review, voters, vote_type):
        for voter in voters:
            ReviewVote.objects.create(user=voter, review=review, vote_type=vote_type)

    def test_signals_name_is_the_service(self):
        self.assertIs(recalculate_from_signals, recalculate_user_points)

    def test_backfill_matches_per_user_recalculation(self):
        first, second = (self._review(self.authors[0], anime) for anime in self.animes)
        self._vote(first, self.voters[:5], HELPFUL)
        self._vote(second, self.voters[5:12], DISLIKE)
        self._vote(self._review(self.authors[1], self.animes[0]), self.voters[:3], HELPFUL)
        UserProfile.objects.update(points=42)

        updated = backfill_all_points(batch_size=2)
        backfilled = {user.pk: points(user) for user in self.authors}
        for user in self.authors:
            recalculate_user_points(user)

        self.assertEqual(updated, UserProfile.objects.count())
        self.assertEqual(backfilled, {user.pk: points(user) for user in self.authors})
        self.assertEqual(list(backfilled.values()), [-2, 3, 0])
        self.assertEqual(backfill_all_points(), 0)

    def test_command_dry_run_changes_nothing(self):
        self._vote(self._review(self.authors[0], self.animes[0]), self.voters[:2], HELPFUL)
        UserProfile.objects.filter(user=self.authors[0]).update(points=0)
        out = StringIO()

        call_command("backfill_points", "--dry-run", stdout=out)

        self.assertIn("author0: 0 -> 2", out.getvalue())
        self.assertEqual(points(self.authors[0]), 0)
        call_command("backfill_points", stdout=StringIO())
        self.assertEqual(points(self.authors[0]), 2)

    def _delete_queries(self, review) -> list[str]:
        review = Review.objects.select_related("user").get(pk=review.pk)
        with CaptureQueriesContext(connection) as queries:
            review.delete()
        return [query["sql"] for query in queries]

    def test_review_delete_recalculates_once(self):
        author = self.authors[0]
        kept = self._review(author, self.animes[0])
        small = self._review(author, self.animes[1])
        self._vote(kept, self.voters[:4], HELPFUL)
        self._vote(small, self.voters[:1], HELPFUL)
        small_sql = self._delete_queries(small)
        large = self._review(author, self.animes[1])
        self._vote(large, self.voters, HELPFUL)
        self.assertEqual(points(author), 34)

        large_sql = self._delete_queries(large)

        self.assertEqual(points(author), 4)
        # One recalculation (lock the profile, then one UPDATE) however many votes
        # cascade, and no per-vote query at all. (Django's cascade itself is 5 queries;
        # the anime app's review receivers add their own, which this test doesn't pin.)
        self.assertEqual(sum("users_userprofile" in sql for sql in large_sql), 2, large_sql)
        self.assertEqual(len(large_sql), len(small_sql), large_sql)
        self.assertLessEqual(sum("anime_review" in sql for sql in large_sql), 6, large_sql)

    def test_voter_deletion_takes_their_vote_back(self):
        review = self._review(self.authors[0], self.animes[0])
        self._vote(review, self.voters[:2], HELPFUL)
        self._vote(review, self.voters[2:3], DISLIKE)

        self.voters[0].delete()
        self.voters[2].delete()

        self.assertEqual(points(self.authors[0]), 1)

    def test_author_deletion_does_not_recreate_their_profile(self):
        review = self._review(self.authors[0], self.animes[0])
        self._vote(review, self.voters[:3], HELPFUL)

        self.authors[0].delete()

        self.assertFalse(UserProfile.objects.filter(user_id=self.authors[0].pk).exists())

    def test_vote_change_recalculates(self):
        review = self._review(self.authors[0], self.animes[0])
        self._vote(review, self.voters[:2], HELPFUL)
        vote = ReviewVote.objects.get(user=self.voters[0])
        vote.vote_type = DISLIKE
        vote.save()
        self.assertEqual(points(self.authors[0]), 0)
