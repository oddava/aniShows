from rest_framework.serializers import (
    CharField,
    IntegerField,
    ModelSerializer,
    SerializerMethodField,
)


class UserImportJobSerializer(ModelSerializer):
    """Serializer for import jobs"""

    source_display = CharField(source="get_source_display", read_only=True)
    status_display = CharField(source="get_status_display", read_only=True)
    progress_percentage = IntegerField(read_only=True)
    changes = SerializerMethodField()

    class Meta:
        from ...users.models import UserImportJob

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
            "failure_reason",
            "unmatched",
            "changes",
            "mode",
            "heartbeat_at",
            "source_identifier",
            "created_at",
            "started_at",
            "completed_at",
        ]
        read_only_fields = fields

    def get_changes(self, obj):
        """Counts always; the records (each with its anime) only when the view asks.

        The list leaves them out (one query per job otherwise); one job's detail has them.
        Jobs from before change records give ``{"added": None, "updated": None}``.
        """
        stored = obj.changes or {}
        payload = {"added": stored.get("added"), "updated": stored.get("updated")}
        if not self.context.get("change_items"):
            return payload
        from ..models import Anime
        from .anime import AnimeCompactSerializer

        items = stored.get("items") or []
        ids = {item.get("anime_id") for item in items}
        # Whole rows: the cover thumbnail is an ImageKit spec, not a column `only()` takes.
        anime = {row.id: row for row in Anime.objects.filter(id__in=ids)}
        compact = AnimeCompactSerializer(context=self.context)
        payload["items"] = [
            {**item, "anime": compact.to_representation(anime[item["anime_id"]])}
            for item in items
            if item.get("anime_id") in anime
        ]
        return payload
