"""
Serializer mixins for common functionality.
"""


class ImageUrlMixin:
    """
    Mixin to generate absolute URLs for image fields with fallback support.

    This eliminates duplicate code across serializers that need to:
    1. Check if a local image exists
    2. Generate absolute URL if request context is available
    3. Fall back to external URLs if local image doesn't exist
    """

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
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(image_field.url)
            return image_field.url

        if fallback_field_name:
            return getattr(obj, fallback_field_name, None)

        return None

    def get_image_url_with_thumbnail(
        self, obj, thumbnail_field_name, original_field_name, fallback_field_name=None
    ):
        """
        Generate URL for a thumbnail with fallback to original image.

        Args:
            obj: The model instance
            thumbnail_field_name: Name of the thumbnail field (e.g., 'image_small')
            original_field_name: Name of the original image field (e.g., 'image')
            fallback_field_name: Name of the fallback field if neither exists

        Returns:
            str: Absolute URL or external URL or None
        """
        thumbnail_field = getattr(obj, thumbnail_field_name, None)

        if thumbnail_field:
            try:
                request = self.context.get("request")
                if request:
                    return request.build_absolute_uri(thumbnail_field.url)
                return thumbnail_field.url
            except Exception:
                # Fallback to original image if thumbnail fails
                pass

        # Try original image
        original_field = getattr(obj, original_field_name, None)
        if original_field:
            try:
                request = self.context.get("request")
                if request:
                    return request.build_absolute_uri(original_field.url)
                return original_field.url
            except Exception:
                pass

        # Fallback to external URL
        if fallback_field_name:
            return getattr(obj, fallback_field_name, None)

        return None
