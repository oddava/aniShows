from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.users.serializers.users import UserActivitySerializer
from apps.users.services.activity_service import build_activity_queryset, get_heatmap_data


class UserActivityViewSet(ReadOnlyModelViewSet):
    """Read-only viewset for user activity feed and heatmap data."""

    serializer_class = UserActivitySerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        return build_activity_queryset(self.request)

    @action(detail=False, methods=["get"])
    def heatmap(self, request):
        """Return aggregated episodes watched per day for the past year.

        Only counts progress and completed activities, summing the actual
        episode diffs (new_episodes - old_episodes) per day. Negative diffs
        (e.g. from rewatching) are clamped to 0.

        Response format: [{"date": "2026-02-20", "count": 4}, ...]
        """
        return Response(get_heatmap_data(request))
