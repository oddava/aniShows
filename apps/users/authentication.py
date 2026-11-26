"""JWT authentication that honours "sign out everywhere"."""

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

# The JWT claim carrying the user's session version. Defined here, not in
# auth_service: settings name this module (DEFAULT_AUTHENTICATION_CLASSES), so
# it must stay light and never import the services graph back into settings.
SESSION_VERSION_CLAIM = "sv"


def token_session_version(token) -> int:
    """The ``sv`` claim; tokens minted before the claim existed count as version 0."""
    value = token.get(SESSION_VERSION_CLAIM, 0)
    if isinstance(value, bool) or not isinstance(value, int):
        return -1
    return value


class RevocableJWTAuthentication(JWTAuthentication):
    """Refuse an access token issued under an older session version.

    ``revoke_all_sessions`` (sign out everywhere, suspension, password change)
    blacklists refresh tokens and bumps ``CustomUser.session_version``; access
    tokens issued before it stop working at once instead of living out their
    lifetime. The user row is already loaded here, so the check costs nothing.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if token_session_version(validated_token) < getattr(user, "session_version", 0):
            raise AuthenticationFailed("This session has been signed out.", code="token_revoked")
        return user
