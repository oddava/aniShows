from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils.html import escape
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
from .anime import AnimeListSerializer

User = get_user_model()

MAX_REVIEW_LENGTH = getattr(settings, "MAX_REVIEW_LENGTH", 5000)

REACTION_EMOJI_MAP = {
    ReviewReaction.ReactionType.THUMBS_UP: "👍",
    ReviewReaction.ReactionType.HEART: "❤️",
    ReviewReaction.ReactionType.LAUGH: "😂",
    ReviewReaction.ReactionType.SURPRISED: "😮",
    ReviewReaction.ReactionType.SAD: "😢",
}

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


class ReviewSerializer(ModelSerializer):
    user = ReviewUserSerializer(read_only=True)
    anime = AnimeListSerializer(read_only=True)
    anime_slug = SlugRelatedField(
        slug_field="slug", queryset=Anime.objects.all(), source="anime", write_only=True
    )
    has_spoilers = BooleanField(default=False, required=False)
    text = CharField(required=False, allow_blank=True, max_length=MAX_REVIEW_LENGTH)

    is_completed = BooleanField(read_only=True, source="_is_completed")
    helpful_count = IntegerField(read_only=True, source="_helpful_count")
    dislike_count = IntegerField(read_only=True, source="_dislike_count")
    user_votes = SerializerMethodField()
    reactions = SerializerMethodField()

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

    def validate_text(self, value):
        """Sanitize review text to prevent XSS."""
        if value:
            return escape(value)
        return value

    def get_user_votes(self, obj):
        helpful_attr = getattr(obj, "_user_helpful_vote", None)
        dislike_attr = getattr(obj, "_user_dislike_vote", None)

        if helpful_attr is not None and dislike_attr is not None:
            return {
                "helpful": helpful_attr,
                "dislike": dislike_attr,
            }

        return {
            "helpful": False,
            "dislike": False,
        }

    def get_reactions(self, obj):
        reactions = []
        for reaction_type in ReviewReaction.ReactionType.values:
            count = getattr(obj, f"_reaction_count_{reaction_type}", None)
            if count is None:
                count = 0

            active = getattr(obj, f"_reaction_active_{reaction_type}", None)
            if active is None:
                active = False

            reactions.append(
                {
                    "type": reaction_type,
                    "emoji": REACTION_EMOJI_MAP[reaction_type],
                    "count": count,
                    "active": active,
                }
            )

        return reactions


class ReviewReportCreateSerializer(Serializer):
    reason = ChoiceField(choices=ReviewReport.Reason.choices)
    description = CharField(required=False, allow_blank=True, max_length=500)


class ReviewVoteActionSerializer(Serializer):
    vote_type = ChoiceField(choices=ReviewVote.VoteType.choices)


class ReviewReactionActionSerializer(Serializer):
    reaction_type = ChoiceField(choices=ReviewReaction.ReactionType.choices)
