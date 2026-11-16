"""Import/export routes (G3): list imports, import jobs, data export."""

from django.urls import path

from ..views.import_export import (
    ImportExportViewSet,
    UserImportJobViewSet,
)

urlpatterns = [
    # Import/Export Routes
    path("import/mal/", ImportExportViewSet.as_view({"post": "import_mal"}), name="import_mal"),
    path(
        "import/mal/xml/",
        ImportExportViewSet.as_view({"post": "import_mal_xml"}),
        name="import_mal_xml",
    ),
    path(
        "import/anilist/",
        ImportExportViewSet.as_view({"post": "import_anilist"}),
        name="import_anilist",
    ),
    path(
        "export/", ImportExportViewSet.as_view({"get": "export_user_data"}), name="export_user_data"
    ),
    path(
        "export/json/",
        ImportExportViewSet.as_view({"get": "export_user_data"}),
        name="export_user_data_json",
    ),
    # User Import Jobs
    path("import/jobs/", UserImportJobViewSet.as_view({"get": "list"}), name="import_jobs"),
    path(
        "import/jobs/<int:pk>/",
        UserImportJobViewSet.as_view({"get": "retrieve"}),
        name="import_job_status",
    ),
    path(
        "import/jobs/<int:pk>/cancel/",
        UserImportJobViewSet.as_view({"post": "cancel"}),
        name="import_job_cancel",
    ),
]
