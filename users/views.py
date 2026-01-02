from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import logging

logger = logging.getLogger(__name__)

class CustomOAuth2Client(OAuth2Client):
    def __init__(self, *args, **kwargs):
        # Fix for "got multiple values for argument 'scope_delimiter'"
        if 'scope_delimiter' in kwargs:
             del kwargs['scope_delimiter']
        # Fix for potential other argument conflicts by just passing through
        super().__init__(*args, **kwargs)

class GoogleLogin(SocialLoginView):
    adapter_class = GoogleOAuth2Adapter
    callback_url = f"{settings.FRONTEND_URL}/auth/google/callback"
    client_class = CustomOAuth2Client
    authentication_classes = [] # Disable CSRF check by removing SessionAuthentication

    def get_callback_url(self, request=None, adapter=None):
        """
        Dynamically get callback URL from request, fallback to settings.
        This fixes issues where frontend origin (http vs https, www vs non-www)
        doesn't match the strictly hardcoded settings.FRONTEND_URL.
        """
        # Try to get from request body
        if request and request.data.get('callback_url'):
            url = request.data.get('callback_url')
            logger.debug(f"Using callback_url from request: {url}")
            return url
            
        # Fallback to standard logic (settings or adapter default)
        url = super().get_callback_url(request, adapter)
        logger.debug(f"Using default callback_url: {url}")
        return url

    def post(self, request, *args, **kwargs):
        # Force set callback_url from request if present
        callback_url = request.data.get('callback_url')
        if callback_url:
            self.callback_url = callback_url
            
        print(f"DEBUG: GoogleLogin using callback_url: {self.callback_url}")
        
        try:
            return super().post(request, *args, **kwargs)
        except Exception as e:
            # Print detailed error to stdout for docker logs
            import traceback
            traceback.print_exc()
            if hasattr(e, 'response') and hasattr(e.response, 'text'):
                print(f"DEBUG: Upstream Error Response: {e.response.text}")
                
            logger.exception("GoogleLogin failed")
            raise e
