from rest_framework.fields import IntegerField, FloatField, SerializerMethodField
from rest_framework.serializers import ModelSerializer

from apps.animes.models import Anime, Genre, Studio, Review

class AdminGenreSerializer(ModelSerializer):
    anime_count = IntegerField(read_only=True, default=0)

    class Meta:
        model = Genre
        fields = ["id", "name", "slug", "description", "anime_count"]


class AdminStudioSerializer(ModelSerializer):
    anime_count = IntegerField(read_only=True, default=0)

    class Meta:
        model = Studio
        fields = ["id", "name", "founded_date", "website", "anime_count"]


class AdminAnimeSerializer(ModelSerializer):
    favorites_count = IntegerField(read_only=True, default=0)
    reviews_count = IntegerField(read_only=True, default=0)
    avg_review_rating = FloatField(read_only=True, default=None)
    
    studio = AdminStudioSerializer(read_only=True)
    genres = AdminGenreSerializer(many=True, read_only=True)
    
    cover_image = SerializerMethodField()
    banner_image = SerializerMethodField()

    class Meta:
        model = Anime
        fields = [
            "id", "title", "title_jp", "slug", "synopsis", "status", "anime_type",
            "rating", "episode_count", "duration_minutes", "release_date", "end_date",
            "cover_image", "banner_image", "trailer_url", "studio", "genres",
            "meta_description", "favorites_count", "reviews_count", "avg_review_rating",
            "created_at", "updated_at"
        ]

    def get_cover_image(self, obj):
        if obj.cover_image:
            try:
                return obj.cover_image.url
            except ValueError:
                return None
        return None

    def get_banner_image(self, obj):
        if obj.banner_image:
            try:
                return obj.banner_image.url
            except ValueError:
                return None
        return None


class AdminReviewSerializer(ModelSerializer):
    user = SerializerMethodField()
    anime = SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            "id", "user", "anime", "rating", "text", "has_spoilers", 
            "created_at", "updated_at"
        ]

    def get_user(self, obj):
        return {
            "id": obj.user.id,
            "username": obj.user.username,
        }

    def get_anime(self, obj):
        return {
            "id": obj.anime.id,
            "title": obj.anime.title,
            "slug": obj.anime.slug,
        }
