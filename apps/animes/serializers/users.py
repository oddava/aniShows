from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError
from rest_framework.serializers import (
    BooleanField,
    CharField,
    ChoiceField,
    FloatField,
    ImageField,
    IntegerField,
    JSONField,
    ModelSerializer,
    PrimaryKeyRelatedField,
    Serializer,
    SerializerMethodField,
)

from apps.animes.models import Anime, UserFavorite
from apps.animes.serializers.anime import AnimeListSerializer, AnimeMinimalSerializer, AnimeCompactSerializer
from apps.animes.serializers.base import validate_image_content
from apps.animes.serializers_mixins import BadgesMixin, UserProfileMixin
from apps.shared.logger import logger
from apps.users.models import Badge, UserActivity, UserAnimeList, UserBadge

User = get_user_model()

MAX_AVATAR_SIZE = getattr(settings, "MAX_AVATAR_SIZE", 2 * 1024 * 1024)
MAX_BANNER_SIZE = getattr(settings, "MAX_BANNER_SIZE", 5 * 1024 * 1024)
MAX_BIO_LENGTH = getattr(settings, "MAX_BIO_LENGTH", 5000)

class BadgeSerializer(ModelSerializer):
    """Serializer for a badge definition."""

    class Meta:
        model = Badge
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "icon",
            "image",
            "color",
            "priority",
            "is_active",
        ]
        read_only_fields = ["slug"]


class UserBadgeSerializer(ModelSerializer):
    """Serializer for a badge held by a user."""

    badge = BadgeSerializer(read_only=True)

    class Meta:
        model = UserBadge
        fields = [
            "id",
            "badge",
            "granted_at",
            "is_featured",
        ]


class UserSerializer(UserProfileMixin, BadgesMixin, ModelSerializer):
    avatar = SerializerMethodField()
    banner = SerializerMethodField()
    bio = SerializerMethodField()
    is_private = SerializerMethodField()
    favorites_count = IntegerField(read_only=True, source="_favorites_count")
    reviews_count = IntegerField(read_only=True, source="_reviews_count")

    days_watched = SerializerMethodField()
    mean_score = SerializerMethodField()
    anime_count = IntegerField(read_only=True, source="_anime_count")
    episodes_watched = IntegerField(read_only=True, source="_episodes_watched")

    def get_days_watched(self, obj):
        """Return days watched rounded to 1 decimal place"""
        days = getattr(obj, "_days_watched", None)
        if days is not None:
            return round(float(days), 1)
        return 0.0

    def get_mean_score(self, obj):
        """Return mean score rounded to 1 decimal place"""
        raw_score = getattr(obj, "_mean_score_raw", None)
        if raw_score is not None:
            return round(float(raw_score), 1)
        return None

    social_links = SerializerMethodField()

    email_verified = SerializerMethodField()
    has_password = SerializerMethodField()

    points = SerializerMethodField()
    followers_count = IntegerField(read_only=True, source="_followers_count")
    following_count = IntegerField(read_only=True, source="_following_count")

    badges = SerializerMethodField()

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
            "badges",
        ]
        read_only_fields = [
            "id",
            "date_joined",
            "email_verified",
            "has_password",
            "is_staff",
            "is_superuser",
        ]


class UserLightweightSerializer(UserProfileMixin, ModelSerializer):
    """Lightweight serializer for navbar/quick profile view - no expensive calculations"""

    avatar = SerializerMethodField()
    bio = SerializerMethodField()
    is_private = SerializerMethodField()
    email_verified = SerializerMethodField()
    has_password = SerializerMethodField()
    social_links = SerializerMethodField()

    anime_count = IntegerField(default=0)
    episodes_watched = IntegerField(default=0)
    days_watched = FloatField(default=0.0)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "avatar",
            "bio",
            "is_private",
            "email_verified",
            "has_password",
            "social_links",
            "anime_count",
            "episodes_watched",
            "days_watched",
            "date_joined",
        ]
        read_only_fields = [
            "id",
            "date_joined",
            "email_verified",
            "has_password",
        ]


class PublicUserSerializer(UserProfileMixin, BadgesMixin, ModelSerializer):
    """Limited serializer for public profile view"""

    avatar = SerializerMethodField()
    banner = SerializerMethodField()
    bio = SerializerMethodField()
    favorites_count = IntegerField(read_only=True, source="_favorites_count")
    reviews_count = IntegerField(read_only=True, source="_reviews_count")
    is_private = SerializerMethodField()

    days_watched = SerializerMethodField()
    mean_score = SerializerMethodField()
    anime_count = IntegerField(read_only=True, source="_anime_count")
    episodes_watched = IntegerField(read_only=True, source="_episodes_watched")

    def get_days_watched(self, obj):
        """Return days watched rounded to 1 decimal place"""
        days = getattr(obj, "_days_watched", None)
        if days is not None:
            return round(float(days), 1)
        return 0.0

    def get_mean_score(self, obj):
        """Return mean score rounded to 1 decimal place"""
        raw_score = getattr(obj, "_mean_score_raw", None)
        if raw_score is not None:
            return round(float(raw_score), 1)
        return None

    social_links = SerializerMethodField()

    points = SerializerMethodField()
    followers_count = SerializerMethodField()
    following_count = SerializerMethodField()
    is_following = SerializerMethodField()
    is_online = SerializerMethodField()

    badges = SerializerMethodField()

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
            "badges",
        ]
        read_only_fields = fields

    def get_is_following(self, obj):
        """Check if the current user is following this user"""
        if hasattr(obj, "_is_following"):
            return obj._is_following

        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.followers.filter(follower=request.user).exists()
        return False

    def get_followers_count(self, obj):
        """Return followers count from annotation or fallback to database query"""
        count = getattr(obj, "_followers_count", None)
        if count is not None:
            return int(count)

        return obj.followers.count()

    def get_following_count(self, obj):
        """Return following count from annotation or fallback to database query"""
        count = getattr(obj, "_following_count", None)
        if count is not None:
            return int(count)

        return obj.following.count()

    def get_is_online(self, obj):
        """Check if user is currently online based on recent activity"""
        from datetime import timedelta

        from django.core.cache import cache
        from django.utils import timezone

        cache_key = f"user_online:{obj.id}"
        if cache.get(cache_key) is not None:
            return True

        profile = getattr(obj, "userprofile", None)
        if profile and profile.last_activity:
            time_since_activity = timezone.now() - profile.last_activity
            if time_since_activity < timedelta(minutes=5):
                return True

        return False


class UserProfileUpdateSerializer(Serializer):
    username = CharField(max_length=150, required=False)
    avatar = ImageField(required=False, allow_null=True)
    banner = ImageField(required=False, allow_null=True)
    remove_banner = BooleanField(required=False, default=False)
    bio = CharField(required=False, allow_blank=True, max_length=MAX_BIO_LENGTH)
    is_private = BooleanField(required=False, default=False)

    def validate_is_private(self, value):
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes", "on")
        return value

    def validate_remove_banner(self, value):
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes", "on")
        return value

    def validate_bio(self, value):
        from django.utils.html import escape
        return escape(value)

    social_links = JSONField(required=False)

    def validate_social_links(self, value):
        import json

        from apps.core.services.social_links_service import (
            SocialLinksService,
            SocialLinkValidationError,
        )

        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                raise ValidationError("Social links must be valid JSON.")

        if not isinstance(value, list):
            raise ValidationError("Social links must be a list.")

        if len(value) > 5:
            raise ValidationError("Maximum 5 social links allowed.")

        cleaned_links = []
        for link in value:
            if (
                isinstance(link, dict)
                and link.get("platform", "").strip()
                and link.get("value", "").strip()
            ):
                cleaned_links.append(
                    {
                        "platform": link["platform"].strip(),
                        "value": link["value"].strip(),
                    }
                )

        service = SocialLinksService()

        try:
            user = self.context.get("request").user if self.context.get("request") else None
            processed_links = service.validate_and_process(cleaned_links, user)
            return processed_links
        except SocialLinkValidationError as e:
            raise ValidationError(str(e))

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


class RegisterSerializer(ModelSerializer):
    password = CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["username", "email", "password"]

    def validate_email(self, value):
        normalized_email = value.lower().strip()

        if User.objects.filter(email=normalized_email).exists():
            raise ValidationError(
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
            raise ValidationError(
                {
                    "non_field_errors": [
                        "Unable to create account. The email or username may already be in use."
                    ]
                }
            )


class FavoriteSerializer(ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = PrimaryKeyRelatedField(queryset=Anime.objects.all(), source="anime", write_only=True)

    class Meta:
        model = UserFavorite
        fields = ["id", "anime", "anime_id", "added_at"]
        read_only_fields = ["id", "added_at"]


class UserAnimeListSerializer(ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = PrimaryKeyRelatedField(
        queryset=Anime.objects.all(),
        source="anime",
        write_only=True,
        required=False,
    )
    status = ChoiceField(choices=UserAnimeList.UserAnimeStatus.choices, required=False)
    progress = SerializerMethodField()

    class Meta:
        model = UserAnimeList
        fields = [
            "id",
            "anime",
            "anime_id",
            "status",
            "score",
            "episodes_watched",
            "notes",
            "started_at",
            "finished_at",
            "is_rewatching",
            "progress",
            "updated_at",
        ]

    def get_progress(self, obj):
        if obj.anime.episode_count and obj.anime.episode_count > 0:
            return int((obj.episodes_watched / obj.anime.episode_count) * 100)
        return 0

    def validate(self, attrs):
        if not self.instance and "anime" not in attrs:
            raise ValidationError({"anime_id": "This field is required."})

        episodes_watched = attrs.get("episodes_watched")
        anime = attrs.get("anime")
        status = attrs.get("status")

        if not anime and self.instance:
            anime = self.instance.anime

        if episodes_watched is not None and anime and anime.episode_count > 0:
            if episodes_watched > anime.episode_count:
                raise ValidationError(
                    {
                        "episodes_watched": f"Episodes watched cannot exceed total episodes ({anime.episode_count})."
                    }
                )

            if episodes_watched == anime.episode_count:
                attrs["status"] = UserAnimeList.UserAnimeStatus.completed

        if status == UserAnimeList.UserAnimeStatus.completed and anime and anime.episode_count > 0:
            attrs["episodes_watched"] = anime.episode_count

        return attrs


class UserActivitySerializer(ModelSerializer):
    """Serializer for user activity feed entries."""

    anime = AnimeMinimalSerializer(read_only=True)
    activity_description = SerializerMethodField()

    class Meta:
        model = UserActivity
        fields = [
            "id",
            "anime",
            "activity_type",
            "activity_description",
            "old_status",
            "new_status",
            "old_episodes",
            "new_episodes",
            "old_score",
            "new_score",
            "notes",
            "created_at",
        ]
        read_only_fields = fields

    def get_activity_description(self, obj):
        """Generate human-readable activity description."""
        title = obj.anime.title if obj.anime else "Unknown"
        at = UserActivity.ActivityType

        if obj.activity_type == at.COMPLETED:
            desc = f"Completed {title}"
            if obj.new_score:
                desc += f" and rated it {obj.new_score}/10"
            return desc

        if obj.activity_type == at.ADDED:
            status_label = obj.new_status or "list"
            return f"Added {title} to {status_label}"

        if obj.activity_type == at.PROGRESS:
            if obj.old_episodes is not None and obj.new_episodes is not None:
                if obj.new_episodes - obj.old_episodes == 1:
                    return f"Watched episode {obj.new_episodes} of {title}"
                return f"Watched episodes {obj.old_episodes + 1}-{obj.new_episodes} of {title}"
            return f"Updated progress on {title}"

        if obj.activity_type == at.STATUS_CHANGE:
            return f"Changed {title} from {obj.old_status} to {obj.new_status}"

        if obj.activity_type == at.SCORE_CHANGE:
            return f"Rated {title} {obj.new_score}/10"

        if obj.activity_type == at.REMOVED:
            return f"Removed {title} from list"

        if obj.activity_type == at.REWATCHING:
            return f"Started rewatching {title}"

        if obj.activity_type == at.NOTES_UPDATE:
            return f"Updated notes for {title}"

        return f"Updated {title}"


class ChangePasswordSerializer(Serializer):
    old_password = CharField(required=False, allow_blank=True, allow_null=True, write_only=True)
    new_password = CharField(required=True, write_only=True, min_length=8)

    def validate(self, attrs):
        user = self.context["request"].user
        old_password = attrs.get("old_password")

        logger.debug("Password change validation attempted")

        if user.has_usable_password():
            if not old_password:
                raise ValidationError(
                    {"old_password": "Current password is required to set a new one."}
                )
            if not user.check_password(old_password):
                raise ValidationError(
                    {"old_password": "The current password you entered is incorrect."}
                )

        return attrs


class UserRecommendationSerializer(ModelSerializer):
    """Serializer for user recommendations with anime details and reason"""

    anime = AnimeListSerializer(read_only=True)
    reason_text = CharField(source="get_reason_display_text", read_only=True)

    class Meta:
        from apps.animes.models import UserRecommendation

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


class FollowSerializer(Serializer):
    """Serializer for follow/unfollow actions"""

    username = CharField()


class UserFollowListSerializer(ModelSerializer):
    """Serializer for displaying followers/following lists"""

    user = SerializerMethodField()
    is_following = SerializerMethodField()
    is_follower = SerializerMethodField()

    class Meta:
        from apps.users.models import UserFollow

        model = UserFollow
        fields = ["id", "user", "is_following", "is_follower", "created_at"]

    def get_user(self, obj):
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
        if hasattr(obj, "_is_following"):
            return obj._is_following
        return False

    def get_is_follower(self, obj):
        """Check if this user follows the current user"""
        if hasattr(obj, "_is_follower"):
            return obj._is_follower
        return False


class FriendWatchingSerializer(ModelSerializer):
    """Serializer for displaying friends watching a specific anime"""

    user = SerializerMethodField()
    anime = SerializerMethodField()

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

class FavoriteCompactSerializer(ModelSerializer):
    """Ultra-minimal serializer for favorites list display."""
    anime = AnimeCompactSerializer(read_only=True)

    class Meta:
        model = UserFavorite
        fields = ["id", "anime", "added_at"]
        read_only_fields = ["id", "added_at"]
