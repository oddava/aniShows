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

from ..models import Anime
from ..serializers_mixins import ImageUrlMixin, UserStatusMixin
from ..services.jikan import JikanService
from .base import (
    AnimeCharacterSerializer,
    AnimeStaffSerializer,
    GenreSerializer,
    StudioSerializer,
    ThemeSongSerializer,
)


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
    studio_name = CharField(source="primary_studio.name", read_only=True, default=None)
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
            "broadcast_day",
            "broadcast_time",
            "broadcast_timezone",
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
    """Lightweight serializer for browse/list surfaces."""

    genres = GenreSerializer(many=True, read_only=True)
    studio_name = CharField(source="primary_studio.name", read_only=True, default=None)
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
            "rating",
            "episode_count",
            "anime_type",
            "status",
            "genres",
            "studio_name",
            "is_favorite",
            "user_list_status",
            "release_date",
            "broadcast_day",
            "broadcast_time",
            "broadcast_timezone",
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


class AnimeShelfSerializer(AnimeListSerializer):
    """Serializer for shelf surfaces that need hero/banner artwork."""

    synopsis = CharField(read_only=True)
    banner_image = SerializerMethodField()
    banner_image_medium = SerializerMethodField()
    banner_image_large = SerializerMethodField()

    class Meta(AnimeListSerializer.Meta):
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "synopsis",
            "cover_image",
            "cover_image_small",
            "cover_image_medium",
            "cover_image_external_url",
            "banner_image",
            "banner_image_medium",
            "banner_image_large",
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
            "broadcast_day",
            "broadcast_time",
            "broadcast_timezone",
            "next_airing_episode",
            "next_airing_date",
        ]

    def _get_shelf_banner_fallback(self, obj, *, size: str):
        if size == "large":
            return self.get_image_url_with_thumbnail(
                obj,
                "cover_image_large",
                "cover_image",
                "cover_image_external_url",
            )
        if size == "medium":
            return self.get_image_url_with_thumbnail(
                obj,
                "cover_image_medium",
                "cover_image",
                "cover_image_external_url",
            )
        return self.get_image_url(obj, "cover_image", "cover_image_external_url")

    def get_banner_image(self, obj):
        return self.get_image_url(
            obj,
            "banner_image",
            "banner_image_external_url",
        ) or self._get_shelf_banner_fallback(obj, size="original")

    def get_banner_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "banner_image_medium", "banner_image", "banner_image_external_url"
        ) or self._get_shelf_banner_fallback(obj, size="medium")

    def get_banner_image_large(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "banner_image_large", "banner_image", "banner_image_external_url"
        ) or self._get_shelf_banner_fallback(obj, size="large")


class AnimeDetailSerializer(UserStatusMixin, ImageUrlMixin, ModelSerializer):
    """Full serializer for detail page"""

    CHARACTER_PREVIEW_LIMIT = 12
    STAFF_PREVIEW_LIMIT = 3

    genres = GenreSerializer(many=True, read_only=True)
    # "studio" stays the primary studio for older clients; "studios" has the full list.
    studio = StudioSerializer(source="primary_studio", read_only=True)
    studios = StudioSerializer(source="ordered_studios", many=True, read_only=True)
    character_count = IntegerField(read_only=True)
    staff_count = IntegerField(read_only=True)
    theme_songs = ThemeSongSerializer(many=True, read_only=True)

    is_favorite = SerializerMethodField()
    user_list_status = SerializerMethodField()
    user_review = SerializerMethodField()
    review_count = IntegerField(read_only=True)
    avg_rating = DecimalField(max_digits=3, decimal_places=1, read_only=True)
    status_distribution = SerializerMethodField()
    external_links = SerializerMethodField()
    relations = SerializerMethodField()
    characters_preview = SerializerMethodField()
    staff_preview = SerializerMethodField()
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
            "studios",
            "character_count",
            "staff_count",
            "characters_preview",
            "staff_preview",
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
            "broadcast_day",
            "broadcast_time",
            "broadcast_timezone",
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

    def get_characters_preview(self, obj):
        from ..models import AnimeCharacter

        queryset = (
            AnimeCharacter.objects.filter(anime=obj)
            .select_related("character", "voice_actor")
            .only(
                "id",
                "anime_id",
                "role",
                "character_id",
                "voice_actor_id",
                "character__id",
                "character__name",
                "character__name_native",
                "character__image",
                "character__image_url",
                "voice_actor__id",
                "voice_actor__name",
                "voice_actor__name_native",
                "voice_actor__image",
                "voice_actor__image_url",
            )
            .order_by("role", "character__name")[: self.CHARACTER_PREVIEW_LIMIT]
        )
        return AnimeCharacterSerializer(queryset, many=True).data

    def get_staff_preview(self, obj):
        from ..models import AnimeStaff

        queryset = (
            AnimeStaff.objects.filter(anime=obj)
            .select_related("staff")
            .only(
                "id",
                "anime_id",
                "role",
                "staff_id",
                "staff__id",
                "staff__name",
                "staff__name_native",
                "staff__image",
                "staff__image_url",
            )
            .order_by("id")[: self.STAFF_PREVIEW_LIMIT]
        )
        return AnimeStaffSerializer(queryset, many=True).data

    def get_external_links(self, obj):
        links = []
        seen_urls = set()

        for link in getattr(obj, "external_links", None) or []:
            if not isinstance(link, dict):
                continue

            site = str(link.get("site") or "").strip()
            url = str(link.get("url") or "").strip()
            if not site or not url or url in seen_urls:
                continue

            seen_urls.add(url)
            links.append(
                {
                    "site": site,
                    "url": url,
                    "icon": str(link.get("icon") or "").strip(),
                }
            )

        has_banner_ref = bool(getattr(obj, "banner_image", None) or obj.banner_image_external_url)
        if len(links) == 1 and links[0]["site"].lower() == "myanimelist" and not has_banner_ref:
            return []

        return links

    def get_relations(self, obj):
        if "relations" in getattr(obj, "_prefetched_objects_cache", {}):
            rows = obj.relations.all()
        else:
            rows = Anime.relations_prefetch().queryset.filter(from_anime=obj)

        relations = []
        for relation in rows:
            linked = relation.to_anime
            cover = JikanService.normalize_external_image_url(relation.cover)
            if not cover and linked is not None:
                cover = self.get_image_url(linked, "cover_image", "cover_image_external_url")
            relations.append(
                {
                    "id": relation.target_anilist_id or (linked and linked.anilist_id),
                    "mal_id": relation.target_mal_id or (linked and linked.mal_id),
                    "type": relation.relation_type or None,
                    "title": relation.title,
                    "format": relation.format or None,
                    "status": relation.status or None,
                    "cover": cover or "",
                    "slug": linked.slug if linked is not None else None,
                }
            )
        return relations

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
