
from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet, ViewSet

from ...animes.serializers.imports import UserImportJobSerializer
from ...core.api_errors import api_response, error_response
from ...shared.logger import logger
from ..models import UserImportJob
from ..services.export_service import ExportService
from ..services.import_job_service import (
    cancel_import_job,
    create_anilist_import_job,
    create_mal_import_job,
    create_mal_xml_import_job,
    is_valid_import_username,
)

# Max XML file size (10MB)
MAX_XML_SIZE = 10 * 1024 * 1024


class ImportExportViewSet(ViewSet):
    """
    ViewSet for handling importing and exporting of user anime lists.
    Consolidates previously separate APIViews for MAL, AniList, and Exports.
    """

    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["post"])
    def import_mal(self, request):
        """Start MAL import from username"""
        username = request.data.get("username")

        if not username:
            return error_response(
                "Username is required",
                code="missing_username",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if not is_valid_import_username(username):
            return error_response(
                "Invalid username format. Use alphanumeric characters, underscores, or hyphens only.",
                code="invalid_username",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        result = create_mal_import_job(request.user, username)
        return api_response(result.payload, status_code=result.status_code, default_code="mal_import_failed")

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def import_mal_xml(self, request):
        """Upload and import MAL XML file"""
        if "file" not in request.FILES:
            return error_response(
                "XML file is required",
                code="missing_xml_file",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        file = request.FILES["file"]

        # Validate file type
        if not file.name.endswith(".xml"):
            return error_response(
                "File must be an XML file",
                code="invalid_xml_file",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        # Validate file size (max 10MB) - prevent DoS via large files
        if file.size > MAX_XML_SIZE:
            return error_response(
                "File size must be less than 10MB",
                code="xml_file_too_large",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        try:
            xml_content = file.read().decode("utf-8")
        except UnicodeDecodeError:
            return error_response(
                "File must be valid UTF-8 encoded XML",
                code="invalid_xml_encoding",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        result = create_mal_xml_import_job(request.user, file.name, xml_content)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="mal_xml_import_failed",
        )

    @action(detail=False, methods=["post"])
    def import_anilist(self, request):
        """Start AniList import from username"""
        username = request.data.get("username")
        access_token = request.data.get("access_token")  # Optional

        if not username:
            return error_response(
                "Username is required",
                code="missing_username",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if not is_valid_import_username(username):
            return error_response(
                "Invalid username format. Use alphanumeric characters, underscores, or hyphens only.",
                code="invalid_username",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        # Sanitize access_token if provided (basic length check)
        if access_token and len(str(access_token)) > 1000:
            return error_response(
                "Access token is too long",
                code="access_token_too_long",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        result = create_anilist_import_job(request.user, username, access_token)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="anilist_import_failed",
        )

    @action(detail=False, methods=["get"])
    def export_user_data(self, request):
        """Export user data as JSON or XML (Handles JSON programmatic vs file download)"""
        export_format = request.query_params.get("type", "json")
        download = request.query_params.get("download", "true").lower() == "true"

        if export_format not in ["json", "xml"]:
            return error_response(
                'Type must be "json" or "xml"',
                code="invalid_export_type",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Generate export
            export_data = ExportService.export_user_data(request.user, export_format)

            if not download and export_format == "json":
                return Response({"data": export_data})

            # Determine content type and filename
            content_type = "application/json" if export_format == "json" else "application/xml"

            filename = ExportService.get_export_filename(request.user, export_format)

            # Create response with proper headers for download
            response = HttpResponse(export_data, content_type=content_type)
            response["Content-Disposition"] = f'attachment; filename="{filename}"'

            return response

        except Exception as e:
            logger.error(f"Export error: {e}")
            return error_response(
                "Failed to generate export",
                code="export_failed",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class UserImportJobViewSet(ReadOnlyModelViewSet):
    """
    ViewSet for listing and retrieving import job statuses.
    Read-only but includes a cancel action.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = UserImportJobSerializer

    def get_queryset(self):
        return UserImportJob.objects.filter(user=self.request.user).order_by("-created_at")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a pending or processing import job"""
        try:
            job = self.get_object()
        except UserImportJob.DoesNotExist:
            return error_response(
                "Job not found or access denied",
                code="import_job_not_found",
                status_code=status.HTTP_404_NOT_FOUND,
            )

        result = cancel_import_job(job)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="cancel_import_job_failed",
        )
