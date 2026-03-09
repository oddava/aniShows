from rest_framework.serializers import CharField, IntegerField, ModelSerializer


class UserImportJobSerializer(ModelSerializer):
    """Serializer for import jobs"""

    source_display = CharField(source="get_source_display", read_only=True)
    status_display = CharField(source="get_status_display", read_only=True)
    progress_percentage = IntegerField(read_only=True)

    class Meta:
        from apps.users.models import UserImportJob

        model = UserImportJob
        fields = [
            "id",
            "source",
            "source_display",
            "status",
            "status_display",
            "total_entries",
            "processed_entries",
            "imported_entries",
            "skipped_entries",
            "failed_entries",
            "fetched_entries",
            "progress_percentage",
            "errors",
            "source_identifier",
            "created_at",
            "started_at",
            "completed_at",
        ]
        read_only_fields = fields
