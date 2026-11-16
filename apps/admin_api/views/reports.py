from rest_framework.response import Response
from rest_framework.views import APIView

from ..permissions import AdminPolicyMixin
from ..services.bulk_operations_service import BulkOperationError, perform_bulk_operation
from ..services.reports_service import ReportError, generate_report
from .query_params import wants_refresh


class AdminReportsView(AdminPolicyMixin, APIView):
    """Generate admin reports (``days`` is one of 7, 30, 90, 365)."""

    def get(self, request):
        report_type = request.query_params.get("type", "overview")
        days = request.query_params.get("days", 30)
        try:
            result = generate_report(report_type, days, force_refresh=wants_refresh(request))
        except ReportError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)


class AdminBulkOperationsView(AdminPolicyMixin, APIView):
    """Bulk operations (superuser): capped, transactional, dry-run first, audited."""

    def post(self, request):
        try:
            result = perform_bulk_operation(request, request.data)
        except BulkOperationError as exc:
            return Response({"detail": exc.message, **exc.extra}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)
