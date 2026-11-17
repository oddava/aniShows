"""Record when each signed-in user was last active (admin "active users" reports)."""

from django.core.cache import cache
from django.db import DatabaseError
from django.utils import timezone

from ...shared.errors import CACHE_ERRORS
from ...shared.logger import logger
from ...shared.throttling import warn_cache_outage

# At most one profile write per user per minute.
DB_UPDATE_THROTTLE = 60


def activity_throttle_key(user_id) -> str:
    return f"user_db_update:{user_id}"


class UserActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Checked after the view: DRF's JWT authentication sets request.user
        # during the view. Failed requests do not count as activity.
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated and response.status_code < 400:
            self._track_activity(user.id)

        return response

    def _track_activity(self, user_id):
        try:
            first_in_window = cache.add(
                activity_throttle_key(user_id), True, timeout=DB_UPDATE_THROTTLE
            )
        except CACHE_ERRORS:
            # Redis is down: skip this best-effort stamp rather than turn every
            # signed-in response into a 500.
            warn_cache_outage("activity stamp; not tracking")
            return
        if not first_in_window:
            return
        try:
            from ..models import UserProfile

            UserProfile.objects.filter(user=user_id).update(last_activity=timezone.now())
        except DatabaseError:
            logger.exception("Failed to update last_activity for user %s", user_id)
