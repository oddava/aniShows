import os
from io import BytesIO
from django.http import HttpResponse, HttpResponseNotFound
from django.core.files.storage import default_storage
from django.views.decorators.http import require_http_methods
from django.utils.decorators import method_decorator
from django.views import View
from PIL import Image
from apps.shared.logger import logger

# Supported image formats and their MIME types
IMAGE_FORMATS = {
    "JPEG": {"format": "JPEG", "mime": "image/jpeg"},
    "PNG": {"format": "PNG", "mime": "image/png"},
    "WEBP": {"format": "WEBP", "mime": "image/webp"},
}

# Valid resize dimensions to prevent abuse
VALID_DIMENSIONS = {
    "cover": {
        "small": (150, 225),
        "medium": (230, 345),
        "large": (300, 450),
    },
    "banner": {
        "small": (400, 225),
        "medium": (800, 450),
        "large": (1200, 675),
    },
    "character": {
        "small": (60, 90),
        "medium": (150, 225),
    },
    "staff": {
        "small": (60, 90),
        "medium": (150, 225),
    },
}

# Maximum allowed dimensions (security)
MAX_DIMENSION = 1920

class ImageResizeView(View):
    """
    On-demand image resizing view.

    URL pattern: /media/resize/<path:filepath>?w=<width>&h=<height>&format=<format>

    Query parameters:
    - w: Target width (optional)
    - h: Target height (optional)
    - format: Output format (webp, jpeg, png) - defaults to webp
    - quality: JPEG/WEBP quality 1-100 (default: 85)
    """

    @method_decorator(require_http_methods(["GET"]))
    def get(self, request, filepath):
        try:
            # Get resize parameters
            width = request.GET.get("w")
            height = request.GET.get("h")
            output_format = request.GET.get("format", "webp").upper()
            quality = int(request.GET.get("quality", 85))

            # Validate format
            if output_format not in IMAGE_FORMATS:
                output_format = "WEBP"

            # Validate quality
            quality = max(1, min(100, quality))

            # Check if we need to resize
            if not width and not height:
                # Return original file
                return self._serve_original(filepath)

            # Parse dimensions
            try:
                width = int(width) if width else None
                height = int(height) if height else None
            except ValueError:
                return HttpResponse("Invalid dimensions", status=400)

            # Security: Limit maximum dimensions
            if width and width > MAX_DIMENSION:
                width = MAX_DIMENSION
            if height and height > MAX_DIMENSION:
                height = MAX_DIMENSION

            # Check if file exists
            if not default_storage.exists(filepath):
                logger.warning(f"Image not found: {filepath}")
                return HttpResponseNotFound("Image not found")

            # Open and resize image
            with default_storage.open(filepath, "rb") as f:
                image = Image.open(f)

                # Convert to RGB if necessary (for WEBP/JPEG)
                if output_format in ["JPEG", "WEBP"] and image.mode in ("RGBA", "P"):
                    image = image.convert("RGB")

                # Calculate new dimensions maintaining aspect ratio
                orig_width, orig_height = image.size

                if width and not height:
                    # Scale based on width
                    ratio = width / orig_width
                    height = int(orig_height * ratio)
                elif height and not width:
                    # Scale based on height
                    ratio = height / orig_height
                    width = int(orig_width * ratio)
                elif width and height:
                    # Both provided - use as-is but maintain aspect if one is None
                    pass
                else:
                    # No dimensions provided
                    return self._serve_original(filepath)

                # Resize image
                image = image.resize((width, height), Image.Resampling.LANCZOS)

                # Save to buffer
                buffer = BytesIO()
                save_kwargs = {"quality": quality, "optimize": True}
                if output_format == "WEBP":
                    save_kwargs["method"] = 6  # Best compression

                image.save(buffer, format=IMAGE_FORMATS[output_format]["format"], **save_kwargs)
                buffer.seek(0)

                # Build response with caching headers
                response = HttpResponse(
                    buffer.getvalue(), content_type=IMAGE_FORMATS[output_format]["mime"]
                )

                # Add aggressive caching headers
                response["Cache-Control"] = "public, max-age=31536000, immutable"
                response["Vary"] = "Accept"

                return response

        except Exception as e:
            logger.error(f"Error resizing image {filepath}: {str(e)}")
            # Return original file on error
            return self._serve_original(filepath)

    def _serve_original(self, filepath):
        """Serve the original image file."""
        try:
            if not default_storage.exists(filepath):
                return HttpResponseNotFound("Image not found")

            with default_storage.open(filepath, "rb") as f:
                content = f.read()

            # Determine content type
            ext = os.path.splitext(filepath)[1].lower()
            content_type = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
                ".gif": "image/gif",
            }.get(ext, "application/octet-stream")

            response = HttpResponse(content, content_type=content_type)
            response["Cache-Control"] = "public, max-age=86400"
            return response

        except Exception as e:
            logger.error(f"Error serving original image {filepath}: {str(e)}")
            return HttpResponseNotFound("Image not found")
