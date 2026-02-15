from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.utils.html import escape
from anime.models import (
    Anime,
    Genre,
    Studio,
    UserFavorite,
    Review,
    ReviewComment,
    Character,
    Staff,
    AnimeCharacter,
    AnimeStaff,
    ThemeSong,
)
from users.models import UserProfile, UserAnimeList
import logging

User = get_user_model()
logger = logging.getLogger(__name__)

# File upload limits
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB
MAX_BANNER_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
MAX_BIO_LENGTH = 1000
MAX_REVIEW_LENGTH = 5000
MAX_COMMENT_LENGTH = 2000


def validate_image_content(file, max_size, field_name):
    """
    Validate image file content for security.
    Checks file size, magic bytes, and image integrity.
    """
    import magic
    from PIL import Image

    # Check file size
    if file.size > max_size:
        raise serializers.ValidationError(
            f"{field_name} file too large. Maximum size is {max_size // (1024 * 1024)}MB."
        )

    # Check magic bytes for actual content type
    file.seek(0)
    magic_bytes = file.read(2048)
    file.seek(0)

    mime = magic.from_buffer(magic_bytes, mime=True)
    if mime not in ALLOWED_IMAGE_TYPES:
        raise serializers.ValidationError(
            f"Invalid file content for {field_name}. Allowed types: JPEG, PNG, WebP, GIF."
        )

    # Verify image can be opened and is not corrupted
    try:
        img = Image.open(file)
        img.verify()  # Verify it's a valid image
        file.seek(0)
    except Exception:
        raise serializers.ValidationError(
            f"Invalid or corrupted image file for {field_name}."
        )

    return file


class GenreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Genre
        fields = ["id", "name", "slug"]


class StudioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Studio
        fields = ["id", "name", "website"]


class CharacterSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    image_small = serializers.SerializerMethodField()
    image_medium = serializers.SerializerMethodField()

    class Meta:
        model = Character
        fields = [
            "id",
            "name",
            "name_native",
            "image",
            "image_small",
            "image_medium",
            "description",
        ]

    def get_image(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return obj.image_url

    def get_image_small(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image_small.url)
            return obj.image_small.url
        return obj.image_url

    def get_image_medium(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image_medium.url)
            return obj.image_medium.url
        return obj.image_url


class StaffSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    image_small = serializers.SerializerMethodField()
    image_medium = serializers.SerializerMethodField()

    class Meta:
        model = Staff
        fields = [
            "id",
            "name",
            "name_native",
            "image",
            "image_small",
            "image_medium",
            "description",
        ]

    def get_image(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return obj.image_url

    def get_image_small(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image_small.url)
            return obj.image_small.url
        return obj.image_url

    def get_image_medium(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image_medium.url)
            return obj.image_medium.url
        return obj.image_url


class AnimeCharacterSerializer(serializers.ModelSerializer):
    character = CharacterSerializer(read_only=True)
    voice_actor = StaffSerializer(read_only=True)

    class Meta:
        model = AnimeCharacter
        fields = ["id", "character", "role", "voice_actor"]


class AnimeStaffSerializer(serializers.ModelSerializer):
    staff = StaffSerializer(read_only=True)

    class Meta:
        model = AnimeStaff
        fields = ["id", "staff", "role"]


class ThemeSongSerializer(serializers.ModelSerializer):
    """Serializer for anime theme songs (openings and endings)"""

    class Meta:
        model = ThemeSong
        fields = [
            "id",
            "song_type",
            "track_number",
            "title",
            "artist",
            "episodes",
            "spotify_url",
            "youtube_url",
        ]


class AnimeMinimalSerializer(serializers.ModelSerializer):
    """Minimal serializer for list views - excludes synopsis for smaller payload"""

    genres = GenreSerializer(many=True, read_only=True)
    studio_name = serializers.CharField(
        source="studio.name", read_only=True, default=None
    )
    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()
    cover_image_small = serializers.SerializerMethodField()
    cover_image_medium = serializers.SerializerMethodField()

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
        if obj.cover_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.cover_image_small.url)
            return obj.cover_image_small.url
        return None

    def get_cover_image_medium(self, obj):
        if obj.cover_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.cover_image_medium.url)
            return obj.cover_image_medium.url
        return None

    def get_is_favorite(self, obj):
        # Use prefetched annotation only - no fallback to avoid N+1
        if hasattr(obj, "_is_favorite"):
            return obj._is_favorite
        return False

    def get_user_list_status(self, obj):
        # Use prefetched list entries only - no fallback to avoid N+1
        if hasattr(obj, "_user_list_entries") and obj._user_list_entries:
            entry = obj._user_list_entries[0]
            return {
                "id": entry.id,
                "status": entry.status,
                "episodes_watched": entry.episodes_watched,
                "progress": (entry.episodes_watched / obj.episode_count * 100)
                if obj.episode_count and obj.episode_count > 0
                else 0,
            }
        return None


class AnimeListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for lists with synopsis"""

    genres = GenreSerializer(many=True, read_only=True)
    studio_name = serializers.CharField(
        source="studio.name", read_only=True, default=None
    )
    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()
    cover_image_small = serializers.SerializerMethodField()
    cover_image_medium = serializers.SerializerMethodField()
    banner_image_small = serializers.SerializerMethodField()
    banner_image_medium = serializers.SerializerMethodField()

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
            "banner_image",
            "banner_image_small",
            "banner_image_medium",
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
        if obj.cover_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.cover_image_small.url)
            return obj.cover_image_small.url
        return None

    def get_cover_image_medium(self, obj):
        if obj.cover_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.cover_image_medium.url)
            return obj.cover_image_medium.url
        return None

    def get_banner_image_small(self, obj):
        if obj.banner_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.banner_image_small.url)
            return obj.banner_image_small.url
        return None

    def get_banner_image_medium(self, obj):
        if obj.banner_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.banner_image_medium.url)
            return obj.banner_image_medium.url
        return None

    def get_is_favorite(self, obj):
        # Use prefetched annotation only - no fallback to avoid N+1
        if hasattr(obj, "_is_favorite"):
            return obj._is_favorite
        return False

    def get_user_list_status(self, obj):
        # Use prefetched list entries only - no fallback to avoid N+1
        if hasattr(obj, "_user_list_entries") and obj._user_list_entries:
            entry = obj._user_list_entries[0]
            return {
                "id": entry.id,
                "status": entry.status,
                "score": entry.score,
                "episodes_watched": entry.episodes_watched,
                "progress": (entry.episodes_watched / obj.episode_count * 100)
                if obj.episode_count and obj.episode_count > 0
                else 0,
            }
        return None


class AnimeDetailSerializer(serializers.ModelSerializer):
    """Full serializer for detail page"""

    genres = GenreSerializer(many=True, read_only=True)
    studio = StudioSerializer(read_only=True)
    characters = AnimeCharacterSerializer(source="cast", many=True, read_only=True)
    staff = AnimeStaffSerializer(source="production_staff", many=True, read_only=True)
    theme_songs = ThemeSongSerializer(many=True, read_only=True)

    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()
    user_review = serializers.SerializerMethodField()
    review_count = serializers.IntegerField(read_only=True)
    avg_rating = serializers.DecimalField(
        max_digits=3, decimal_places=1, read_only=True
    )
    status_distribution = serializers.SerializerMethodField()
    cover_image_small = serializers.SerializerMethodField()
    cover_image_medium = serializers.SerializerMethodField()
    cover_image_large = serializers.SerializerMethodField()
    banner_image_small = serializers.SerializerMethodField()
    banner_image_medium = serializers.SerializerMethodField()
    banner_image_large = serializers.SerializerMethodField()

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
            "banner_image",
            "banner_image_small",
            "banner_image_medium",
            "banner_image_large",
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
            "characters",
            "staff",
            "external_links",
            "relations",
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
        if obj.cover_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.cover_image_small.url)
            return obj.cover_image_small.url
        return None

    def get_cover_image_medium(self, obj):
        if obj.cover_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.cover_image_medium.url)
            return obj.cover_image_medium.url
        return None

    def get_cover_image_large(self, obj):
        if obj.cover_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.cover_image_large.url)
            return obj.cover_image_large.url
        return None

    def get_banner_image_small(self, obj):
        if obj.banner_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.banner_image_small.url)
            return obj.banner_image_small.url
        return None

    def get_banner_image_medium(self, obj):
        if obj.banner_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.banner_image_medium.url)
            return obj.banner_image_medium.url
        return None

    def get_banner_image_large(self, obj):
        if obj.banner_image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.banner_image_large.url)
            return obj.banner_image_large.url
        return None

    def get_status_distribution(self, obj):
        """Aggregate user list statuses from the platform's own data"""
        # Use pre-computed status distribution if available (set in view)
        if hasattr(obj, "_status_distribution"):
            return obj._status_distribution

        # Fallback: compute from prefetched user_lists (avoiding extra query)
        distribution = {}
        if (
            hasattr(obj, "_prefetched_objects_cache")
            and "user_lists" in obj._prefetched_objects_cache
        ):
            for entry in obj._prefetched_objects_cache["user_lists"]:
                status = entry.status
                distribution[status] = distribution.get(status, 0) + 1
        else:
            # Last resort - query but only if absolutely necessary
            from django.db.models import Count

            distribution_query = obj.user_lists.values("status").annotate(
                count=Count("id")
            )
            distribution = {
                item["status"]: item["count"] for item in distribution_query
            }

        return distribution

    def get_is_favorite(self, obj):
        # Use prefetched annotation only - no fallback to avoid N+1
        if hasattr(obj, "_is_favorite"):
            return obj._is_favorite
        return False

    def get_user_list_status(self, obj):
        # Use prefetched list entries only - no fallback to avoid N+1
        if hasattr(obj, "_user_list_entries") and obj._user_list_entries:
            entry = obj._user_list_entries[0]
            return {
                "id": entry.id,
                "status": entry.status,
                "score": entry.score,
                "episodes_watched": entry.episodes_watched,
                "progress": (entry.episodes_watched / obj.episode_count * 100)
                if obj.episode_count and obj.episode_count > 0
                else 0,
            }
        return None

    def get_user_review(self, obj):
        # Use prefetched annotation if available
        if hasattr(obj, "_user_review"):
            return obj._user_review
        return None


class UserSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()
    banner = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()
    favorites_count = serializers.IntegerField(
        read_only=True, source="_favorites_count"
    )
    reviews_count = serializers.IntegerField(read_only=True, source="_reviews_count")

    # Computed stats
    days_watched = serializers.FloatField(read_only=True, source="_days_watched")
    mean_score = serializers.FloatField(read_only=True, source="_mean_score")
    anime_count = serializers.IntegerField(read_only=True, source="_anime_count")
    episodes_watched = serializers.IntegerField(
        read_only=True, source="_episodes_watched"
    )

    # Social links
    social_links = serializers.SerializerMethodField()

    email_verified = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()

    # Social features
    points = serializers.SerializerMethodField()
    followers_count = serializers.IntegerField(
        read_only=True, source="_followers_count"
    )
    following_count = serializers.IntegerField(
        read_only=True, source="_following_count"
    )

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "date_joined",
            "avatar",
            "banner",
            "bio",
            "is_private",
            "favorites_count",
            "reviews_count",
            "days_watched",
            "mean_score",
            "anime_count",
            "episodes_watched",
            "social_links",
            "email_verified",
            "has_password",
            "is_staff",
            "is_superuser",
            "points",
            "followers_count",
            "following_count",
        ]
        read_only_fields = [
            "id",
            "date_joined",
            "email_verified",
            "has_password",
            "is_staff",
            "is_superuser",
        ]

    def get_avatar(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.avatar.url if profile and profile.avatar else None

    def get_banner(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.banner.url if profile and profile.banner else None

    def get_bio(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.bio if profile else None

    def get_is_private(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.is_private if profile else False

    def get_email_verified(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.email_verified if profile else False

    def get_has_password(self, obj):
        return obj.has_usable_password()

    def get_social_links(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.social_links if profile else []

    def get_points(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.points if profile else 0


class PublicUserSerializer(serializers.ModelSerializer):
    """Limited serializer for public profile view"""

    avatar = serializers.SerializerMethodField()
    banner = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    favorites_count = serializers.IntegerField(
        read_only=True, source="_favorites_count"
    )
    reviews_count = serializers.IntegerField(read_only=True, source="_reviews_count")
    is_private = serializers.SerializerMethodField()

    # Computed stats
    days_watched = serializers.FloatField(read_only=True, source="_days_watched")
    mean_score = serializers.FloatField(read_only=True, source="_mean_score")
    anime_count = serializers.IntegerField(read_only=True, source="_anime_count")
    episodes_watched = serializers.IntegerField(
        read_only=True, source="_episodes_watched"
    )

    # Dynamic Social links
    social_links = serializers.SerializerMethodField()

    # Social features
    points = serializers.SerializerMethodField()
    followers_count = serializers.IntegerField(
        read_only=True, source="_followers_count"
    )
    following_count = serializers.IntegerField(
        read_only=True, source="_following_count"
    )
    is_following = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "date_joined",
            "avatar",
            "banner",
            "bio",
            "favorites_count",
            "reviews_count",
            "is_private",
            "days_watched",
            "mean_score",
            "anime_count",
            "episodes_watched",
            "social_links",
            "points",
            "followers_count",
            "following_count",
            "is_following",
            "is_online",
        ]
        read_only_fields = fields

    def get_avatar(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.avatar.url if profile and profile.avatar else None

    def get_banner(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.banner.url if profile and profile.banner else None

    def get_bio(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.bio if profile else None

    def get_is_private(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.is_private if profile else False

    def get_social_links(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.social_links if profile else []

    def get_points(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.points if profile else 0

    def get_is_following(self, obj):
        """Check if the current user is following this user"""
        # Use annotated field if available
        if hasattr(obj, "_is_following"):
            return obj._is_following

        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.followers.filter(follower=request.user).exists()
        return False

    def get_is_online(self, obj):
        """Check if user is currently online based on recent activity"""
        from django.core.cache import cache
        from django.utils import timezone
        from datetime import timedelta

        # Check Redis cache first (fast)
        cache_key = f"user_online:{obj.id}"
        if cache.get(cache_key) is not None:
            return True

        # Fallback: Check last_activity field if within 5 minutes
        profile = getattr(obj, "userprofile", None)
        if profile and profile.last_activity:
            time_since_activity = timezone.now() - profile.last_activity
            if time_since_activity < timedelta(minutes=5):
                return True

        return False


class UserProfileUpdateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, required=False)
    avatar = serializers.ImageField(required=False, allow_null=True)
    banner = serializers.ImageField(required=False, allow_null=True)
    bio = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_BIO_LENGTH
    )
    is_private = serializers.BooleanField(required=False, default=False)

    # Dynamic social links
    social_links = serializers.JSONField(required=False)

    def validate_social_links(self, value):
        from urllib.parse import urlparse
        from django.core.validators import URLValidator
        from django.core.exceptions import ValidationError as DjangoValidationError

        if not isinstance(value, list):
            raise serializers.ValidationError("Social links must be a list.")

        if len(value) > 5:
            raise serializers.ValidationError("Maximum 5 social links allowed.")

        url_validator = URLValidator(schemes=["http", "https"])

        # Whitelist of allowed domains for security
        ALLOWED_DOMAINS = [
            "x.com",
            "twitter.com",
            "youtube.com",
            "instagram.com",
            "github.com",
            "linkedin.com",
            "twitch.tv",
            "discord.com",
            "tiktok.com",
            "facebook.com",
            "reddit.com",
            "patreon.com",
            "ko-fi.com",
            "buymeacoffee.com",
        ]

        # Dangerous schemes that could be used for XSS
        DANGEROUS_SCHEMES = ["javascript:", "data:", "vbscript:", "file:"]

        normalized_links = []
        for link in value:
            if (
                not isinstance(link, dict)
                or "platform" not in link
                or "value" not in link
            ):
                continue

            platform = link["platform"].strip()
            val = link["value"].strip()

            if not platform or not val:
                continue

            # Check for dangerous schemes (XSS prevention)
            val_lower = val.lower()
            for scheme in DANGEROUS_SCHEMES:
                if val_lower.startswith(scheme):
                    raise serializers.ValidationError(
                        f"Invalid URL scheme detected. URL cannot start with '{scheme}'"
                    )

            # Normalize common platforms
            normalized_val = val
            if not val.startswith(("http://", "https://", "www.")):
                if platform.lower() in ["twitter", "x"]:
                    normalized_val = f"https://x.com/{val.lstrip('@')}"
                elif platform.lower() == "youtube":
                    normalized_val = f"https://youtube.com/@{val.lstrip('@')}"
                elif platform.lower() == "instagram":
                    normalized_val = f"https://instagram.com/{val.lstrip('@')}"
                elif platform.lower() == "github":
                    normalized_val = f"https://github.com/{val.lstrip('@')}"
                elif platform.lower() == "twitch":
                    normalized_val = f"https://twitch.tv/{val.lstrip('@')}"
                elif platform.lower() == "tiktok":
                    normalized_val = f"https://tiktok.com/@{val.lstrip('@')}"
                elif platform.lower() == "linkedin":
                    normalized_val = f"https://linkedin.com/in/{val.lstrip('@')}"

            # Validate URL format
            try:
                url_validator(normalized_val)
            except DjangoValidationError:
                raise serializers.ValidationError(
                    f"Invalid URL format for {platform}: {normalized_val}"
                )

            # Validate domain is in whitelist
            parsed_url = urlparse(normalized_val)
            domain = parsed_url.netloc.lower()

            # Remove www. prefix for comparison
            if domain.startswith("www."):
                domain = domain[4:]

            if not any(allowed in domain for allowed in ALLOWED_DOMAINS):
                raise serializers.ValidationError(
                    f"Domain not allowed: {domain}. Allowed platforms: {', '.join(ALLOWED_DOMAINS)}"
                )

            normalized_links.append({"platform": platform, "value": normalized_val})

        return normalized_links

    def validate_avatar(self, value):
        """Validate avatar file size, type, and content."""
        if value is None:
            return value
        return validate_image_content(value, MAX_AVATAR_SIZE, "Avatar")

    def validate_banner(self, value):
        """Validate banner file size, type, and content."""
        if value is None:
            return value
        return validate_image_content(value, MAX_BANNER_SIZE, "Banner")

    def validate_bio(self, value):
        """Sanitize bio text to prevent XSS."""
        if value:
            # Basic HTML escape for XSS prevention
            return escape(value.strip())
        return value


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["username", "email", "password"]

    def validate_email(self, value):
        # Normalize email to prevent case-based enumeration
        normalized_email = value.lower().strip()

        # Check for existing email to prevent duplicates
        # This provides defense in depth even if DB doesn't enforce uniqueness
        if User.objects.filter(email=normalized_email).exists():
            raise serializers.ValidationError(
                "Unable to create account. The email or username may already be in use."
            )

        return normalized_email

    def create(self, validated_data):
        from django.db import IntegrityError

        try:
            user = User.objects.create_user(
                username=validated_data["username"],
                email=validated_data["email"],
                password=validated_data["password"],
            )
            return user
        except IntegrityError:
            # Don't reveal if email/username exists - return generic error
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        "Unable to create account. The email or username may already be in use."
                    ]
                }
            )


class FavoriteSerializer(serializers.ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = serializers.PrimaryKeyRelatedField(
        queryset=Anime.objects.all(), source="anime", write_only=True
    )

    class Meta:
        model = UserFavorite
        fields = ["id", "anime", "anime_id", "added_at"]
        read_only_fields = ["id", "added_at"]


class UserAnimeListSerializer(serializers.ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = serializers.PrimaryKeyRelatedField(
        queryset=Anime.objects.all(),
        source="anime",
        write_only=True,
        required=False,  # Not required for updates
    )
    status = serializers.ChoiceField(
        choices=UserAnimeList.UserAnimeStatus.choices, required=False
    )
    progress = serializers.SerializerMethodField()

    class Meta:
        model = UserAnimeList
        fields = [
            "id",
            "anime",
            "anime_id",
            "status",
            "score",
            "episodes_watched",
            "progress",
            "updated_at",
        ]

    def get_progress(self, obj):
        if obj.anime.episode_count and obj.anime.episode_count > 0:
            return int((obj.episodes_watched / obj.anime.episode_count) * 100)
        return 0

    def validate(self, attrs):
        # For creation, anime_id is required
        if not self.instance and "anime" not in attrs:
            raise serializers.ValidationError({"anime_id": "This field is required."})

        episodes_watched = attrs.get("episodes_watched")
        anime = attrs.get("anime")
        status = attrs.get("status")

        # If updating, anime might not be in attrs, get from instance
        if not anime and self.instance:
            anime = self.instance.anime

        if episodes_watched is not None and anime and anime.episode_count > 0:
            if episodes_watched > anime.episode_count:
                raise serializers.ValidationError(
                    {
                        "episodes_watched": f"Episodes watched cannot exceed total episodes ({anime.episode_count})."
                    }
                )

            # Auto-complete logic
            if episodes_watched == anime.episode_count:
                attrs["status"] = UserAnimeList.UserAnimeStatus.completed

        # If status is set to Completed, ensure episodes_watched is set to max
        if (
            status == UserAnimeList.UserAnimeStatus.completed
            and anime
            and anime.episode_count > 0
        ):
            attrs["episodes_watched"] = anime.episode_count

        return attrs


class ReviewSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    anime = AnimeListSerializer(read_only=True)
    anime_slug = serializers.SlugRelatedField(
        slug_field="slug", queryset=Anime.objects.all(), source="anime", write_only=True
    )
    has_spoilers = serializers.BooleanField(default=False, required=False)
    text = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_REVIEW_LENGTH
    )

    # Use annotated fields from the view to avoid N+1 queries
    is_completed = serializers.BooleanField(read_only=True, source="_is_completed")
    helpful_count = serializers.IntegerField(read_only=True, source="_helpful_count")
    user_vote = serializers.SerializerMethodField()
    comment_count = serializers.IntegerField(read_only=True, source="_comment_count")

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
        # The view annotates _user_vote as a boolean (Exists query result)
        if hasattr(obj, "_user_vote"):
            return obj._user_vote if obj._user_vote else None

        # Fallback for when annotation is not available (e.g., single object retrieval)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            vote = obj.votes.filter(user=request.user).first()
            if vote:
                return vote.is_helpful
        return None


class ReviewCommentSerializer(serializers.ModelSerializer):
    """Serializer for review comments with soft delete support"""

    user = UserSerializer(read_only=True)
    text = serializers.CharField(
        required=True, allow_blank=False, max_length=MAX_COMMENT_LENGTH
    )
    is_owner = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

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

        # Comment author can delete
        if obj.user == request.user:
            return True

        # Review owner can delete any comment on their review
        if obj.review.user == request.user:
            return True

        return False


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, write_only=True
    )
    new_password = serializers.CharField(required=True, write_only=True, min_length=8)

    def validate(self, attrs):
        user = self.context["request"].user
        old_password = attrs.get("old_password")

        # Log password change attempt without sensitive details
        logger.debug("Password change validation attempted")

        # If user has a password, old_password is REQUIRED
        if user.has_usable_password():
            if not old_password:
                raise serializers.ValidationError(
                    {"old_password": "Current password is required to set a new one."}
                )
            if not user.check_password(old_password):
                raise serializers.ValidationError(
                    {"old_password": "The current password you entered is incorrect."}
                )

        return attrs


class UserRecommendationSerializer(serializers.ModelSerializer):
    """Serializer for user recommendations with anime details and reason"""

    anime = AnimeListSerializer(read_only=True)
    reason_text = serializers.CharField(
        source="get_reason_display_text", read_only=True
    )

    class Meta:
        from anime.models import UserRecommendation

        model = UserRecommendation
        fields = [
            "id",
            "anime",
            "score",
            "reason",
            "reason_text",
            "reason_metadata",
            "created_at",
        ]
        read_only_fields = fields


class UserImportJobSerializer(serializers.ModelSerializer):
    """Serializer for import jobs"""

    source_display = serializers.CharField(source="get_source_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    progress_percentage = serializers.IntegerField(read_only=True)

    class Meta:
        from users.models import UserImportJob

        model = UserImportJob
        fields = [
            "id",
            "source",
            "source_display",
            "status",
            "status_display",
            "total_entries",
            "processed_entries",
            "imported_entries",
            "skipped_entries",
            "failed_entries",
            "fetched_entries",
            "progress_percentage",
            "errors",
            "source_identifier",
            "created_at",
            "started_at",
            "completed_at",
        ]
        read_only_fields = fields


class FollowSerializer(serializers.Serializer):
    """Serializer for follow/unfollow actions"""

    username = serializers.CharField()


class UserFollowListSerializer(serializers.ModelSerializer):
    """Serializer for displaying followers/following lists"""

    user = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()
    is_follower = serializers.SerializerMethodField()

    class Meta:
        from users.models import UserFollow

        model = UserFollow
        fields = ["id", "user", "is_following", "is_follower", "created_at"]

    def get_user(self, obj):
        # Use the _display_user attribute set by the view
        user_obj = getattr(obj, "_display_user", obj.follower)
        profile = getattr(user_obj, "userprofile", None)
        return {
            "id": user_obj.id,
            "username": user_obj.username,
            "avatar": profile.avatar.url if profile and profile.avatar else None,
            "points": profile.points if profile else 0,
        }

    def get_is_following(self, obj):
        """Check if the current user follows this user"""
        # Use annotated field if available
        if hasattr(obj, "_is_following"):
            return obj._is_following
        return False

    def get_is_follower(self, obj):
        """Check if this user follows the current user"""
        # Use annotated field if available
        if hasattr(obj, "_is_follower"):
            return obj._is_follower
        return False


class FriendWatchingSerializer(serializers.ModelSerializer):
    """Serializer for displaying friends watching a specific anime"""

    user = serializers.SerializerMethodField()
    anime = serializers.SerializerMethodField()

    class Meta:
        model = UserAnimeList
        fields = [
            "id",
            "user",
            "anime",
            "status",
            "score",
            "episodes_watched",
            "updated_at",
        ]

    def get_user(self, obj):
        """Return user details with avatar"""
        user_obj = obj.user
        profile = getattr(user_obj, "userprofile", None)
        return {
            "id": user_obj.id,
            "username": user_obj.username,
            "avatar": profile.avatar.url if profile and profile.avatar else None,
        }

    def get_anime(self, obj):
        """Return minimal anime info"""
        return {
            "id": obj.anime.id,
            "title": obj.anime.title,
            "episode_count": obj.anime.episode_count,
        }
