"""
ASGI config for aniShows project.

Configures both HTTP (Django) and WebSocket (Channels) protocol routing.
Daphne serves this application for WebSocket connections on port 8001,
while Gunicorn continues to serve HTTP on port 8000.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
https://channels.readthedocs.io/en/stable/deploying.html
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "root.settings")

# Initialize Django ASGI application early to ensure AppRegistry is populated
# before importing consumers or routing modules.
django_asgi_app = get_asgi_application()

# Import after Django setup to avoid AppRegistryNotReady
from apps.core.routing import websocket_urlpatterns as core_ws_urls
from apps.forums.routing import websocket_urlpatterns as forum_ws_urls
from root.ws_auth import JWTAuthMiddleware

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(
            JWTAuthMiddleware(
                URLRouter(core_ws_urls + forum_ws_urls),
            ),
        ),
    }
)
