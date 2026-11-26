"""List entry and activity serializers (G3 Lists & AniList sync)."""

from rest_framework.exceptions import ValidationError
from rest_framework.serializers import (
    CharField,
    ChoiceField,
    DateField,
    IntegerField,
    ModelSerializer,
    PrimaryKeyRelatedField,
    SerializerMethodField,
)

from ...animes.models import (
    Anime,
)
from ...animes.serializers.anime import (
    AnimeListSerializer,
    AnimeMinimalSerializer,
)
from ..models import UserActivity, UserAnimeList
from ..services.list_rules import ListRuleError, normalize_entry, user_today

STATUS_ALIASES = {
    "watching": UserAnimeList.UserAnimeStatus.watching,
    "completed": UserAnimeList.UserAnimeStatus.completed,
    "on_hold": UserAnimeList.UserAnimeStatus.on_hold,
    "dropped": UserAnimeList.UserAnimeStatus.dropped,
    "plan_to_watch": UserAnimeList.UserAnimeStatus.plan_to_watch,
}

__all__ = [
    "UserActivitySerializer",
    "UserAnimeListSerializer",
]


def _is_owner(serializer, obj) -> bool:
    """Whether the request's user owns ``obj`` (a list entry or activity row)."""
    request = serializer.context.get("request")
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated and obj.user_id == user.id)


def _drop_private_notes(serializer, obj, data):
    """Personal notes are owner-only (ANISHOWS-004).

    A public profile shows its list and activity to anyone, but the free-text
    notes on an entry are the owner's own: other viewers, signed in or not,
    get the rest of the row without them.
    """
    if "notes" in data and not _is_owner(serializer, obj):
        data.pop("notes")
    return data


class UserAnimeListSerializer(ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = PrimaryKeyRelatedField(
        queryset=Anime.objects.all(),
        source="anime",
        write_only=True,
        required=False,
    )
    status = ChoiceField(choices=UserAnimeList.UserAnimeStatus.choices, required=False)
    score = IntegerField(required=False, min_value=0, max_value=10)
    episodes_watched = IntegerField(required=False, min_value=0)
    notes = CharField(required=False, allow_blank=True)
    started_at = DateField(required=False, allow_null=True)
    finished_at = DateField(required=False, allow_null=True)
    total_rewatches = IntegerField(required=False, min_value=0)
    progress = SerializerMethodField()

    class Meta:
        model = UserAnimeList
        fields = [
            "id",
            "anime",
            "anime_id",
            "status",
            "score",
            "episodes_watched",
            "notes",
            "started_at",
            "finished_at",
            "total_rewatches",
            "is_rewatching",
            "progress",
            "updated_at",
        ]

    def get_progress(self, obj):
        if obj.anime.episode_count and obj.anime.episode_count > 0:
            return int((obj.episodes_watched / obj.anime.episode_count) * 100)
        return 0

    def to_representation(self, instance):
        return _drop_private_notes(self, instance, super().to_representation(instance))

    def to_internal_value(self, data):
        # P2-1: accept the snake_case keys (``plan_to_watch``) the frontend uses
        # elsewhere; the stored and returned values stay the display strings.
        status = data.get("status") if hasattr(data, "get") else None
        if isinstance(status, str) and status in STATUS_ALIASES:
            data = data.copy()
            data["status"] = STATUS_ALIASES[status]
        return super().to_internal_value(data)

    def validate(self, attrs):
        if self.instance:
            # An entry belongs to one anime; re-pointing it would collide with
            # another entry or detach the user's review from their list.
            attrs.pop("anime", None)
            anime = self.instance.anime
        else:
            if "anime" not in attrs:
                raise ValidationError({"anime_id": "This field is required."})
            anime = attrs["anime"]

        request = self.context.get("request")
        today = user_today(getattr(request, "user", None))
        try:
            return normalize_entry(self.instance, attrs, anime, today, strict=True)
        except ListRuleError as exc:
            raise ValidationError({exc.field: exc.message}) from exc


class UserActivitySerializer(ModelSerializer):
    """Serializer for user activity feed entries."""

    anime = AnimeMinimalSerializer(read_only=True)
    activity_description = SerializerMethodField()

    class Meta:
        model = UserActivity
        fields = [
            "id",
            "anime",
            "activity_type",
            "activity_description",
            "old_status",
            "new_status",
            "old_episodes",
            "new_episodes",
            "old_score",
            "new_score",
            "notes",
            "created_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        return _drop_private_notes(self, instance, super().to_representation(instance))

    def get_activity_description(self, obj):
        """Generate human-readable activity description."""
        title = obj.anime.title if obj.anime else "Unknown"
        at = UserActivity.ActivityType

        if obj.activity_type == at.COMPLETED:
            desc = f"Completed {title}"
            if obj.new_score:
                desc += f" and rated it {obj.new_score}/10"
            return desc

        if obj.activity_type == at.ADDED:
            status_label = obj.new_status or "list"
            return f"Added {title} to {status_label}"

        if obj.activity_type == at.PROGRESS:
            if (
                obj.old_episodes is not None
                and obj.new_episodes is not None
                and obj.new_episodes > obj.old_episodes
            ):
                if obj.new_episodes - obj.old_episodes == 1:
                    return f"Watched episode {obj.new_episodes} of {title}"
                return f"Watched episodes {obj.old_episodes + 1}-{obj.new_episodes} of {title}"
            return f"Updated progress on {title}"

        if obj.activity_type == at.STATUS_CHANGE:
            return f"Changed {title} from {obj.old_status} to {obj.new_status}"

        if obj.activity_type == at.SCORE_CHANGE:
            return f"Rated {title} {obj.new_score}/10"

        if obj.activity_type == at.REMOVED:
            return f"Removed {title} from list"

        if obj.activity_type == at.REWATCHING:
            return f"Started rewatching {title}"

        if obj.activity_type == at.NOTES_UPDATE:
            return f"Updated notes for {title}"

        return f"Updated {title}"
