from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.admin_api.services.bulk_operations_service import (
    BulkOperationError,
    perform_bulk_operation,
)
from apps.admin_api.services.reports_service import ReportError, generate_report
from apps.core.permissions import IsAdminUser


class AdminReportsView(APIView):
    """Generate various admin reports."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        report_type = request.query_params.get("type", "overview")
        days = request.query_params.get("days", 30)
        force_refresh = str(request.query_params.get("refresh", "")).lower() in {
            "1",
            "true",
            "yes",
        }
        try:
            result = generate_report(report_type, days, force_refresh=force_refresh)
        except ReportError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)


class AdminBulkOperationsView(APIView):
    """Execute bulk operations on resources."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        entity_type = request.data.get("entity_type") or request.data.get("entity")
        entity_ids = request.data.get("entity_ids")
        if entity_ids is None:
            entity_ids = request.data.get("ids", [])

        try:
            result = perform_bulk_operation(
                request.data.get("operation"),
                entity_type,
                entity_ids,
                request.user,
                request.data,
            )
        except BulkOperationError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)
