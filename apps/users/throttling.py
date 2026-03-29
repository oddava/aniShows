"""
Custom throttle classes for API rate limiting.
Provides different rate limits for different types of endpoints.
"""

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class PublicUserProfileRateThrottle(AnonRateThrottle):
    """
    Strict rate limiting for public user profile lookups.
    Prevents user enumeration attacks.
    """

    scope = "user_profile_lookup"


class PublicAnimeListRateThrottle(AnonRateThrottle):
    """
    Rate limiting for public anime browsing.
    Prevents scraping of anime catalog.
    """

    scope = "anime_list"


class PublicReviewRateThrottle(AnonRateThrottle):
    """Rate limiting for public review access."""

    scope = "review_access"


class LoginRateThrottle(AnonRateThrottle):
    """
    Strict rate limiting for authentication endpoints.
    Prevents brute force attacks.
    """

    scope = "login"


class RegisterRateThrottle(AnonRateThrottle):
    """
    Rate limiting for registration.
    Prevents spam account creation.
    """

    scope = "register"


class PasswordResetRateThrottle(AnonRateThrottle):
    """
    Rate limiting for password reset.
    Prevents email abuse.
    """

    scope = "password_reset"


class UserActionRateThrottle(UserRateThrottle):
    """
    Rate limiting for authenticated user actions.
    Prevents abuse of write operations.
    """

    scope = "user_actions"


class AdminActionRateThrottle(UserRateThrottle):
    """
    Rate limiting for admin endpoints.
    Prevents admin panel abuse.
    """

    scope = "admin_actions"


class StrictUserRateThrottle(UserRateThrottle):
    """
    Extra strict rate limiting for sensitive operations.
    Used for account deletion, email changes, etc.
    """

    scope = "strict_user"


class SocialLinksRateThrottle(UserRateThrottle):
    """
    Rate limiting for social link edits.
    More restrictive for new accounts (< 30 days).
    """

    scope = "social_links"

    def allow_request(self, request, view):
        """
        Check rate limit based on account age.
        New accounts (< 30 days) get stricter limits.
        """
        user = request.user

        # Check if user is authenticated
        if not user or not user.is_authenticated:
            return False

        # Calculate account age
        from datetime import timedelta

        from django.utils import timezone

        account_age = timezone.now() - user.date_joined
        is_new_account = account_age < timedelta(days=30)

        if is_new_account:
            # New accounts: max 5 edits per day
            self.rate = "5/day"
            self.num_requests, self.duration = self.parse_rate(self.rate)

        # Call parent to check rate limit
        return super().allow_request(request, view)


class ForumLikeRateThrottle(UserRateThrottle):
    """
    Rate limiting for forum like/unlike actions.
    Prevents like-button spam.
    """

    scope = "forum_like"


class ForumWriteRateThrottle(UserRateThrottle):
    """
    Rate limiting for forum write operations (create/update threads and posts).
    Prevents spam posting.
    """

    scope = "forum_write"
