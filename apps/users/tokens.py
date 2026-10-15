from django.contrib.auth.tokens import PasswordResetTokenGenerator


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
        return f"{super()._make_hash_value(user, timestamp)}{self._email_verified(user)}"

    def was_valid_before_verification(self, user, token) -> bool:
        """True if ``token`` was a genuine, unexpired link for ``user`` before they verified."""
        return _pre_verification_token_generator.check_token(user, token)


class _PreVerificationTokenGenerator(EmailVerificationTokenGenerator):
    def _email_verified(self, user) -> bool:
        return False


email_verification_token_generator = EmailVerificationTokenGenerator()
_pre_verification_token_generator = _PreVerificationTokenGenerator()
