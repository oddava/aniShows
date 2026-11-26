from rest_framework.fields import CharField, FloatField, IntegerField, SerializerMethodField
from rest_framework.serializers import ModelSerializer
from rest_framework.validators import UniqueValidator

from ..admin_api.services.media import poster_url
from ..admin_api.services.slugs import unique_slug
from .models import (
    Anime,
    Character,
    Genre,
    OfflineAnimeSyncState,
    Review,
    Staff,
    Studio,
)


class AdminGenreSerializer(ModelSerializer):
    """Admin serializer for anime genres. A blank slug is made from the name."""

    anime_count = IntegerField(read_only=True, default=0)
    slug = CharField(max_length=50, required=False, allow_blank=True)

    class Meta:
        """Meta configuration for AdminGenreSerializer."""

        model = Genre
        fields = ["id", "name", "slug", "description", "anime_count"]
        extra_kwargs = {
            "name": {
                "validators": [
                    UniqueValidator(
                        queryset=Genre.objects.all(),
                        message="A genre with this name already exists.",
                        lookup="iexact",
                    )
                ]
            }
        }

    def validate(self, attrs):
        attrs["slug"] = unique_slug(Genre, self.instance, attrs)
        return attrs


class AdminStudioSerializer(ModelSerializer):
    """Admin serializer for anime studios."""

    anime_count = IntegerField(read_only=True, default=0)

    class Meta:
        """Meta configuration for AdminStudioSerializer."""

        model = Studio
        fields = ["id", "name", "founded_date", "website", "anime_count"]
        extra_kwargs = {
            "name": {
                "validators": [
                    UniqueValidator(
                        queryset=Studio.objects.all(),
                        message="A studio with this name already exists.",
                        lookup="iexact",
                    )
                ]
            }
        }


class AdminAnimeSerializer(ModelSerializer):
    """Admin serializer for anime."""

    poster = SerializerMethodField()
    favorites_count = IntegerField(read_only=True, default=0)
    reviews_count = IntegerField(read_only=True, default=0)
    avg_review_rating = FloatField(read_only=True, default=None)

    studio = AdminStudioSerializer(source="primary_studio", read_only=True)
    genres = AdminGenreSerializer(many=True, read_only=True)

    cover_image = SerializerMethodField()
    banner_image = SerializerMethodField()

    class Meta:
        """Meta configuration for AdminAnimeSerializer."""

        model = Anime
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "synopsis",
            "status",
            "anime_type",
            "rating",
            "episode_count",
            "duration_minutes",
            "release_date",
            "end_date",
            "poster",
            "cover_image",
            "banner_image",
            "trailer_url",
            "studio",
            "genres",
            "meta_description",
            "favorites_count",
            "reviews_count",
            "avg_review_rating",
            "created_at",
            "updated_at",
        ]
        # AniList sync overwrites everything else; only the SEO text is the admin's.
        read_only_fields = [name for name in fields if name != "meta_description"]

    def get_poster(self, obj):
        return poster_url(
            obj.cover_image.name if obj.cover_image else None, obj.cover_image_external_url
        )

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


class AdminAnimeDetailSerializer(AdminAnimeSerializer):
    """One anime with its provider identity, ranks, schedule and sync state."""

    banner = SerializerMethodField()
    studios = SerializerMethodField()
    list_entries_count = IntegerField(read_only=True, default=0)
    sync_state = SerializerMethodField()

    class Meta(AdminAnimeSerializer.Meta):
        fields = [
            *AdminAnimeSerializer.Meta.fields,
            "anilist_id",
            "mal_id",
            "season",
            "season_year",
            "source_material",
            "is_adult",
            "popularity_rank",
            "trending_rank",
            "member_count",
            "cover_image_external_url",
            "banner_image_external_url",
            "banner",
            "next_airing_episode",
            "next_airing_date",
            "metadata_checked_at",
            "list_entries_count",
            "synonyms",
            "external_links",
            "studios",
            "sync_state",
            "meta_description_locked",
        ]
        read_only_fields = [name for name in fields if name != "meta_description"]

    def update(self, instance, validated_data):
        if "meta_description" in validated_data:
            # An admin's text is theirs: syncs stop rewriting it. Empty hands it back.
            text = (validated_data["meta_description"] or "").strip()
            validated_data["meta_description"] = text
            instance.meta_description_locked = bool(text)
        return super().update(instance, validated_data)

    def get_banner(self, obj):
        return poster_url(
            obj.banner_image.name if obj.banner_image else None, obj.banner_image_external_url
        )

    def get_studios(self, obj):
        return [{"id": studio.id, "name": studio.name} for studio in obj.ordered_studios]

    def get_sync_state(self, obj):
        try:
            state = obj.offline_sync_state
        except OfflineAnimeSyncState.DoesNotExist:
            return None
        return {
            "id": state.id,
            "metadata_status": state.metadata_status,
            "franchise_status": state.franchise_status,
            "quarantined": state.quarantined,
            "quarantine_reason": state.quarantine_reason,
            "last_error_code": state.last_error_code,
        }


class AdminReviewSerializer(ModelSerializer):
    """Admin serializer for anime reviews."""

    user = SerializerMethodField()
    anime = SerializerMethodField()
    report_count = IntegerField(read_only=True, default=0)

    class Meta:
        """Meta configuration for AdminReviewSerializer."""

        model = Review
        fields = [
            "id",
            "user",
            "anime",
            "rating",
            "text",
            "has_spoilers",
            "report_count",
            "created_at",
            "updated_at",
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


class AdminOfflineAnimeSyncStateSerializer(ModelSerializer):
    anime = SerializerMethodField()

    class Meta:
        model = OfflineAnimeSyncState
        fields = [
            "id",
            "anime",
            "metadata_status",
            "franchise_status",
            "metadata_attempt_count",
            "franchise_attempt_count",
            "attempt_count",
            "last_attempt_at",
            "next_attempt_at",
            "last_error_code",
            "last_error_message",
            "quarantined",
            "quarantine_reason",
            "quarantine_context",
            "created_at",
            "updated_at",
        ]

    def get_anime(self, obj):
        anime = obj.anime
        return {
            "id": anime.id,
            "title": anime.title,
            "slug": anime.slug,
            "anilist_id": anime.anilist_id,
            "mal_id": anime.mal_id,
        }
