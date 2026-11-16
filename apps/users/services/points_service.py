"""Review points (G5 Community).

points = Σ over votes on the user's reviews (helpful +1, dislike -1); may be negative;
not affected by reactions or forum likes.

``UserProfile.points`` is kept up to date incrementally by the ``ReviewVote`` receivers
in ``apps/users/signals.py``; ``recalculate_user_points`` and ``backfill_all_points``
rebuild it from the votes.
"""

from collections.abc import Iterator
from dataclasses import dataclass

from django.db.models import Case, F, IntegerField, OuterRef, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce

from ...animes.models import ReviewVote
from ..models import UserProfile

BACKFILL_BATCH_SIZE = 500

_VOTE_POINTS = Case(
    When(vote_type=ReviewVote.VoteType.HELPFUL, then=Value(1)),
    When(vote_type=ReviewVote.VoteType.DISLIKE, then=Value(-1)),
    default=Value(0),
    output_field=IntegerField(),
)


@dataclass(frozen=True, slots=True)
class PointsChange:
    profile_id: int
    username: str
    old_points: int
    new_points: int


def vote_points(vote_type: str) -> int:
    """Points one vote of ``vote_type`` gives the review's author."""
    return 1 if vote_type == ReviewVote.VoteType.HELPFUL else -1


def adjust_points(user_id: int, delta: int) -> None:
    """Add ``delta`` to the user's points in one UPDATE (concurrent votes must not clobber)."""
    UserProfile.objects.get_or_create(user_id=user_id)
    UserProfile.objects.filter(user_id=user_id).update(points=F("points") + delta)


def _computed_points() -> Coalesce:
    """The points of the profile row ``OuterRef`` points at, as one grouped subquery."""
    per_author = (
        ReviewVote.objects.filter(review__user_id=OuterRef("user_id"))
        .order_by()
        .values("review__user_id")
        .annotate(total=Sum(_VOTE_POINTS))
        .values("total")
    )
    return Coalesce(Subquery(per_author[:1], output_field=IntegerField()), Value(0))


def recalculate_user_points(user) -> None:
    """Rebuild ``user``'s points from the votes on their reviews (one UPDATE)."""
    if not UserProfile.objects.filter(user_id=user.pk).update(points=_computed_points()):
        UserProfile.objects.get_or_create(user_id=user.pk)
        UserProfile.objects.filter(user_id=user.pk).update(points=_computed_points())


def iter_points_changes(batch_size: int = BACKFILL_BATCH_SIZE) -> Iterator[list[PointsChange]]:
    """Yield, per batch of profiles, the profiles whose stored points are wrong."""
    last_pk = 0
    while True:
        batch = list(
            UserProfile.objects.filter(pk__gt=last_pk)
            .order_by("pk")
            .annotate(computed=_computed_points())
            .values_list("pk", "user__username", "points", "computed")[:batch_size]
        )
        if not batch:
            return
        last_pk = batch[-1][0]
        yield [
            PointsChange(profile_id=pk, username=username, old_points=old, new_points=new)
            for pk, username, old, new in batch
            if old != new
        ]


def backfill_all_points(batch_size: int = BACKFILL_BATCH_SIZE) -> int:
    """Rebuild every user's points; return how many profiles changed.

    Two queries per batch: one read that computes the grouped totals, one UPDATE of the
    changed rows (recomputed inside the UPDATE, so a vote landing meanwhile is kept).
    """
    updated = 0
    for changes in iter_points_changes(batch_size):
        if changes:
            updated += UserProfile.objects.filter(
                pk__in=[change.profile_id for change in changes]
            ).update(points=_computed_points())
    return updated
