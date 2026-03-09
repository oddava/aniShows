from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils.html import escape
from rest_framework.serializers import (
    BooleanField,
    CharField,
    IntegerField,
    ModelSerializer,
    SerializerMethodField,
    SlugRelatedField,
)

from apps.animes.models import Anime, Review, ReviewComment
from apps.animes.serializers.anime import AnimeListSerializer
from apps.animes.serializers_mixins import UserProfileMixin

User = get_user_model()

MAX_REVIEW_LENGTH = getattr(settings, "MAX_REVIEW_LENGTH", 5000)
MAX_COMMENT_LENGTH = getattr(settings, "MAX_COMMENT_LENGTH", 2000)

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
    user_vote = SerializerMethodField()
    comment_count = IntegerField(read_only=True, source="_comment_count")

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
            "user_vote",
            "comment_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "anime", "created_at", "updated_at"]

    def validate_text(self, value):
        """Sanitize review text to prevent XSS."""
        if value:
            return escape(value)
        return value

    def get_user_vote(self, obj):
        """Use the annotated _user_vote field to avoid N+1 queries."""
        if hasattr(obj, "_user_vote"):
            return obj._user_vote if obj._user_vote else None

        request = self.context.get("request")
        if request and request.user.is_authenticated:
            vote = obj.votes.filter(user=request.user).first()
            if vote:
                return vote.is_helpful
        return None


class ReviewCommentSerializer(ModelSerializer):
    """Serializer for review comments with soft delete support"""

    user = ReviewUserSerializer(read_only=True)
    text = CharField(required=True, allow_blank=False, max_length=MAX_COMMENT_LENGTH)
    is_owner = SerializerMethodField()
    can_delete = SerializerMethodField()

    class Meta:
        model = ReviewComment
        fields = [
            "id",
            "user",
            "text",
            "is_deleted",
            "is_owner",
            "can_delete",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "is_deleted", "created_at", "updated_at"]

    def validate_text(self, value):
        """Sanitize comment text to prevent XSS."""
        if value:
            return escape(value.strip())
        return value

    def get_is_owner(self, obj):
        """Check if current user is the comment author"""
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.user == request.user
        return False

    def get_can_delete(self, obj):
        """Check if current user can delete this comment

        Users can delete their own comments, and review owners can delete
        any comments on their reviews.
        """
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False

        if obj.user == request.user:
            return True

        return obj.review.user == request.user
