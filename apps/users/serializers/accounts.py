"""Account and profile serializers (G1 Accounts & auth)."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import bleach
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError
from rest_framework.serializers import (
    BooleanField,
    CharField,
    EmailField,
    FloatField,
    ImageField,
    IntegerField,
    JSONField,
    ModelSerializer,
    Serializer,
    SerializerMethodField,
)

from ...animes.serializers_mixins import BadgesMixin, UserProfileMixin
from ...shared.logger import logger
from ...shared.text import HEX_COLOR_PATTERN, decode_escaped_html_entities
from ..services.auth_service import AuthService
from ..services.username_sanitizer import validate_username
from ..utils.image_processing import ProfileImageError, normalize_profile_image

__all__ = [
    "ALLOWED_BIO_ATTRIBUTES",
    "ALLOWED_BIO_CLASSES",
    "ALLOWED_BIO_TAGS",
    "MAX_AVATAR_SIZE",
    "MAX_BANNER_SIZE",
    "MAX_BIO_LENGTH",
    "ChangePasswordSerializer",
    "PublicUserSerializer",
    "RegisterSerializer",
    "UserLightweightSerializer",
    "UserProfileUpdateSerializer",
    "UserSerializer",
    "sanitize_bio",
]


User = get_user_model()

MAX_AVATAR_SIZE = settings.MAX_AVATAR_SIZE
MAX_BANNER_SIZE = settings.MAX_BANNER_SIZE
MAX_BIO_LENGTH = settings.MAX_BIO_LENGTH
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
# ``class`` used to be allowed on every tag, and MarkdownRenderer spreads props
# after its own className, so a bio could apply any Tailwind class
# (``fixed inset-0 z-50``) and overlay the page (A11). The editor writes
# Markdown only; the one class the renderer reads, ``is-spoiler``, is the only
# value kept. Anything else drops the whole attribute.
ALLOWED_BIO_CLASSES = frozenset({"is-spoiler"})


def _allow_global_bio_attribute(tag: str, name: str, value: str) -> bool:
    if name == "align":
        return True
    if name == "class":
        classes = value.split()
        return bool(classes) and all(item in ALLOWED_BIO_CLASSES for item in classes)
    return False


ALLOWED_BIO_ATTRIBUTES = {
    "*": _allow_global_bio_attribute,
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "width", "height", "data-align", "data-width"],
    "youtube": ["src"],
    "mention": ["username"],
}


def sanitize_bio(value: str | None) -> str:
    """The stored form of a bio: Markdown and allowed HTML kept, unsafe tags/attributes removed.

    Also used by ``manage.py resanitize_bios`` for bios saved under older rules.
    """
    # Normalize legacy escaped content (&lt;p&gt;...) back to raw HTML before sanitizing.
    normalized_value = decode_escaped_html_entities(value or "")
    return bleach.clean(
        normalized_value,
        tags=ALLOWED_BIO_TAGS,
        attributes=ALLOWED_BIO_ATTRIBUTES,
        strip=True,
    )


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
    show_adult_content = SerializerMethodField()
    preferred_timezone = SerializerMethodField()
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
            "show_adult_content",
            "preferred_timezone",
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
    show_adult_content = SerializerMethodField()
    preferred_timezone = SerializerMethodField()

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
            "show_adult_content",
            "preferred_timezone",
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
    remove_banner = BooleanField(required=False)
    remove_avatar = BooleanField(required=False)
    bio = CharField(required=False, allow_blank=True, max_length=MAX_BIO_LENGTH)
    # No defaults: an omitted field must leave the stored value alone.
    is_private = BooleanField(required=False)
    show_adult_content = BooleanField(required=False)
    profile_primary_color = CharField(required=False, max_length=7)
    preferred_timezone = CharField(required=False, allow_blank=True, max_length=64)

    def validate_bio(self, value):
        return sanitize_bio(value)

    def validate_profile_primary_color(self, value):
        normalized = (value or "").strip().lower()
        if not HEX_COLOR_PATTERN.match(normalized):
            raise ValidationError(
                "Profile primary color must be a valid hex color (e.g., #8b5cf6)."
            )
        return normalized

    def validate_preferred_timezone(self, value):
        normalized = (value or "").strip()
        if not normalized or normalized.lower() == "auto":
            return ""

        try:
            ZoneInfo(normalized)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValidationError(
                "Preferred timezone must be a valid IANA timezone like 'America/New_York'."
            ) from exc

        return normalized

    social_links = JSONField(required=False)

    def validate_social_links(self, value):
        from ...core.services.social_links_service import SocialLinkValidationError
        from ..services.profile_update_service import validate_social_links_input

        try:
            return validate_social_links_input(value)
        except SocialLinkValidationError as e:
            raise ValidationError(str(e))

    def validate_avatar(self, value):
        """Validate the avatar and re-encode it (WebP, no metadata, <= 512 px)."""
        if value is None:
            return value
        try:
            return normalize_profile_image(value, "avatar", max_size=MAX_AVATAR_SIZE)
        except ProfileImageError as exc:
            raise ValidationError(str(exc)) from exc

    def validate_banner(self, value):
        """Validate the banner and re-encode it (WebP, no metadata, <= 2560 px wide)."""
        if value is None:
            return value
        try:
            return normalize_profile_image(value, "banner", max_size=MAX_BANNER_SIZE)
        except ProfileImageError as exc:
            raise ValidationError(str(exc)) from exc


class RegisterSerializer(ModelSerializer):
    # Declared explicitly: the model field is ``blank=True``, which would make
    # the address optional and leave an account that can never verify.
    email = EmailField(required=True, allow_blank=False)
    password = CharField(write_only=True, min_length=8)
    auth_service = AuthService()

    class Meta:
        model = User
        fields = ["username", "email", "password"]

    def validate_username(self, value):
        try:
            return validate_username(value)
        except DjangoValidationError as exc:
            raise ValidationError(list(exc.messages)) from exc

    def validate_email(self, value):
        return value.lower().strip()

    def validate(self, attrs):
        # Validators such as UserAttributeSimilarityValidator need the user's fields.
        candidate = User(username=attrs.get("username"), email=attrs.get("email"))
        try:
            validate_password(attrs["password"], candidate)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def create(self, validated_data):
        return self.auth_service.register_user(validated_data)


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

        try:
            validate_password(attrs["new_password"], user)
        except DjangoValidationError as exc:
            raise ValidationError({"new_password": list(exc.messages)}) from exc

        return attrs
