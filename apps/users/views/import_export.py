import re

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet, ViewSet

from apps.animes.serializers.imports import UserImportJobSerializer
from apps.shared.logger import logger
from apps.users.models import UserImportJob
from apps.users.services.export_service import ExportService
from apps.users.tasks import process_import_job

User = get_user_model()

# Validation for usernames - alphanumeric, underscores, hyphens only
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")

# Max XML file size (10MB)
MAX_XML_SIZE = 10 * 1024 * 1024


class ImportExportViewSet(ViewSet):
    """
    ViewSet for handling importing and exporting of user anime lists.
    Consolidates previously separate APIViews for MAL, AniList, and Exports.
    """

    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=["post"])
    def import_mal(self, request):
        """Start MAL import from username"""
        username = request.data.get("username")

        if not username:
            return Response({"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Validate username format to prevent injection
        if not USERNAME_PATTERN.match(username):
            return Response(
                {
                    "error": "Invalid username format. Use alphanumeric characters, underscores, or hyphens only."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create import job
        job = UserImportJob.objects.create(
            user=request.user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier=username,
        )

        # Start async import with validated username
        process_import_job.delay(job_id=job.id, username=username)

        return Response(
            {"message": "Import started", "job_id": job.id, "status": "pending"},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def import_mal_xml(self, request):
        """Upload and import MAL XML file"""
        if "file" not in request.FILES:
            return Response({"error": "XML file is required"}, status=status.HTTP_400_BAD_REQUEST)

        file = request.FILES["file"]

        # Validate file type
        if not file.name.endswith(".xml"):
            return Response(
                {"error": "File must be an XML file"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate file size (max 10MB) - prevent DoS via large files
        if file.size > MAX_XML_SIZE:
            return Response(
                {"error": "File size must be less than 10MB"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            xml_content = file.read().decode("utf-8")
        except UnicodeDecodeError:
            return Response(
                {"error": "File must be valid UTF-8 encoded XML"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create import job
        job = UserImportJob.objects.create(
            user=request.user,
            source=UserImportJob.ImportSource.myanimelist_xml,
            source_identifier=file.name,
        )

        # Start async import
        process_import_job.delay(job_id=job.id, xml_content=xml_content)

        return Response(
            {"message": "Import started", "job_id": job.id, "status": "pending"},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["post"])
    def import_anilist(self, request):
        """Start AniList import from username"""
        username = request.data.get("username")
        access_token = request.data.get("access_token")  # Optional

        if not username:
            return Response({"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Validate username format to prevent injection
        if not USERNAME_PATTERN.match(username):
            return Response(
                {
                    "error": "Invalid username format. Use alphanumeric characters, underscores, or hyphens only."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Sanitize access_token if provided (basic length check)
        if access_token and len(str(access_token)) > 1000:
            return Response(
                {"error": "Access token is too long"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create import job
        job = UserImportJob.objects.create(
            user=request.user,
            source=UserImportJob.ImportSource.anilist,
            source_identifier=username,
        )

        # Start async import with validated username
        process_import_job.delay(job_id=job.id, username=username, access_token=access_token)

        return Response(
            {"message": "Import started", "job_id": job.id, "status": "pending"},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["get"])
    def export_user_data(self, request):
        """Export user data as JSON or XML (Handles JSON programmatic vs file download)"""
        export_format = request.query_params.get("type", "json")
        download = request.query_params.get("download", "true").lower() == "true"

        if export_format not in ["json", "xml"]:
            return Response(
                {"error": 'Type must be "json" or "xml"'},
                status=status.HTTP_400_BAD_REQUEST,
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
            return Response(
                {"error": "Failed to generate export"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class UserImportJobViewSet(ReadOnlyModelViewSet):
    """
    ViewSet for listing and retrieving import job statuses.
    Read-only but includes a cancel action.
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserImportJobSerializer

    def get_queryset(self):
        return UserImportJob.objects.filter(user=self.request.user).order_by("-created_at")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a pending or processing import job"""
        try:
            job = self.get_object()
        except UserImportJob.DoesNotExist:
            return Response(
                {"error": "Job not found or access denied"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Only allow cancelling pending or processing jobs
        if job.status not in [
            UserImportJob.ImportStatus.pending,
            UserImportJob.ImportStatus.processing,
        ]:
            return Response(
                {"error": "Cannot cancel a job that is already completed or failed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Mark as failed (cancelled)
        job.status = UserImportJob.ImportStatus.failed
        job.errors.append("Cancelled by user")
        job.save(update_fields=["status", "errors"])

        return Response(
            {"message": "Import job cancelled", "job_id": job.id},
            status=status.HTTP_200_OK,
        )
