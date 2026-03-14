from rest_framework.fields import FloatField, IntegerField, SerializerMethodField
from rest_framework.serializers import ModelSerializer

from apps.animes.models import Anime, Character, Genre, Review, Staff, Studio


class AdminGenreSerializer(ModelSerializer):
    """Admin serializer for anime genres."""

    anime_count = IntegerField(read_only=True, default=0)

    class Meta:
        """Meta configuration for AdminGenreSerializer."""

        model = Genre
        fields = ["id", "name", "slug", "description", "anime_count"]


class AdminStudioSerializer(ModelSerializer):
    """Admin serializer for anime studios."""

    anime_count = IntegerField(read_only=True, default=0)

    class Meta:
        """Meta configuration for AdminStudioSerializer."""

        model = Studio
        fields = ["id", "name", "founded_date", "website", "anime_count"]


class AdminAnimeSerializer(ModelSerializer):
    """Admin serializer for anime."""

    favorites_count = IntegerField(read_only=True, default=0)
    reviews_count = IntegerField(read_only=True, default=0)
    avg_review_rating = FloatField(read_only=True, default=None)

    studio = AdminStudioSerializer(read_only=True)
    genres = AdminGenreSerializer(many=True, read_only=True)

    cover_image = SerializerMethodField()
    banner_image = SerializerMethodField()

    class Meta:
        """Meta configuration for AdminAnimeSerializer."""

        model = Anime
        fields = [
            "id", "title", "title_jp", "slug", "synopsis", "status", "anime_type",
            "rating", "episode_count", "duration_minutes", "release_date", "end_date",
            "cover_image", "banner_image", "trailer_url", "studio", "genres",
            "meta_description", "favorites_count", "reviews_count", "avg_review_rating",
            "created_at", "updated_at"
        ]

    def get_cover_image(self, obj):
        """Get cover image URL."""
        if obj.cover_image:
            try:
                return obj.cover_image.url
            except ValueError:
                return None
        return None

    def get_banner_image(self, obj):
        """Get banner image URL."""
        if obj.banner_image:
            try:
                return obj.banner_image.url
            except ValueError:
                return None
        return None


class AdminReviewSerializer(ModelSerializer):
    """Admin serializer for anime reviews."""

    user = SerializerMethodField()
    anime = SerializerMethodField()

    class Meta:
        """Meta configuration for AdminReviewSerializer."""

        model = Review
        fields = [
            "id", "user", "anime", "rating", "text", "has_spoilers",
            "created_at", "updated_at"
        ]

    def get_user(self, obj):
        """Get user summary."""
        return {
            "id": obj.user.id,
            "username": obj.user.username,
        }

    def get_anime(self, obj):
        """Get anime summary."""
        return {
            "id": obj.anime.id,
            "title": obj.anime.title,
            "slug": obj.anime.slug,
        }


class AdminCharacterSerializer(ModelSerializer):
    """Admin serializer for characters."""

    anime_count = IntegerField(read_only=True, default=0)
    image = SerializerMethodField()

    class Meta:
        model = Character
        fields = [
            "id",
            "name",
            "name_native",
            "description",
            "anilist_id",
            "image_url",
            "image",
            "anime_count",
        ]

    def get_image(self, obj):
        if obj.image:
            try:
                return obj.image.url
            except ValueError:
                return None
        return obj.image_url or None


class AdminStaffSerializer(ModelSerializer):
    """Admin serializer for staff."""

    anime_count = IntegerField(read_only=True, default=0)
    image = SerializerMethodField()

    class Meta:
        model = Staff
        fields = [
            "id",
            "name",
            "name_native",
            "description",
            "anilist_id",
            "image_url",
            "image",
            "anime_count",
        ]

    def get_image(self, obj):
        if obj.image:
            try:
                return obj.image.url
            except ValueError:
                return None
        return obj.image_url or None
