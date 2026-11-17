from allauth.account.signals import user_signed_up
from allauth.socialaccount.signals import social_account_added
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.db.models import QuerySet
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from ..core.services.notification_service import NotificationService
from ..shared.logger import logger
from .models import UserFollow, UserProfile
from .services.cache import invalidate_user_caches
from .services.user_queryset import user_exists

User = get_user_model()


def invalidate_profile_cache(username):
    """Invalidate all cached versions of a user's public profile."""
    from django.conf import settings

    # Lowercased like services/cache.py's keys (usernames are case-insensitive).
    version_key = settings.PROFILE_CACHE_VERSION_KEY_TEMPLATE.format(username=username.lower())
    try:
        cache.incr(version_key)
        logger.debug(f"Invalidated profile cache for user: {username}")
    except ValueError:
        cache.set(version_key, 1, timeout=settings.PROFILE_CACHE_VERSION_TTL)
        logger.debug(f"Created new cache version for user: {username}")


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Automatically create UserProfile for every new user."""
    if created:
        profile, _created = UserProfile.objects.get_or_create(user=instance)
        if instance.is_superuser and not profile.email_verified:
            profile.email_verified = True
            profile.save(update_fields=["email_verified"])
        logger.debug(f"Created UserProfile for user: {instance.username}")


@receiver(social_account_added)
def verify_social_email(request, sociallogin, **kwargs):
    """Automatically verify email for users who register or link social accounts."""
    user = sociallogin.user
    logger.info(f"Social account added/linked for user: {user.username}. Auto-verifying email.")
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
    profile, _created = UserProfile.objects.get_or_create(user=user)

    profile.email_verified = True
    profile.save()

    if sociallogin:
        for email_address in sociallogin.email_addresses:
            email_address.verified = True
            if email_address.pk:
                email_address.save()


@receiver(post_save, sender=UserFollow)
def handle_new_follower(sender, instance, created, **kwargs):
    """Send notification and invalidate cache when someone is followed."""
    if not created:
        return

    invalidate_profile_cache(instance.follower.username)
    invalidate_profile_cache(instance.following.username)

    if instance.follower == instance.following:
        logger.debug(f"Skipping self-follow notification for user {instance.follower.id}")
        return

    try:
        NotificationService.create_new_follower_notification(
            user=instance.following, follower=instance.follower
        )
        logger.info(
            f"Created new follower notification for user {instance.following.id} "
            f"from follower {instance.follower.id}"
        )
    except Exception:
        # A post_save receiver: never let it break the follow itself.
        logger.exception("Failed to create new follower notification")


@receiver(post_delete, sender=UserFollow)
def handle_unfollow(sender, instance, **kwargs):
    """Invalidate cache when a follow relationship is deleted."""
    if not user_exists(instance.follower) or not user_exists(instance.following):
        return

    # Invalidate cache for both users
    invalidate_profile_cache(instance.follower.username)
    invalidate_profile_cache(instance.following.username)
    logger.info(
        f"Cache invalidated due to unfollow: {instance.follower.username} "
        f"unfollowed {instance.following.username}"
    )


@receiver(post_delete, sender=UserProfile)
def delete_profile_media(sender, instance, **kwargs):
    """Remove the avatar and banner from storage once the profile is gone (A10).

    Covers account deletion, the unverified-account purge and admin deletes,
    which all cascade from the user to the profile.
    """
    from .services.profile_update_service import PROFILE_MEDIA_FIELDS, delete_files_on_commit

    delete_files_on_commit(getattr(instance, field) for field in PROFILE_MEDIA_FIELDS)


@receiver(post_save, sender=UserProfile)
def handle_profile_update(sender, instance, created, **kwargs):
    """Invalidate cache when profile is updated (avatar, banner, bio, etc.)."""
    if not created:  # Only invalidate on updates, not initial creation
        invalidate_profile_cache(instance.user.username)
        logger.debug(f"Cache invalidated due to profile update for user: {instance.user.username}")


# =============================================================================
# Points signals (from review votes; semantics in services/points_service.py)
# =============================================================================

from ..animes.models import Review, ReviewVote
from .services import points_service

# Kept importable from here (older callers import it from the signals module).
recalculate_user_points = points_service.recalculate_user_points


def _invalidate_after_commit(user_id: int, username: str) -> None:
    transaction.on_commit(lambda: invalidate_user_caches(user_id, username))


def _deletion_started_at(origin, model) -> bool:
    """Whether the delete that sent this signal started at a ``model`` row or queryset."""
    return isinstance(origin, model) or (isinstance(origin, QuerySet) and origin.model is model)


def _deletion_covers(origin, model, pk) -> bool:
    """Whether the delete that started at ``origin`` is deleting the ``model`` row ``pk``."""
    if isinstance(origin, model):
        return origin.pk == pk
    if isinstance(origin, QuerySet) and origin.model is model:
        return origin.filter(pk=pk).exists()
    return False


@receiver(post_save, sender=ReviewVote)
def update_points_on_vote_save(sender, instance, created, **kwargs):
    """Update the review author's points when a vote is added or changed."""
    author = instance.review.user
    if created:
        points_service.adjust_points(author.pk, points_service.vote_points(instance.vote_type))
    else:
        points_service.recalculate_user_points(author)
    _invalidate_after_commit(author.pk, author.username)


@receiver(post_delete, sender=ReviewVote)
def update_points_on_vote_delete(sender, instance, origin=None, **kwargs):
    """Take a removed vote's points back from the review author.

    When the review itself is being deleted (its votes cascade first), the Review
    receiver below recalculates the author once instead of once per vote.
    """
    if _deletion_started_at(origin, Review):
        # Only the deleted reviews' votes cascade from a review delete.
        return
    author = (
        Review.objects.filter(pk=instance.review_id)
        .values_list("user_id", "user__username")
        .first()
    )
    if author is None:
        return
    author_id, username = author
    if _deletion_covers(origin, User, author_id):
        return
    points_service.adjust_points(author_id, -points_service.vote_points(instance.vote_type))
    _invalidate_after_commit(author_id, username)


@receiver(post_delete, sender=Review)
def update_points_on_review_delete(sender, instance, origin=None, **kwargs):
    """Recalculate the author once after a review and its votes are gone."""
    if _deletion_covers(origin, User, instance.user_id):
        return
    author = instance.user
    points_service.recalculate_user_points(author)
    _invalidate_after_commit(author.pk, author.username)
