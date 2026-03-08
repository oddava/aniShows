import os
from io import BytesIO

from django.core.files.storage import default_storage
from django.http import HttpResponse, HttpResponseNotFound
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.http import require_http_methods
from PIL import Image

from apps.shared.logger import logger

IMAGE_FORMATS = {
    "JPEG": {"format": "JPEG", "mime": "image/jpeg"},
    "PNG": {"format": "PNG", "mime": "image/png"},
    "WEBP": {"format": "WEBP", "mime": "image/webp"},
}

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

MAX_DIMENSION = 1920

class ImageResizeView(View):
    """On-demand image resizing view.

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
            width = request.GET.get("w")
            height = request.GET.get("h")
            output_format = request.GET.get("format", "webp").upper()
            quality = int(request.GET.get("quality", 85))

            if output_format not in IMAGE_FORMATS:
                output_format = "WEBP"

            quality = max(1, min(100, quality))

            if not width and not height:
                return self._serve_original(filepath)

            try:
                width = int(width) if width else None
                height = int(height) if height else None
            except ValueError:
                return HttpResponse("Invalid dimensions", status=400)

            if width and width > MAX_DIMENSION:
                width = MAX_DIMENSION
            if height and height > MAX_DIMENSION:
                height = MAX_DIMENSION

            if not default_storage.exists(filepath):
                logger.warning(f"Image not found: {filepath}")
                return HttpResponseNotFound("Image not found")

            with default_storage.open(filepath, "rb") as f:
                image = Image.open(f)

                if output_format in ["JPEG", "WEBP"] and image.mode in ("RGBA", "P"):
                    image = image.convert("RGB")

                orig_width, orig_height = image.size

                if width and not height:
                    ratio = width / orig_width
                    height = int(orig_height * ratio)
                elif height and not width:
                    ratio = height / orig_height
                    width = int(orig_width * ratio)
                elif width and height:
                    # Both provided - use as-is but maintain aspect if one is None
                    pass
                else:
                    return self._serve_original(filepath)

                image = image.resize((width, height), Image.Resampling.LANCZOS)

                buffer = BytesIO()
                save_kwargs = {"quality": quality, "optimize": True}
                if output_format == "WEBP":
                    save_kwargs["method"] = 6  # Best compression

                image.save(buffer, format=IMAGE_FORMATS[output_format]["format"], **save_kwargs)
                buffer.seek(0)

                response = HttpResponse(
                    buffer.getvalue(), content_type=IMAGE_FORMATS[output_format]["mime"]
                )

                response["Cache-Control"] = "public, max-age=31536000, immutable"
                response["Vary"] = "Accept"

                return response

        except Exception as e:
            logger.error(f"Error resizing image {filepath}: {e!s}")
            return self._serve_original(filepath)

    def _serve_original(self, filepath):
        try:
            if not default_storage.exists(filepath):
                return HttpResponseNotFound("Image not found")

            with default_storage.open(filepath, "rb") as f:
                content = f.read()

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
            logger.error(f"Error serving original image {filepath}: {e!s}")
            return HttpResponseNotFound("Image not found")
