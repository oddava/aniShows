from rest_framework.response import Response
from rest_framework.views import APIView

from ...core.permissions import IsAdminUser, SuperUserRequiredForMethodsMixin
from ..services.settings_service import (
    get_admin_settings_payload,
    save_admin_settings_payload,
)


class AdminSettingsView(SuperUserRequiredForMethodsMixin, APIView):
    permission_classes = [IsAdminUser]
    superuser_methods = frozenset({"put"})

    def get(self, request):
        return Response(get_admin_settings_payload(request.user))

    def put(self, request):
        result = save_admin_settings_payload(request.data, request.user)
        return Response(result.payload, status=result.status_code)
