"""Admin System page endpoints (G6 P1-3)."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ...shared.logger import logger
from ..permissions import AdminPolicyMixin, is_superuser_request
from ..services.system_service import SystemActionError, build_system_payload, run_beat_entry
from .query_params import wants_refresh


class AdminSystemView(AdminPolicyMixin, APIView):
    """Queues, workers, beat, AniList budget, database and recent failures (staff read)."""

    def get(self, request):
        payload = build_system_payload(refresh=wants_refresh(request))
        return Response({**payload, "can_run": is_superuser_request(request)})


class AdminSystemBeatRunView(AdminPolicyMixin, APIView):
    """Run one beat entry now with its configured kwargs (superuser, audited)."""

    def post(self, request, entry):
        try:
            payload = run_beat_entry(request, entry)
        except SystemActionError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        except Exception:
            logger.exception("Running a beat entry failed", extra={"entry": entry})
            return Response(
                {"detail": "Failed to queue the task."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(payload, status=status.HTTP_202_ACCEPTED)
