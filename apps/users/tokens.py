"""
Purpose-bound tokens for the links we email.

Each flow gets its own salt, so a token minted for one purpose (say, a password
reset) is useless for another. Each hash also covers the state the link
changes, so a token stops working once it has been used:

- password reset: Django's ``default_token_generator`` (covers the password).
- email verification: covers ``email_verified``.
- email change: covers the current email *and* the pending one
  (``UserProfile.pending_email``), so it dies once used, cancelled or replaced.
"""

from django.contrib.auth.tokens import PasswordResetTokenGenerator


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


class EmailVerificationTokenGenerator(PasswordResetTokenGenerator):
    """Single-use email verification tokens.

    The hash includes the profile's ``email_verified`` flag, so a token stops
    validating as soon as it has been used. Its own salt keeps verification and
    password-reset tokens from being swapped for one another.
    """

    key_salt = "apps.users.tokens.EmailVerificationTokenGenerator"

    def _email_verified(self, user) -> bool:
        profile = getattr(user, "userprofile", None)
        return bool(profile and profile.email_verified)

    def _make_hash_value(self, user, timestamp):
        # Unlike a reset token, this one leaves ``last_login`` out: logins bump
        # it (SIMPLE_JWT UPDATE_LAST_LOGIN) and unverified users may sign in, so
        # signing in before clicking the link must not break the link.
        return f"{user.pk}{user.password}{user.email}{timestamp}{self._email_verified(user)}"

    def was_valid_before_verification(self, user, token) -> bool:
        """True if ``token`` was a genuine, unexpired link for ``user`` before they verified."""
        return _pre_verification_token_generator.check_token(user, token)


class _PreVerificationTokenGenerator(EmailVerificationTokenGenerator):
    def _email_verified(self, user) -> bool:
        return False


class EmailChangeTokenGenerator(PasswordResetTokenGenerator):
    """Token that confirms a change from the user's current email to ``new_email``.

    The hash also covers when that change was requested
    (``UserProfile.pending_email_requested_at``): cancelling clears it and a
    new request moves it, so a link from an earlier or cancelled request for
    the same address never comes back to life.
    """

    key_salt = "apps.users.tokens.EmailChangeTokenGenerator"

    def __init__(self, new_email: str):
        super().__init__()
        self.new_email = normalize_email(new_email)

    def _requested_at(self, user) -> str:
        profile = getattr(user, "userprofile", None)
        requested_at = getattr(profile, "pending_email_requested_at", None)
        return requested_at.isoformat() if requested_at else ""

    def _make_hash_value(self, user, timestamp):
        return (
            f"{user.pk}{user.password}{user.email}{self.new_email}"
            f"{self._requested_at(user)}{timestamp}"
        )


email_verification_token_generator = EmailVerificationTokenGenerator()
_pre_verification_token_generator = _PreVerificationTokenGenerator()
