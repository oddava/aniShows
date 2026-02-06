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
    """
    Rate limiting for public review access.
    """

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
