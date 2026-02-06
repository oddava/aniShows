from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.utils.html import escape
from anime.models import (
    Anime,
    Genre,
    Studio,
    UserFavorite,
    Review,
    Character,
    Staff,
    AnimeCharacter,
    AnimeStaff,
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

    class Meta:
        model = Character
        fields = ["id", "name", "name_native", "image", "description"]

    def get_image(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return obj.image_url


class StaffSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    class Meta:
        model = Staff
        fields = ["id", "name", "name_native", "image", "description"]

    def get_image(self, obj):
        if obj.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
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


class AnimeListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for lists"""

    genres = GenreSerializer(many=True, read_only=True)
    studio_name = serializers.CharField(
        source="studio.name", read_only=True, default=None
    )
    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()

    class Meta:
        model = Anime
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "cover_image",
            "banner_image",
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

    def get_is_favorite(self, obj):
        # Use prefetched annotation if available (avoids N+1)
        if hasattr(obj, "_is_favorite"):
            return obj._is_favorite
        # Fallback for non-prefetched contexts
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return UserFavorite.objects.filter(user=request.user, anime=obj).exists()
        return False

    def get_user_list_status(self, obj):
        # Use prefetched list entries if available (avoids N+1)
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
        # Fallback for non-prefetched contexts
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            user_list = UserAnimeList.objects.filter(
                user=request.user, anime=obj
            ).first()
            if user_list:
                return {
                    "id": user_list.id,
                    "status": user_list.status,
                    "score": user_list.score,
                    "episodes_watched": user_list.episodes_watched,
                    "progress": (user_list.episodes_watched / obj.episode_count * 100)
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

    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()
    user_review = serializers.SerializerMethodField()
    review_count = serializers.IntegerField(read_only=True)
    avg_rating = serializers.DecimalField(
        max_digits=3, decimal_places=1, read_only=True
    )
    status_distribution = serializers.SerializerMethodField()

    class Meta:
        model = Anime
        fields = [
            "id",
            "title",
            "title_jp",
            "slug",
            "synopsis",
            "cover_image",
            "banner_image",
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
        ]

    def get_status_distribution(self, obj):
        """Aggregate user list statuses from the platform's own data"""
        from django.db.models import Count

        distribution = obj.user_lists.values("status").annotate(count=Count("id"))
        return {item["status"]: item["count"] for item in distribution}

    def get_is_favorite(self, obj):
        # Use prefetched annotation if available
        if hasattr(obj, "_is_favorite"):
            return obj._is_favorite
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return UserFavorite.objects.filter(user=request.user, anime=obj).exists()
        return False

    def get_user_list_status(self, obj):
        # Use prefetched list entries if available
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
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            user_list = UserAnimeList.objects.filter(
                user=request.user, anime=obj
            ).first()
            if user_list:
                return {
                    "id": user_list.id,
                    "status": user_list.status,
                    "score": user_list.score,
                    "episodes_watched": user_list.episodes_watched,
                    "progress": (user_list.episodes_watched / obj.episode_count * 100)
                    if obj.episode_count and obj.episode_count > 0
                    else 0,
                }
        return None

    def get_user_review(self, obj):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            review = Review.objects.filter(user=request.user, anime=obj).first()
            if review:
                # Return minimal data needed for "Edit Review" functionality
                return {
                    "id": review.id,
                    "rating": review.rating,
                    "text": review.text,
                    "has_spoilers": review.has_spoilers,
                }
        return None


class UserSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()
    banner = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()
    favorites_count = serializers.SerializerMethodField()
    reviews_count = serializers.SerializerMethodField()

    # Computed stats
    days_watched = serializers.SerializerMethodField()
    mean_score = serializers.SerializerMethodField()
    anime_count = serializers.SerializerMethodField()

    # Social links
    social_links = serializers.SerializerMethodField()

    email_verified = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()

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
            "social_links",
            "email_verified",
            "has_password",
            "is_staff",
            "is_superuser",
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

    def get_favorites_count(self, obj):
        return obj.favorites.count()

    def get_reviews_count(self, obj):
        return obj.reviews.count()

    def get_is_private(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.is_private if profile else False

    def get_email_verified(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.email_verified if profile else False

    def get_has_password(self, obj):
        return obj.has_usable_password()

    def get_days_watched(self, obj):
        """Calculate total days watched from user's anime list"""
        from django.db.models import Sum, F

        total_minutes = (
            obj.anime_lists.annotate(
                watch_time=F("episodes_watched") * F("anime__duration_minutes")
            ).aggregate(total=Sum("watch_time"))["total"]
            or 0
        )
        return round(total_minutes / 1440, 1)  # Convert minutes to days

    def get_mean_score(self, obj):
        """Calculate average score from user's anime list"""
        from django.db.models import Avg

        avg = obj.anime_lists.filter(score__gt=0).aggregate(avg=Avg("score"))["avg"]
        return round(avg, 1) if avg else None

    def get_anime_count(self, obj):
        """Count total anime in user's list"""
        return obj.anime_lists.count()

    def get_social_links(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.social_links if profile else []


class PublicUserSerializer(serializers.ModelSerializer):
    """Limited serializer for public profile view"""

    avatar = serializers.SerializerMethodField()
    banner = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    favorites_count = serializers.SerializerMethodField()
    reviews_count = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()

    # Computed stats
    days_watched = serializers.SerializerMethodField()
    mean_score = serializers.SerializerMethodField()
    anime_count = serializers.SerializerMethodField()

    # Dynamic Social links
    social_links = serializers.SerializerMethodField()

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
            "social_links",
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

    def get_favorites_count(self, obj):
        return obj.favorites.count()

    def get_reviews_count(self, obj):
        return obj.reviews.count()

    def get_is_private(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.is_private if profile else False

    def get_days_watched(self, obj):
        """Calculate total days watched from user's anime list"""
        from django.db.models import Sum, F

        total_minutes = (
            obj.anime_lists.annotate(
                watch_time=F("episodes_watched") * F("anime__duration_minutes")
            ).aggregate(total=Sum("watch_time"))["total"]
            or 0
        )
        return round(total_minutes / 1440, 1)

    def get_mean_score(self, obj):
        """Calculate average score from user's anime list"""
        from django.db.models import Avg

        avg = obj.anime_lists.filter(score__gt=0).aggregate(avg=Avg("score"))["avg"]
        return round(avg, 1) if avg else None

    def get_anime_count(self, obj):
        """Count total anime in user's list"""
        return obj.anime_lists.count()

    def get_social_links(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.social_links if profile else []


class UserProfileUpdateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, required=False)
    avatar = serializers.ImageField(required=False, allow_null=True)
    banner = serializers.ImageField(required=False, allow_null=True)
    bio = serializers.CharField(
        required=False, allow_blank=True, max_length=MAX_BIO_LENGTH
    )

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
        """Validate avatar file size and type."""
        if value is None:
            return value
        if value.size > MAX_AVATAR_SIZE:
            raise serializers.ValidationError(
                f"Avatar file too large. Maximum size is {MAX_AVATAR_SIZE // (1024 * 1024)}MB."
            )
        if (
            hasattr(value, "content_type")
            and value.content_type not in ALLOWED_IMAGE_TYPES
        ):
            raise serializers.ValidationError(
                "Invalid file type. Allowed types: JPEG, PNG, WebP, GIF."
            )
        return value

    def validate_banner(self, value):
        """Validate banner file size and type."""
        if value is None:
            return value
        if value.size > MAX_BANNER_SIZE:
            raise serializers.ValidationError(
                f"Banner file too large. Maximum size is {MAX_BANNER_SIZE // (1024 * 1024)}MB."
            )
        if (
            hasattr(value, "content_type")
            and value.content_type not in ALLOWED_IMAGE_TYPES
        ):
            raise serializers.ValidationError(
                "Invalid file type. Allowed types: JPEG, PNG, WebP, GIF."
            )
        return value

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
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data["email"],
            password=validated_data["password"],
        )
        return user


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


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, write_only=True
    )
    new_password = serializers.CharField(required=True, write_only=True, min_length=8)

    def validate(self, attrs):
        user = self.context["request"].user
        old_password = attrs.get("old_password")

        # Log for debugging
        logger.info(
            f"Validating password change for {user.username}: has_usable_password={user.has_usable_password()}, old_password_provided={bool(old_password)}"
        )

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
