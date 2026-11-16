"""Points stay exact when a recalculation overlaps another vote (council round 2)."""

import threading
import time

from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.test import TransactionTestCase

from ...animes.models import Anime, Review, ReviewVote
from ..models import UserProfile

User = get_user_model()
HELPFUL, DISLIKE = ReviewVote.VoteType.HELPFUL, ReviewVote.VoteType.DISLIKE


class PointsConcurrencyTests(TransactionTestCase):
    def test_a_recalculation_waiting_on_a_new_vote_counts_it(self):
        """A vote switch recalculates while another vote's +1 holds the profile lock.

        Before the profile was locked in its own statement, the recalculating UPDATE kept
        the snapshot it started with and wrote -1 over the committed +1 (votes total 0).
        """
        author = User.objects.create_user("author", "author@example.com", "x")
        first, second = (
            User.objects.create_user(f"voter{i}", f"voter{i}@example.com", "x") for i in range(2)
        )
        anime = Anime.objects.create(title="A", slug="a", episode_count=1)
        review = Review.objects.create(user=author, anime=anime, rating=8, text="t")
        ReviewVote.objects.create(user=first, review=review, vote_type=HELPFUL)
        holding_lock = threading.Event()

        def add_vote_and_hold_the_lock():
            try:
                with transaction.atomic():
                    ReviewVote.objects.create(user=second, review=review, vote_type=HELPFUL)
                    holding_lock.set()
                    time.sleep(0.5)
            finally:
                connection.close()

        worker = threading.Thread(target=add_vote_and_hold_the_lock)
        worker.start()
        self.assertTrue(holding_lock.wait(5))
        vote = ReviewVote.objects.get(user=first)
        vote.vote_type = DISLIKE
        vote.save()  # recalculates; waits for the worker's profile lock
        worker.join(10)

        self.assertEqual(UserProfile.objects.get(user=author).points, 0)
