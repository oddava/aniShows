from dj_rest_auth.views import LoginView

from ..serializers.social_auth import SocialLoginSerializer


class SocialLoginView(LoginView):
    """LoginView variant for allauth social login serializer."""

    serializer_class = SocialLoginSerializer

    def process_login(self):
        """Never start a Django session: the API authenticates with JWTs only.

        A session cookie would outlive the JWT logout and keep authenticating
        API calls through ``SessionAuthentication`` (A05).
        """
