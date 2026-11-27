from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ReadOnlyModelViewSet, ViewSet

from ...animes.serializers.imports import UserImportJobSerializer
from ...core.api_errors import api_response, error_response
from ..models import UserImportJob
from ..permissions import VerifiedEmailForWrites
from ..services.export_service import EXPORT_FORMATS, ExportService
from ..services.import_job_service import (
    cancel_import_job,
    create_anilist_import_job,
    create_mal_import_job,
    create_mal_xml_import_job,
    is_valid_import_username,
)
from ..services.import_service import anilist_sync
from ..services.import_service.mal_xml import (
    MAX_XML_UPLOAD_BYTES,
    XMLImportError,
    parse_mal_xml,
    read_upload,
)

ACCEPTED_XML_SUFFIXES = (".xml", ".xml.gz", ".gz")
INVALID_USERNAME = (
    "Invalid username format. Use alphanumeric characters, underscores, or hyphens only."
)


def _username_error(username):
    if not username:
        return error_response(
            "Username is required",
            code="missing_username",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    if not is_valid_import_username(username):
        return error_response(
            INVALID_USERNAME, code="invalid_username", status_code=status.HTTP_400_BAD_REQUEST
        )
    return None


class ImportExportViewSet(ViewSet):
    """Starts list imports (MAL username, MAL XML, AniList username) and serves exports."""

    permission_classes = [IsAuthenticated, VerifiedEmailForWrites]

    @action(detail=False, methods=["post"])
    def import_mal(self, request):
        username = request.data.get("username")
        if error := _username_error(username):
            return error
        result = create_mal_import_job(request.user, username)
        return api_response(
            result.payload, status_code=result.status_code, default_code="mal_import_failed"
        )

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def import_mal_xml(self, request):
        """Upload a MAL export (``.xml`` or ``.xml.gz``); it is parsed here, once."""
        upload = request.FILES.get("file")
        if upload is None:
            return error_response(
                "XML file is required",
                code="missing_xml_file",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if not upload.name.lower().endswith(ACCEPTED_XML_SUFFIXES):
            return error_response(
                "File must be a MyAnimeList export (.xml or .xml.gz)",
                code="invalid_xml_file",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if upload.size > MAX_XML_UPLOAD_BYTES:
            return error_response(
                "File size must be less than 10MB",
                code="xml_file_too_large",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        try:
            entries = parse_mal_xml(read_upload(upload.read()))
        except XMLImportError as exc:
            return error_response(str(exc), code=exc.code, status_code=status.HTTP_400_BAD_REQUEST)

        max_entries = settings.MAX_IMPORT_XML_ENTRIES
        if len(entries) > max_entries:
            return error_response(
                f"XML import contains too many entries. Maximum allowed: {max_entries}.",
                code="xml_entry_limit_exceeded",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        result = create_mal_xml_import_job(request.user, upload.name, entries)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="mal_xml_import_failed",
        )

    @action(detail=False, methods=["post"])
    def import_anilist(self, request):
        """Import a public AniList list by username. An ``access_token`` field is ignored."""
        username = request.data.get("username")
        if error := _username_error(username):
            return error
        result = create_anilist_import_job(request.user, username)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="anilist_import_failed",
        )

    @action(detail=False, methods=["get"])
    def export_user_data(self, request):
        """``?type=json|xml|csv``; ``download=false`` (JSON only) returns ``{"data": <object>}``."""
        export_format = request.query_params.get("type", "json")
        download = request.query_params.get("download", "true").lower() == "true"

        if export_format not in EXPORT_FORMATS:
            return error_response(
                'Type must be "json", "xml" or "csv"',
                code="invalid_export_type",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if not download and export_format == "json":
            return Response({"data": ExportService.export_user_data_object(request.user)})

        export = ExportService.export_file(request.user, export_format)
        response = HttpResponse(export.content, content_type=export.content_type)
        response["Content-Disposition"] = f'attachment; filename="{export.filename}"'
        if export.skipped:
            response["X-Export-Skipped"] = str(export.skipped)
        return response


class AniListLinkView(APIView):
    """``GET/PUT/DELETE import/anilist/link/``: the linked AniList username (pull-only)."""

    permission_classes = [IsAuthenticated, VerifiedEmailForWrites]

    def get(self, request):
        return Response(
            anilist_sync.link_payload(anilist_sync.get_link(request.user), request.user)
        )

    def put(self, request):
        username = request.data.get("username")
        if error := _username_error(username):
            return error
        auto_sync = request.data.get("auto_sync", False)
        if not isinstance(auto_sync, bool):
            return error_response(
                "auto_sync must be true or false",
                code="invalid_auto_sync",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        return Response(anilist_sync.save_link(request.user, username, auto_sync))

    def delete(self, request):
        anilist_sync.delete_link(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AniListSyncView(APIView):
    """``POST import/anilist/sync/``: fetch only what changed on AniList since the last sync."""

    permission_classes = [IsAuthenticated, VerifiedEmailForWrites]

    def post(self, request):
        result = anilist_sync.request_sync(request.user)
        payload = dict(result.payload)
        # ``api_response`` keeps only detail/code/errors on a 4xx; the cooldown also
        # tells the client when to try again (body and the standard header).
        retry_after = payload.pop("retry_after", None)
        response = api_response(
            payload,
            status_code=result.status_code,
            default_code="anilist_sync_failed",
            headers={"Retry-After": str(retry_after)} if retry_after is not None else None,
        )
        if retry_after is not None:
            response.data["retry_after"] = retry_after
        return response


class UserImportJobViewSet(ReadOnlyModelViewSet):
    """The signed-in user's import jobs, with a cancel action."""

    permission_classes = [IsAuthenticated]
    serializer_class = UserImportJobSerializer

    def get_queryset(self):
        return UserImportJob.objects.filter(user=self.request.user).order_by("-created_at")

    def get_serializer_context(self):
        # One job's detail lists what it changed, with covers; the list keeps counts only.
        return {**super().get_serializer_context(), "change_items": self.action == "retrieve"}

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a pending or processing import job (404 for someone else's)."""
        result = cancel_import_job(self.get_object())
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="cancel_import_job_failed",
        )
