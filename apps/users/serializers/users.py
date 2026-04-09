import re

import bleach
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError
from rest_framework.serializers import (
    BooleanField,
    CharField,
    ChoiceField,
    DateField,
    FloatField,
    ImageField,
    IntegerField,
    JSONField,
    ModelSerializer,
    PrimaryKeyRelatedField,
    Serializer,
    SerializerMethodField,
)

from ...animes.models import (
    Anime,
    UserFavorite,
    UserFavoriteCharacter,
    UserFavoriteStaff,
)
from ...animes.serializers.anime import (
    AnimeCompactSerializer,
    AnimeListSerializer,
    AnimeMinimalSerializer,
)
from ...animes.serializers.base import (
    CharacterCompactSerializer,
    StaffCompactSerializer,
    validate_image_content,
)
from ...animes.serializers_mixins import BadgesMixin, UserProfileMixin
from ...core.services.admin_settings_service import username_length_limits
from ...shared.logger import logger
from ..models import Badge, UserActivity, UserAnimeList, UserBadge
from ..services.auth_service import AuthService
from ..services.avatar_service import get_user_avatar_url

User = get_user_model()

MAX_AVATAR_SIZE = getattr(settings, "MAX_AVATAR_SIZE", 2 * 1024 * 1024)
MAX_BANNER_SIZE = getattr(settings, "MAX_BANNER_SIZE", 5 * 1024 * 1024)
MAX_BIO_LENGTH = getattr(settings, "MAX_BIO_LENGTH", 5000)
ALLOWED_BIO_TAGS = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "br",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "span",
    "div",
    "hr",
    "youtube",
    "mention",
]
ALLOWED_BIO_ATTRIBUTES = {
    "*": ["class", "align"],
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "width", "height", "data-align", "data-width"],
    "youtube": ["src"],
    "mention": ["username"],
}
HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def _decode_escaped_html_entities(value: str) -> str:
    return (
        value.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&amp;", "&")
    )

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
    resonance_count = IntegerField(read_only=True, source="_resonance_count", default=0)

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
    profile_primary_color = SerializerMethodField()
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
            "resonance_count",
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
            "profile_primary_color",
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
    profile_primary_color = SerializerMethodField()

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
            "profile_primary_color",
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
    resonance_count = IntegerField(read_only=True, source="_resonance_count", default=0)
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
    profile_primary_color = SerializerMethodField()
    followers_count = SerializerMethodField()
    following_count = SerializerMethodField()
    is_following = SerializerMethodField()

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
            "resonance_count",
            "is_private",
            "days_watched",
            "mean_score",
            "anime_count",
            "episodes_watched",
            "social_links",
            "points",
            "profile_primary_color",
            "followers_count",
            "following_count",
            "is_following",
            "badges",
        ]
        read_only_fields = fields

    def get_is_following(self, obj):
        """Check if the current user is following this user"""
        return bool(getattr(obj, "_is_following", False))

    def get_followers_count(self, obj):
        """Return followers count from annotations only."""
        return int(getattr(obj, "_followers_count", 0) or 0)

    def get_following_count(self, obj):
        """Return following count from annotations only."""
        return int(getattr(obj, "_following_count", 0) or 0)

class UserProfileUpdateSerializer(Serializer):
    username = CharField(max_length=150, required=False)
    avatar = ImageField(required=False, allow_null=True)
    banner = ImageField(required=False, allow_null=True)
    remove_banner = BooleanField(required=False, default=False)
    bio = CharField(required=False, allow_blank=True, max_length=MAX_BIO_LENGTH)
    is_private = BooleanField(required=False, default=False)
    profile_primary_color = CharField(required=False, max_length=7)

    def validate_is_private(self, value):
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes", "on")
        return value

    def validate_remove_banner(self, value):
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes", "on")
        return value

    def validate_bio(self, value):
        # Normalize legacy escaped content (&lt;p&gt;...) back to raw HTML before sanitizing.
        normalized_value = _decode_escaped_html_entities(value or "")

        # Keep markdown/allowed HTML intact while stripping unsafe tags/attributes.
        return bleach.clean(
            normalized_value,
            tags=ALLOWED_BIO_TAGS,
            attributes=ALLOWED_BIO_ATTRIBUTES,
            strip=True,
        )

    def validate_profile_primary_color(self, value):
        normalized = (value or "").strip().lower()
        if not HEX_COLOR_PATTERN.match(normalized):
            raise ValidationError(
                "Profile primary color must be a valid hex color (e.g., #8b5cf6)."
            )
        return normalized

    social_links = JSONField(required=False)

    def validate_social_links(self, value):
        import json

        from ...core.services.social_links_service import (
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
    auth_service = AuthService()

    class Meta:
        model = User
        fields = ["username", "email", "password"]

    def validate_username(self, value):
        normalized = value.strip()
        min_length, max_length = username_length_limits()

        if len(normalized) < min_length:
            raise ValidationError(f"Username must be at least {min_length} characters long.")
        if len(normalized) > max_length:
            raise ValidationError(f"Username must be at most {max_length} characters long.")

        return normalized

    def validate_email(self, value):
        return value.lower().strip()

    def create(self, validated_data):
        return self.auth_service.register_user(validated_data)


class FavoriteSerializer(ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = PrimaryKeyRelatedField(queryset=Anime.objects.all(), source="anime", write_only=True)

    class Meta:
        model = UserFavorite
        fields = ["id", "anime", "anime_id", "added_at"]
        read_only_fields = ["id", "added_at"]


class CharacterFavoriteSerializer(ModelSerializer):
    character = CharacterCompactSerializer(read_only=True)

    class Meta:
        model = UserFavoriteCharacter
        fields = ["id", "character", "added_at"]
        read_only_fields = ["id", "added_at"]


class StaffFavoriteSerializer(ModelSerializer):
    staff = StaffCompactSerializer(read_only=True)

    class Meta:
        model = UserFavoriteStaff
        fields = ["id", "staff", "added_at"]
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
    score = IntegerField(required=False, min_value=0, max_value=10)
    episodes_watched = IntegerField(required=False, min_value=0)
    notes = CharField(required=False, allow_blank=True)
    started_at = DateField(required=False, allow_null=True)
    finished_at = DateField(required=False, allow_null=True)
    total_rewatches = IntegerField(required=False, min_value=0)
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
            "total_rewatches",
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
        started_at = attrs.get("started_at")
        finished_at = attrs.get("finished_at")

        if not anime and self.instance:
            anime = self.instance.anime
        if started_at is None and self.instance:
            started_at = self.instance.started_at
        if finished_at is None and self.instance:
            finished_at = self.instance.finished_at

        if episodes_watched is not None and episodes_watched < 0:
            raise ValidationError({"episodes_watched": "Episodes watched cannot be negative."})

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

        if started_at and finished_at and finished_at < started_at:
            raise ValidationError({"finished_at": "Finish date cannot be earlier than start date."})

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
        from ...animes.models import UserRecommendation

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
        from ..models import UserFollow

        model = UserFollow
        fields = ["id", "user", "is_following", "is_follower", "created_at"]

    def get_user(self, obj):
        user_obj = getattr(obj, "_display_user", obj.follower)
        profile = getattr(user_obj, "userprofile", None)
        return {
            "id": user_obj.id,
            "username": user_obj.username,
            "avatar": get_user_avatar_url(user_obj),
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
        return {
            "id": user_obj.id,
            "username": user_obj.username,
            "avatar": get_user_avatar_url(user_obj),
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
