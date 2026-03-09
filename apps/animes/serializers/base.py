from django.conf import settings
from rest_framework import serializers
from rest_framework.serializers import ModelSerializer, SerializerMethodField

from apps.animes.models import (
    Anime,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Genre,
    Staff,
    Studio,
    ThemeSong,
)
from apps.animes.serializers_mixins import ImageUrlMixin

ALLOWED_IMAGE_TYPES = getattr(
    settings,
    "ALLOWED_IMAGE_TYPES",
    ["image/jpeg", "image/png", "image/webp", "image/gif"],
)


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

    try:
        mime = magic.from_buffer(magic_bytes, mime=True)
        if mime not in ALLOWED_IMAGE_TYPES:
            raise serializers.ValidationError(
                f"Invalid file content for {field_name}. Allowed types: JPEG, PNG, WebP, GIF."
            )
    except Exception as e:
        # Fallback if magic fails (e.g. library missing, though it's likely installed)
        from apps.shared.logger import logger
        logger.warning(f"Image magic validation failed for {field_name}: {e}")

    # Verify image can be opened and is not corrupted
    try:
        img = Image.open(file)
        img.verify()  # Verify it's a valid image
        file.seek(0)
    except Exception:
        raise serializers.ValidationError(f"Invalid or corrupted image file for {field_name}.")

    return file


class GenreSerializer(ModelSerializer):
    class Meta:
        model = Genre
        fields = ["id", "name", "slug"]


class StudioSerializer(ModelSerializer):
    class Meta:
        model = Studio
        fields = ["id", "name", "website"]


class CharacterSerializer(ImageUrlMixin, ModelSerializer):
    image = SerializerMethodField()
    image_small = SerializerMethodField()
    image_medium = SerializerMethodField()

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
        return self.get_image_url(obj, "image", "image_url")

    def get_image_small(self, obj):
        return self.get_image_url_with_thumbnail(obj, "image_small", "image", "image_url")

    def get_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(obj, "image_medium", "image", "image_url")


class StaffSerializer(ImageUrlMixin, ModelSerializer):
    image = SerializerMethodField()
    image_small = SerializerMethodField()
    image_medium = SerializerMethodField()

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
        return self.get_image_url(obj, "image", "image_url")

    def get_image_small(self, obj):
        return self.get_image_url_with_thumbnail(obj, "image_small", "image", "image_url")

    def get_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(obj, "image_medium", "image", "image_url")


class AnimeCharacterSerializer(ModelSerializer):
    character = CharacterSerializer(read_only=True)
    voice_actor = StaffSerializer(read_only=True)

    class Meta:
        model = AnimeCharacter
        fields = ["id", "character", "role", "voice_actor"]


class AnimeStaffSerializer(ModelSerializer):
    staff = StaffSerializer(read_only=True)

    class Meta:
        model = AnimeStaff
        fields = ["id", "staff", "role"]


class StaffVoiceRoleAnimeSerializer(ImageUrlMixin, ModelSerializer):
    """Minimal anime serializer for staff detail voice roles."""

    cover_image_small = SerializerMethodField()

    class Meta:
        model = Anime
        fields = ["id", "title", "slug", "cover_image_small"]

    def get_cover_image_small(self, obj):
        return self.get_image_url_with_thumbnail(
            obj, "cover_image_small", "cover_image", "cover_image_external_url"
        )


class StaffVoiceRoleCharacterSerializer(ImageUrlMixin, ModelSerializer):
    """Minimal character serializer for staff detail voice roles."""

    image = SerializerMethodField()

    class Meta:
        model = Character
        fields = ["id", "name", "name_native", "image"]

    def get_image(self, obj):
        return self.get_image_url(obj, "image", "image_url")


class StaffVoiceRoleSerializer(ModelSerializer):
    """Serializer for a voice role entry on the staff detail page."""

    anime = StaffVoiceRoleAnimeSerializer(read_only=True)
    character = StaffVoiceRoleCharacterSerializer(read_only=True)

    class Meta:
        model = AnimeCharacter
        fields = ["id", "anime", "character", "role"]


class StaffProductionCreditSerializer(ModelSerializer):
    """Serializer for a production credit entry on the staff detail page."""

    anime = StaffVoiceRoleAnimeSerializer(read_only=True)

    class Meta:
        model = AnimeStaff
        fields = ["id", "anime", "role"]


class StaffDetailSerializer(ImageUrlMixin, ModelSerializer):
    """Full serializer for the staff detail page."""

    image = SerializerMethodField()
    image_medium = SerializerMethodField()
    voice_roles = StaffVoiceRoleSerializer(many=True, read_only=True)
    production_credits = StaffProductionCreditSerializer(many=True, read_only=True)

    class Meta:
        model = Staff
        fields = [
            "id",
            "anilist_id",
            "name",
            "name_native",
            "image",
            "image_medium",
            "description",
            "voice_roles",
            "production_credits",
        ]

    def get_image(self, obj):
        return self.get_image_url(obj, "image", "image_url")

    def get_image_medium(self, obj):
        return self.get_image_url_with_thumbnail(obj, "image_medium", "image", "image_url")


class ThemeSongSerializer(ModelSerializer):
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
