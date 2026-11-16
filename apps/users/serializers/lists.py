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

__all__ = [
    "UserActivitySerializer",
    "UserAnimeListSerializer",
]


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

    def validate(self, attrs):
        if self.instance:
            # An entry belongs to one anime; re-pointing it would collide with
            # another entry or detach the user's review from their list.
            attrs.pop("anime", None)
        else:
            if "anime" not in attrs:
                raise ValidationError({"anime_id": "This field is required."})
            # The model has no default; never store an empty status.
            attrs.setdefault("status", UserAnimeList.UserAnimeStatus.plan_to_watch)

        episodes_watched = attrs.get("episodes_watched")
        anime = attrs.get("anime")
        status = attrs.get("status")
        started_at = attrs.get("started_at")
        finished_at = attrs.get("finished_at")

        if not anime and self.instance:
            anime = self.instance.anime
        if started_at is None and self.instance:
            started_at = self.instance.started_at
        if finished_at is None and self.instance:
            finished_at = self.instance.finished_at

        if episodes_watched is not None and episodes_watched < 0:
            raise ValidationError({"episodes_watched": "Episodes watched cannot be negative."})

        if episodes_watched is not None and anime and anime.episode_count > 0:
            if episodes_watched > anime.episode_count:
                raise ValidationError(
                    {
                        "episodes_watched": f"Episodes watched cannot exceed total episodes ({anime.episode_count})."
                    }
                )

            if episodes_watched == anime.episode_count:
                attrs["status"] = UserAnimeList.UserAnimeStatus.completed

        if status == UserAnimeList.UserAnimeStatus.completed and anime and anime.episode_count > 0:
            attrs["episodes_watched"] = anime.episode_count

        if started_at and finished_at and finished_at < started_at:
            raise ValidationError({"finished_at": "Finish date cannot be earlier than start date."})

        return attrs


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
            if obj.old_episodes is not None and obj.new_episodes is not None:
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
