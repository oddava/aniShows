"""Public: the announcements the site shows as a banner."""

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ..services.announcement_service import active_announcements


class ActiveAnnouncementsView(APIView):
    """Live banner announcements, newest first (at most three); cached a minute."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response(active_announcements())
