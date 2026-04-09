from urllib.parse import urlsplit, urlunsplit

from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from django.conf import settings
from rest_framework import status
from rest_framework.response import Response

from ...shared.logger import logger
from .social_auth import SocialLoginView


class GoogleLogin(SocialLoginView):
    adapter_class = GoogleOAuth2Adapter
    callback_url = f"{settings.FRONTEND_URL}/auth/google/callback"
    client_class = OAuth2Client
    authentication_classes = []  # Disable CSRF check by removing SessionAuthentication

    @classmethod
    def _default_callback_url(cls):
        return urlunsplit(urlsplit(cls.callback_url)._replace(query="", fragment=""))

    @classmethod
    def _allowed_callback_urls(cls):
        configured_origins = {settings.FRONTEND_URL}
        configured_origins.update(getattr(settings, "CORS_ALLOWED_ORIGINS", []))

        allowed_urls = set()
        for origin in configured_origins:
            if not origin:
                continue
            parsed_origin = urlsplit(origin)
            if not parsed_origin.scheme or not parsed_origin.netloc:
                continue
            allowed_urls.add(
                urlunsplit(
                    (
                        parsed_origin.scheme,
                        parsed_origin.netloc,
                        "/auth/google/callback",
                        "",
                        "",
                    )
                )
            )
        return allowed_urls

    def _resolve_callback_url(self, request):
        requested_callback = request.data.get("callback_url")
        default_callback = self._default_callback_url()

        if not requested_callback:
            return default_callback

        normalized_callback = urlunsplit(urlsplit(requested_callback)._replace(query="", fragment=""))
        if normalized_callback not in self._allowed_callback_urls():
            logger.warning(
                "Rejected non-whitelisted Google callback URL",
                extra={"callback_url": requested_callback},
            )
            raise ValueError("Invalid callback URL.")
        return normalized_callback

    def get_callback_url(self, request=None, adapter=None):
        url = self._resolve_callback_url(request) if request else self._default_callback_url()
        logger.debug(f"Using default callback_url: {url}")
        return url

    def post(self, request, *args, **kwargs):
        try:
            self.callback_url = self._resolve_callback_url(request)
        except ValueError:
            return Response(
                {"callback_url": ["Invalid callback URL."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            return super().post(request, *args, **kwargs)
        except Exception:
            # Log error securely without exposing sensitive data
            logger.exception("GoogleLogin failed")
            raise
