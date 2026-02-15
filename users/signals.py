from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from allauth.socialaccount.models import SocialAccount
from allauth.socialaccount.signals import social_account_added
from allauth.account.signals import user_signed_up
from .models import UserProfile, UserFollow
from core.services.notification_service import NotificationService
import logging

User = get_user_model()
logger = logging.getLogger(__name__)


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
    """Send notification when someone is followed."""
    if not created:
        return

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
