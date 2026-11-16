from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError
from rest_framework.serializers import (
    BooleanField,
    CharField,
    ChoiceField,
    IntegerField,
    ModelSerializer,
    Serializer,
    SerializerMethodField,
    SlugRelatedField,
)

from ..models import Anime, Review, ReviewReaction, ReviewReport, ReviewVote
from ..serializers_mixins import UserProfileMixin
from .anime import AnimeCompactSerializer, AnimeListSerializer

User = get_user_model()

MAX_REVIEW_LENGTH = settings.MAX_REVIEW_LENGTH
ANIME_IMMUTABLE_MESSAGE = "A review cannot be moved to another anime."

REACTION_EMOJI_MAP = {
    ReviewReaction.ReactionType.THUMBS_UP: "👍",
    ReviewReaction.ReactionType.HEART: "❤️",
    ReviewReaction.ReactionType.LAUGH: "😂",
    ReviewReaction.ReactionType.SURPRISED: "😮",
    ReviewReaction.ReactionType.SAD: "😢",
}


def wants_compact_anime(query_params) -> bool:
    """A per-anime listing (``?anime=<slug>``) nests the compact anime shape."""
    return bool(query_params.get("anime"))


class ReviewUserSerializer(UserProfileMixin, ModelSerializer):
    """Lightweight user serializer for reviews
    queries that the full UserSerializer would trigger when user objects
    are not annotated with _followers_count, _anime_count, etc.
    """

    avatar = SerializerMethodField()
    points = SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "avatar", "points"]
        read_only_fields = fields


class ReviewInteractionStateSerializer(Serializer):
    """Vote and reaction counts plus the viewer's state, read from queryset annotations."""

    helpful_count = IntegerField(read_only=True, source="_helpful_count")
    dislike_count = IntegerField(read_only=True, source="_dislike_count")
    user_votes = SerializerMethodField()
    reactions = SerializerMethodField()

    def get_user_votes(self, obj) -> dict[str, bool]:
        return {
            "helpful": bool(getattr(obj, "_user_helpful_vote", False)),
            "dislike": bool(getattr(obj, "_user_dislike_vote", False)),
        }

    def get_reactions(self, obj) -> list[dict]:
        return [
            {
                "type": reaction_type,
                "emoji": REACTION_EMOJI_MAP[reaction_type],
                "count": getattr(obj, f"_reaction_count_{reaction_type}", None) or 0,
                "active": bool(getattr(obj, f"_reaction_active_{reaction_type}", False)),
            }
            for reaction_type in ReviewReaction.ReactionType.values
        ]


class ReviewSerializer(ReviewInteractionStateSerializer, ModelSerializer):
    user = ReviewUserSerializer(read_only=True)
    anime = AnimeListSerializer(read_only=True)
    anime_slug = SlugRelatedField(
        slug_field="slug", queryset=Anime.objects.all(), source="anime", write_only=True
    )
    has_spoilers = BooleanField(default=False, required=False)
    text = CharField(required=False, allow_blank=True, max_length=MAX_REVIEW_LENGTH)

    is_completed = BooleanField(read_only=True, source="_is_completed")

    class Meta:
        model = Review
        fields = [
            "id",
            "user",
            "anime",
            "anime_slug",
            "rating",
            "rating_story",
            "rating_animation",
            "rating_music",
            "rating_characters",
            "text",
            "has_spoilers",
            "is_completed",
            "helpful_count",
            "dislike_count",
            "user_votes",
            "reactions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "anime", "created_at", "updated_at"]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request is not None and wants_compact_anime(request.query_params):
            fields["anime"] = AnimeCompactSerializer(read_only=True)
        return fields

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is not None and "anime" in attrs:
            if attrs["anime"].pk != self.instance.anime_id:
                raise ValidationError({"anime_slug": ANIME_IMMUTABLE_MESSAGE})
            del attrs["anime"]
        return attrs


class ReviewReportCreateSerializer(Serializer):
    reason = ChoiceField(choices=ReviewReport.Reason.choices)
    description = CharField(required=False, allow_blank=True, max_length=500)


class ReviewVoteActionSerializer(Serializer):
    vote_type = ChoiceField(choices=ReviewVote.VoteType.choices)


class ReviewReactionActionSerializer(Serializer):
    reaction_type = ChoiceField(choices=ReviewReaction.ReactionType.choices)
