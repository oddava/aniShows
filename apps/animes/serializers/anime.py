from decimal import Decimal

from rest_framework.serializers import (
    BooleanField,
    CharField,
    DecimalField,
    IntegerField,
    ModelSerializer,
    Serializer,
    SerializerMethodField,
    ValidationError,
)

from apps.animes.models import Anime
from apps.animes.serializers.base import (
    GenreSerializer,
    StudioSerializer,
    ThemeSongSerializer,
)
from apps.animes.serializers_mixins import ImageUrlMixin, UserStatusMixin


class AnimeWatchEpisodeSerializer(Serializer):
    number = IntegerField()
    title = CharField()
    aired = CharField(allow_blank=True, allow_null=True)
    thumbnail = CharField(allow_blank=True)
    crunchyroll_url = CharField()
    has_real_crunchyroll_url = BooleanField()
    average_rating = DecimalField(max_digits=4, decimal_places=2, allow_null=True, required=False)
    rating_count = IntegerField(required=False)
    user_rating = DecimalField(max_digits=2, decimal_places=1, allow_null=True, required=False)


class EpisodeRatingSummarySerializer(Serializer):
    episode_number = IntegerField()
    average_rating = DecimalField(max_digits=4, decimal_places=2, allow_null=True)
    rating_count = IntegerField()
    user_rating = DecimalField(max_digits=2, decimal_places=1, allow_null=True)


class EpisodeRatingInputSerializer(Serializer):
    rating = DecimalField(max_digits=2, decimal_places=1, min_value=Decimal("0.5"), max_value=Decimal("5.0"))

    def validate_rating(self, value):
        if (value * 2) % 1 != 0:
            raise ValidationError("Rating must use 0.5 increments.")
        return value


class AnimeMinimalSerializer(UserStatusMixin, ImageUrlMixin, ModelSerializer):
    """Minimal serializer for list views - excludes synopsis for smaller payload"""

    genres = GenreSerializer(many=True, read_only=True)
    studio_name = CharField(source="studio.name", read_only=True, default=None)
    is_favorite = SerializerMethodField()
    user_list_status = SerializerMethodField()
    cover_image = SerializerMethodField()
    cover_image_small = SerializerMethodField()
    cover_image_medium = SerializerMethodField()

    class Meta:
        model = Anime
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "cover_image",
            "cover_image_small",
            "cover_image_medium",
            "cover_image_external_url",
            "banner_image_external_url",
            "rating",
            "episode_count",
            "anime_type",
            "status",
            "genres",
            "studio_name",
            "is_favorite",
            "user_list_status",
            "release_date",
            "next_airing_episode",
            "next_airing_date",
        ]

    def get_cover_image_small(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_small", "cover_image", "cover_image_external_url"
        )

    def get_cover_image(self, obj):
        return self.get_image_url(obj, "cover_image", "cover_image_external_url")

    def get_cover_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_medium", "cover_image", "cover_image_external_url"
        )


class AnimeListSerializer(UserStatusMixin, ImageUrlMixin, ModelSerializer):
    """Lightweight serializer for lists with synopsis"""

    genres = GenreSerializer(many=True, read_only=True)
    studio_name = CharField(source="studio.name", read_only=True, default=None)
    is_favorite = SerializerMethodField()
    user_list_status = SerializerMethodField()
    cover_image = SerializerMethodField()
    cover_image_small = SerializerMethodField()
    cover_image_medium = SerializerMethodField()
    banner_image = SerializerMethodField()
    banner_image_small = SerializerMethodField()
    banner_image_medium = SerializerMethodField()

    class Meta:
        model = Anime
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "cover_image",
            "cover_image_small",
            "cover_image_medium",
            "cover_image_external_url",
            "banner_image",
            "banner_image_small",
            "banner_image_medium",
            "banner_image_external_url",
            "rating",
            "episode_count",
            "anime_type",
            "status",
            "genres",
            "studio_name",
            "is_favorite",
            "user_list_status",
            "synopsis",
            "release_date",
            "next_airing_episode",
            "next_airing_date",
        ]

    def get_cover_image_small(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_small", "cover_image", "cover_image_external_url"
        )

    def get_cover_image(self, obj):
        return self.get_image_url(obj, "cover_image", "cover_image_external_url")

    def get_cover_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_medium", "cover_image", "cover_image_external_url"
        )

    def get_banner_image(self, obj):
        return self.get_image_url(obj, "banner_image", "banner_image_external_url")

    def get_banner_image_small(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "banner_image_small", "banner_image", "banner_image_external_url"
        )

    def get_banner_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "banner_image_medium", "banner_image", "banner_image_external_url"
        )


class AnimeDetailSerializer(UserStatusMixin, ImageUrlMixin, ModelSerializer):
    """Full serializer for detail page"""

    genres = GenreSerializer(many=True, read_only=True)
    studio = StudioSerializer(read_only=True)
    character_count = IntegerField(read_only=True)
    staff_count = IntegerField(read_only=True)
    theme_songs = ThemeSongSerializer(many=True, read_only=True)

    is_favorite = SerializerMethodField()
    user_list_status = SerializerMethodField()
    user_review = SerializerMethodField()
    review_count = IntegerField(read_only=True)
    avg_rating = DecimalField(max_digits=3, decimal_places=1, read_only=True)
    status_distribution = SerializerMethodField()
    cover_image = SerializerMethodField()
    cover_image_small = SerializerMethodField()
    cover_image_medium = SerializerMethodField()
    cover_image_large = SerializerMethodField()
    banner_image = SerializerMethodField()
    banner_image_small = SerializerMethodField()
    banner_image_medium = SerializerMethodField()
    banner_image_large = SerializerMethodField()

    class Meta:
        model = Anime
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "synopsis",
            "cover_image",
            "cover_image_small",
            "cover_image_medium",
            "cover_image_large",
            "cover_image_external_url",
            "banner_image",
            "banner_image_small",
            "banner_image_medium",
            "banner_image_large",
            "banner_image_external_url",
            "trailer_url",
            "rating",
            "episode_count",
            "duration_minutes",
            "anime_type",
            "status",
            "release_date",
            "end_date",
            "genres",
            "studio",
            "character_count",
            "staff_count",
            "external_links",
            "relations",
            "tags",
            "site_rank",
            "popularity_rank",
            "is_favorite",
            "user_list_status",
            "user_review",
            "review_count",
            "avg_rating",
            "created_at",
            "next_airing_episode",
            "next_airing_date",
            "status_distribution",
            "member_count",
            "source_material",
            "season",
            "season_year",
            "theme_songs",
        ]

    def get_cover_image_small(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_small", "cover_image", "cover_image_external_url"
        )

    def get_cover_image(self, obj):
        return self.get_image_url(obj, "cover_image", "cover_image_external_url")

    def get_cover_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_medium", "cover_image", "cover_image_external_url"
        )

    def get_cover_image_large(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_large", "cover_image", "cover_image_external_url"
        )

    def get_banner_image(self, obj):
        return self.get_image_url(obj, "banner_image", "banner_image_external_url")

    def get_banner_image_small(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "banner_image_small", "banner_image", "banner_image_external_url"
        )

    def get_banner_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "banner_image_medium", "banner_image", "banner_image_external_url"
        )

    def get_banner_image_large(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "banner_image_large", "banner_image", "banner_image_external_url"
        )

    def get_user_review(self, obj):
        if hasattr(obj, "_user_review"):
            return obj._user_review
        return None

    def get_status_distribution(self, obj):
        """Return the denormalized site list counts stored on the anime record."""
        if not obj.pk:
            return {
                "watching": 0,
                "completed": 0,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 0,
            }

        distribution = getattr(obj, "status_distribution", None)
        if not isinstance(distribution, dict):
            distribution = {}

        return {
            key: int(distribution.get(key, 0) or 0)
            for key in ("watching", "completed", "on_hold", "dropped", "plan_to_watch")
        }

class AnimeCompactSerializer(ImageUrlMixin, ModelSerializer):
    """Ultra-minimal serializer for displaying basic anime info (e.g. thumbnails)"""

    cover_image = SerializerMethodField()
    cover_image_small = SerializerMethodField()

    class Meta:
        model = Anime
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "cover_image",
            "cover_image_small",
            "rating",
        ]

    def get_cover_image_small(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_small", "cover_image", "cover_image_external_url"
        )

    def get_cover_image(self, obj):
        return self.get_image_url(obj, "cover_image", "cover_image_external_url")
