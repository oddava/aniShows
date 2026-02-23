"""
Middleware for tracking user activity and online status.
Uses Redis cache for efficient tracking with automatic expiration.
"""

from django.utils import timezone
from django.core.cache import cache
import logging

logger = logging.getLogger(__name__)

# Cache timeout in seconds (5 minutes)
ONLINE_TIMEOUT = 300

# Throttle database updates to once per minute per user
DB_UPDATE_THROTTLE = 60


class UserActivityMiddleware:
    """
    Middleware that tracks user activity on authenticated requests.
    Stores activity timestamp in Redis with automatic expiration.
    Optionally updates database for persistent tracking.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Process the request first
        response = self.get_response(request)

        # Only track activity on successful responses (2xx/3xx)
        # Failed requests (4xx/5xx) should not count as active usage
        if request.user.is_authenticated and response.status_code < 400:
            self._track_activity(request.user)

        return response

    def _track_activity(self, user):
        """Track user activity in Redis and optionally database."""
        user_id = user.id

        # Update Redis cache (fast, with auto-expiration)
        cache_key = f"user_online:{user_id}"
        cache.set(cache_key, timezone.now().isoformat(), timeout=ONLINE_TIMEOUT)

        # Throttle database updates to avoid excessive writes
        # Only update DB once per minute per user
        db_update_key = f"user_db_update:{user_id}"
        if cache.add(db_update_key, True, timeout=DB_UPDATE_THROTTLE):
            try:
                from apps.users.models import UserProfile

                UserProfile.objects.filter(user=user_id).update(
                    last_activity=timezone.now()
                )
            except Exception as e:
                logger.error(f"Failed to update last_activity for user {user_id}: {e}")
