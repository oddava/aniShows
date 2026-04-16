from __future__ import annotations

from functools import lru_cache

from .logger import logger


@lru_cache(maxsize=1)
def get_pillow_image_module():
    """Return PIL.Image when available, otherwise log once and return None."""
    try:
        from PIL import Image
    except ImportError:
        logger.exception("Pillow import failed; image processing features are unavailable")
        return None

    return Image
