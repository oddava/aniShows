from apps.shared.logger import logger
"""
Serializer mixins for common functionality.
"""

from imagekit.cachefiles import ImageCacheFile

class ImageUrlMixin:
    """
    Mixin to generate absolute URLs for image fields with fallback support.

    This eliminates duplicate code across serializers that need to:
    1. Check if a local image exists
    2. Generate absolute URL if request context is available
    3. Fall back to external URLs if local image doesn't exist

    Handles ImageKit's Optimistic strategy with S3/MinIO storage, where
    thumbnails may not be generated until explicitly triggered.
    """

    def _build_url(self, field):
        """Build absolute URL from an image field using request context."""
        url = field.url
        # S3 storage returns full absolute URLs already — don't double-prefix
        if url and url.startswith(("http://", "https://")):
            return url
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(url)
        return url

    def _ensure_thumbnail(self, thumbnail_field):
        if not isinstance(thumbnail_field, ImageCacheFile):
            return self._build_url(thumbnail_field)

        thumbnail_field.generate()
        return self._build_url(thumbnail_field)

    def get_image_url(self, obj, field_name, fallback_field_name=None):
        """
        Generate absolute URL for an image field.

        Args:
            obj: The model instance
            field_name: Name of the image field (e.g., 'image', 'cover_image')
            fallback_field_name: Name of the fallback field if image doesn't exist (e.g., 'image_url')

        Returns:
            str: Absolute URL or external URL or None
        """
        image_field = getattr(obj, field_name, None)

        if image_field:
            try:
                return self._build_url(image_field)
            except Exception:
                pass

        if fallback_field_name:
            return getattr(obj, fallback_field_name, None)

        return None

    def get_image_url_with_thumbnail(
        self, obj, thumbnail_field_name, original_field_name, fallback_field_name=None
    ):
        """
        Generate URL for a thumbnail with fallback to original image.

        Fallback chain: thumbnail → original image → external URL → None.
        Thumbnails are generated on-demand if they don't exist in storage.

        Args:
            obj: The model instance
            thumbnail_field_name: Name of the thumbnail field (e.g., 'image_small')
            original_field_name: Name of the original image field (e.g., 'image')
            fallback_field_name: Name of the fallback field if neither exists

        Returns:
            str: Absolute URL or external URL or None
        """
        # Try thumbnail (ImageKit ImageSpecField)
        thumbnail_field = getattr(obj, thumbnail_field_name, None)
        if thumbnail_field:
            try:
                return self._ensure_thumbnail(thumbnail_field)
            except Exception:
                pass

        # Try original image
        original_field = getattr(obj, original_field_name, None)
        if original_field:
            try:
                return self._build_url(original_field)
            except Exception:
                pass

        # Fallback to external URL
        if fallback_field_name:
            return getattr(obj, fallback_field_name, None)
        return None

class UserStatusMixin:
    """
    Mixin for serializers that need is_favorite and user_list_status fields.
    Used by AnimeMinimalSerializer, AnimeListSerializer, AnimeDetailSerializer.
    """

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
                "notes": entry.notes,
                "started_at": entry.started_at,
                "finished_at": entry.finished_at,
                "is_rewatching": entry.is_rewatching,
                "progress": (entry.episodes_watched / obj.episode_count * 100)
                if obj.episode_count and obj.episode_count > 0
                else 0,
            }
        return None

class UserProfileMixin:
    """
    Mixin for serializers that need profile-derived fields (avatar, bio, etc.).
    Used by UserSerializer, UserLightweightSerializer, PublicUserSerializer.
    """

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

class BadgesMixin:
    """
    Mixin for serializers that display user badges.
    Used by UserSerializer and PublicUserSerializer.

    Expects the queryset to prefetch badges via:
        Prefetch("badges", queryset=..., to_attr="_prefetched_badges")
    Falls back to a DB query if prefetch is not available (e.g. single object lookups).
    """

    def get_badges(self, obj):
        # Use prefetched badges if available (no DB query)
        if hasattr(obj, "_prefetched_badges"):
            user_badges = obj._prefetched_badges
        else:
            # Fallback for non-prefetched paths (e.g. single user serialization in auth views)
            user_badges = obj.badges.filter(badge__is_active=True, is_featured=True).select_related(
                "badge"
            )[:3]

        return [
            {
                "id": ub.badge.id,
                "name": ub.badge.name,
                "slug": ub.badge.slug,
                "icon": ub.badge.icon,
                "image": ub.badge.image.url if ub.badge.image else None,
                "color": ub.badge.color,
                "description": ub.badge.description,
            }
            for ub in user_badges
        ]