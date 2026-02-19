"""
Signals for updating user points based on review votes.

Points are calculated from helpful/unhelpful votes on a user's reviews:
- Helpful vote (+1 point)
- Unhelpful vote (-1 point)
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from apps.anime.models import ReviewVote
from apps.users.models import UserProfile


@receiver(post_save, sender=ReviewVote)
def update_points_on_vote_save(sender, instance, created, **kwargs):
    """Update author's points when a vote is added or changed."""
    if not created:
        # Vote was updated - we need to recalculate
        # This is rare but handle it by doing a full recalc for this user
        recalculate_user_points(instance.review.user)
        return

    # New vote created
    review_author = instance.review.user
    profile, _ = UserProfile.objects.get_or_create(user=review_author)

    if instance.is_helpful:
        profile.points = profile.points + 1
    else:
        profile.points = profile.points - 1

    profile.save(update_fields=["points"])


@receiver(post_delete, sender=ReviewVote)
def update_points_on_vote_delete(sender, instance, **kwargs):
    """Update author's points when a vote is removed."""
    review_author = instance.review.user
    profile, _ = UserProfile.objects.get_or_create(user=review_author)

    if instance.is_helpful:
        # Removing a helpful vote decreases points
        profile.points = profile.points - 1
    else:
        # Removing an unhelpful vote increases points
        profile.points = profile.points + 1

    profile.save(update_fields=["points"])


def recalculate_user_points(user):
    """
    Recalculate all points for a user based on their reviews' votes.
    Used for vote updates and as a safety net.
    """
    from django.db.models import Sum, Case, When, IntegerField

    profile, _ = UserProfile.objects.get_or_create(user=user)

    # Count helpful votes as +1, unhelpful as -1
    result = ReviewVote.objects.filter(review__user=user).aggregate(
        total_points=Sum(
            Case(
                When(is_helpful=True, then=1),
                When(is_helpful=False, then=-1),
                default=0,
                output_field=IntegerField(),
            )
        )
    )

    profile.points = result["total_points"] or 0
    profile.save(update_fields=["points"])
