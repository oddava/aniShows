from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

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

    def post(self, request, *args, **kwargs):
        print("DEBUG: GoogleLogin POST received")
        print(f"DEBUG: Request Data: {request.data}")
        print(f"DEBUG: Callback URL: {self.callback_url}")
        try:
            return super().post(request, *args, **kwargs)
        except Exception as e:
            print(f"DEBUG: GoogleLogin Exception: {e}")
            import traceback
            traceback.print_exc()
            raise e
