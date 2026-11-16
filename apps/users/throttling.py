"""
Custom throttle classes for API rate limiting.
Provides different rate limits for different types of endpoints.
"""

import contextlib
import hashlib
import math
import time
import unicodedata

from django.conf import settings
from django.core.cache import cache
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


class ResendVerificationRateThrottle(AnonRateThrottle):
    """Resending a verification link has its own bucket (it used to share password reset's)."""

    scope = "resend_verification"


class ChangeEmailRateThrottle(UserRateThrottle):
    """Email-change requests mail an arbitrary address: 5 per hour per user (A09)."""

    scope = "change_email"


def fold_identifier(identifier: str) -> str:
    """Fold an identifier at least as far as the database's case-insensitive lookups.

    Username lookups compare ``lower()`` and email lookups ``UPPER()``, so no
    single fold matches both exactly; what matters is that one account never
    gets two counters (that would multiply the guess budget, A09). NFKC (long
    s, Kelvin sign, fullwidth letters, as create_user does for usernames), the
    two Turkish i's, then ``casefold()``, which also covers final sigma and the
    Cyrillic variant letters that ``UPPER()`` merges. It merges a few spellings
    the database keeps apart (sharp s and "ss"); that is harmless because a
    success never clears a counter, so one account cannot unlock another.
    Accented letters stay distinct.
    """
    composed = unicodedata.normalize("NFKC", identifier.strip())
    return composed.replace("\u0130", "i").replace("\u0131", "i").casefold()


class LoginIdentifierThrottle:
    """Lock an identifier after repeated failed logins, whatever IP they come from (A09).

    ``LoginRateThrottle`` limits per IP only, so guessing spread over many IPs was
    unbounded. This counts login *attempts* per folded identifier (stored as a
    SHA-256, never in clear) in a fixed window, before the password check, and
    refuses them over LOGIN_IDENTIFIER_MAX_FAILURES. A failure stays counted; a
    400 or a success releases only its own slot, so failures always expire with
    their window: a success never clears them (one spelling shared by two
    accounts must not let one account's login reset the other's lock).
    Locking a known identifier out for the window is the accepted trade-off
    (spec R5).
    """

    def __init__(self, identifier: str):
        digest = hashlib.sha256(fold_identifier(identifier).encode()).hexdigest()
        self.count_key = f"throttle:login_identifier:{digest}:count"
        self.reset_key = f"throttle:login_identifier:{digest}:reset_at"
        self.max_failures = settings.LOGIN_IDENTIFIER_MAX_FAILURES
        self.window = settings.LOGIN_IDENTIFIER_WINDOW_SECONDS

    def begin_attempt(self) -> int | None:
        """Count this attempt *before* the password is checked.

        Returns the seconds until the lock ends when the attempt is over the
        limit (the caller answers 429), else None. Counting first means a burst
        of simultaneous guesses cannot all pass the check before the first
        failure is recorded: the counter is atomic, so the 11th concurrent
        attempt is refused. A failed attempt simply stays counted.
        """
        if cache.add(self.count_key, 0, timeout=self.window):
            cache.set(self.reset_key, time.time() + self.window, timeout=self.window)
        try:
            count = cache.incr(self.count_key)
        except ValueError:  # expired between add() and incr()
            cache.set(self.count_key, 1, timeout=self.window)
            cache.set(self.reset_key, time.time() + self.window, timeout=self.window)
            count = 1
        if count <= self.max_failures:
            return None
        reset_at = cache.get(self.reset_key) or (time.time() + self.window)
        return max(1, math.ceil(reset_at - time.time()))

    def release_attempt(self) -> None:
        """Uncount an attempt that did not fail the password check (a 400, a success)."""
        with contextlib.suppress(ValueError):  # the window expired meanwhile
            cache.decr(self.count_key)
