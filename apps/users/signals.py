from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from django.core.cache import cache
from allauth.socialaccount.models import SocialAccount
from allauth.socialaccount.signals import social_account_added
from allauth.account.signals import user_signed_up
from .models import UserProfile, UserFollow
from apps.core.services.notification_service import NotificationService
import logging

User = get_user_model()
logger = logging.getLogger(__name__)


def invalidate_profile_cache(username):
    """Invalidate all cached versions of a user's public profile."""
    from django.conf import settings

    version_key = settings.PROFILE_CACHE_VERSION_KEY_TEMPLATE.format(username=username)
    try:
        cache.incr(version_key)
        logger.debug(f"Invalidated profile cache for user: {username}")
    except ValueError:
        # Version doesn't exist yet, set it to 1
        cache.set(version_key, 1, timeout=settings.PROFILE_CACHE_VERSION_TTL)
        logger.debug(f"Created new cache version for user: {username}")


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Automatically create UserProfile for every new user."""
    if created:
        UserProfile.objects.get_or_create(user=instance)
        logger.debug(f"Created UserProfile for user: {instance.username}")


@receiver(social_account_added)
def verify_social_email(request, sociallogin, **kwargs):
    """
    Automatically verify email for users who register or link social accounts.
    """
    user = sociallogin.user
    logger.info(
        f"Social account added/linked for user: {user.username}. Auto-verifying email."
    )
    _verify_user_profile(user, sociallogin)


@receiver(user_signed_up)
def verify_oauth_signup(request, user, **kwargs):
    """
    Ensure users who sign up via OAuth are auto-verified.
    'sociallogin' is passed in kwargs when signing up via social account.
    """
    sociallogin = kwargs.get("sociallogin")
    if sociallogin:
        logger.info(f"OAuth signup for user: {user.username}. Auto-verifying email.")
        _verify_user_profile(user, sociallogin)


def _verify_user_profile(user, sociallogin):
    """Helper to verify profile and allauth email addresses."""
    # Get or create profile
    profile, created = UserProfile.objects.get_or_create(user=user)

    # Set email_verified to True
    profile.email_verified = True
    profile.save()

    # Also mark as verified in allauth
    if sociallogin:
        for email_address in sociallogin.email_addresses:
            email_address.verified = True
            # Only save if it already exists in the DB.
            # If it's a new signup, allauth will save it later with the user linked.
            if email_address.pk:
                email_address.save()


@receiver(post_save, sender=UserFollow)
def handle_new_follower(sender, instance, created, **kwargs):
    """Send notification and invalidate cache when someone is followed."""
    if not created:
        return

    # Invalidate cache for both users
    invalidate_profile_cache(instance.follower.username)
    invalidate_profile_cache(instance.following.username)

    # Don't notify if user follows themselves
    if instance.follower == instance.following:
        logger.debug(
            f"Skipping self-follow notification for user {instance.follower.id}"
        )
        return

    try:
        NotificationService.create_new_follower_notification(
            user=instance.following, follower=instance.follower
        )
        logger.info(
            f"Created new follower notification for user {instance.following.id} "
            f"from follower {instance.follower.id}"
        )
    except Exception as e:
        logger.exception(f"Failed to create new follower notification: {e}")


@receiver(post_delete, sender=UserFollow)
def handle_unfollow(sender, instance, **kwargs):
    """Invalidate cache when a follow relationship is deleted."""
    # Invalidate cache for both users
    invalidate_profile_cache(instance.follower.username)
    invalidate_profile_cache(instance.following.username)
    logger.info(
        f"Cache invalidated due to unfollow: {instance.follower.username} "
        f"unfollowed {instance.following.username}"
    )


@receiver(post_save, sender=UserProfile)
def handle_profile_update(sender, instance, created, **kwargs):
    """Invalidate cache when profile is updated (avatar, banner, bio, etc.)."""
    if not created:  # Only invalidate on updates, not initial creation
        invalidate_profile_cache(instance.user.username)
        logger.debug(
            f"Cache invalidated due to profile update for user: {instance.user.username}"
        )


# =============================================================================
# Points signals (from review votes)
# =============================================================================

from apps.animes.models import ReviewVote


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

