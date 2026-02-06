"""
API views for import/export functionality
"""
from rest_framework import status, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.http import HttpResponse
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

from users.models import UserImportJob
from users.export_service import ExportService
from users.tasks import process_import_job
from api.serializers import UserImportJobSerializer


class ImportMALView(APIView):
    """Import anime list from MyAnimeList"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        """Start MAL import from username"""
        username = request.data.get("username")

        if not username:
            return Response(
                {"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Create import job
        job = UserImportJob.objects.create(
            user=request.user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier=username,
        )

        # Start async import
        process_import_job.delay(job_id=job.id, username=username)

        return Response(
            {"message": "Import started", "job_id": job.id, "status": "pending"},
            status=status.HTTP_202_ACCEPTED,
        )


class ImportMALXMLView(APIView):
    """Import anime list from MyAnimeList XML export file"""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        """Upload and import MAL XML file"""
        if "file" not in request.FILES:
            return Response(
                {"error": "XML file is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        file = request.FILES["file"]

        # Validate file type
        if not file.name.endswith(".xml"):
            return Response(
                {"error": "File must be an XML file"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate file size (max 10MB)
        if file.size > 10 * 1024 * 1024:
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


class ImportAniListView(APIView):
    """Import anime list from AniList"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        """Start AniList import from username"""
        username = request.data.get("username")
        access_token = request.data.get("access_token")  # Optional

        if not username:
            return Response(
                {"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Create import job
        job = UserImportJob.objects.create(
            user=request.user,
            source=UserImportJob.ImportSource.anilist,
            source_identifier=username,
        )

        # Start async import
        process_import_job.delay(
            job_id=job.id, username=username, access_token=access_token
        )

        return Response(
            {"message": "Import started", "job_id": job.id, "status": "pending"},
            status=status.HTTP_202_ACCEPTED,
        )


class ImportJobStatusView(APIView):
    """Get status of an import job"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, job_id):
        """Get import job status and progress"""
        job = get_object_or_404(UserImportJob, id=job_id, user=request.user)

        serializer = UserImportJobSerializer(job)
        return Response(serializer.data)


class ImportJobListView(APIView):
    """List user's import jobs"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """Get list of import jobs"""
        jobs = UserImportJob.objects.filter(user=request.user).order_by("-created_at")[
            :10
        ]
        serializer = UserImportJobSerializer(jobs, many=True)
        return Response(serializer.data)


class ExportUserDataView(APIView):
    """Export user data"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """Export user data as JSON or XML"""
        # Use 'type' instead of 'format' to avoid DRF content negotiation issues
        export_format = request.query_params.get("type", "json")

        if export_format not in ["json", "xml"]:
            return Response(
                {"error": 'Type must be "json" or "xml"'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Generate export
            export_data = ExportService.export_user_data(request.user, export_format)

            # Determine content type and filename
            if export_format == "json":
                content_type = "application/json"
            else:
                content_type = "application/xml"

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


class ExportUserDataJSONView(APIView):
    """Export user data as JSON (for programmatic use)"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """Export user data as JSON"""
        try:
            export_data = ExportService.export_user_data(request.user, "json")
            return Response({"data": export_data})
        except Exception as e:
            logger.error(f"Export error: {e}")
            return Response(
                {"error": "Failed to generate export"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ImportJobCancelView(APIView):
    """Cancel a pending or processing import job"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, job_id):
        """Cancel an import job"""
        job = get_object_or_404(UserImportJob, id=job_id, user=request.user)

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

