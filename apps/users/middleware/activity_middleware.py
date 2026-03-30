from apps.shared.logger import logger

"""
Middleware for tracking user activity timestamps.
"""

from django.core.cache import cache
from django.utils import timezone

# Throttle database updates to once per minute per user
DB_UPDATE_THROTTLE = 60

class UserActivityMiddleware:
    """
    Middleware that tracks user activity on authenticated requests.
    Updates database timestamps with throttling.
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
        """Track user activity timestamp in database."""
        user_id = user.id

        # Throttle database updates to avoid excessive writes
        # Only update DB once per minute per user
        db_update_key = f"user_db_update:{user_id}"
        if cache.add(db_update_key, True, timeout=DB_UPDATE_THROTTLE):
            try:
                from apps.users.models import UserProfile

                queryset = UserProfile.objects.filter(user=user_id)
                queryset.update(
                    last_activity=timezone.now()
                )
            except Exception as e:
                logger.error(f"Failed to update last_activity for user {user_id}: {e}")
