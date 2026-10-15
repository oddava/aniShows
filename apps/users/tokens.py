"""
Purpose-bound tokens for the links we email.

Each flow gets its own salt, so a token minted for one purpose (say, a password
reset) is useless for another. Each hash also covers the state the link
changes, so a token stops working once it has been used:

- password reset: Django's ``default_token_generator`` (covers the password).
- email verification: covers ``email_verified``.
- email change: covers the current email *and* the requested one, so the
  address in the link cannot be swapped for one the user does not own.
"""

from django.contrib.auth.tokens import PasswordResetTokenGenerator


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


class EmailVerificationTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "apps.users.tokens.EmailVerificationTokenGenerator"

    def _make_hash_value(self, user, timestamp):
        profile = getattr(user, "userprofile", None)
        verified = bool(profile and profile.email_verified)
        return f"{user.pk}{user.password}{user.email}{verified}{timestamp}"


class EmailChangeTokenGenerator(PasswordResetTokenGenerator):
    """Token that confirms a change from the user's current email to ``new_email``."""

    key_salt = "apps.users.tokens.EmailChangeTokenGenerator"

    def __init__(self, new_email: str):
        super().__init__()
        self.new_email = normalize_email(new_email)

    def _make_hash_value(self, user, timestamp):
        return f"{user.pk}{user.password}{user.email}{self.new_email}{timestamp}"


email_verification_token_generator = EmailVerificationTokenGenerator()
