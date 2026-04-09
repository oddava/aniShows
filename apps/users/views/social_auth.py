from allauth.account.adapter import get_adapter
from dj_rest_auth.views import LoginView

from ..serializers.social_auth import SocialLoginSerializer


class SocialLoginView(LoginView):
    """LoginView variant for allauth social login serializer."""

    serializer_class = SocialLoginSerializer

    def process_login(self):
        get_adapter(self.request).login(self.request, self.user)
