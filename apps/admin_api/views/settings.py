from rest_framework.response import Response
from rest_framework.views import APIView

from ..permissions import AdminPolicyMixin
from ..services.settings_service import (
    get_admin_settings_payload,
    save_admin_settings_payload,
)


class AdminSettingsView(AdminPolicyMixin, APIView):
    """Enforced site settings: staff read, superusers write."""

    def get(self, request):
        return Response(get_admin_settings_payload(request.user))

    def put(self, request):
        result = save_admin_settings_payload(request, request.data)
        return Response(result.payload, status=result.status_code)
