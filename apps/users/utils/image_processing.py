"""Profile image validation and normalisation (G1 P1-5, A12).

Avatars and banners used to be stored byte for byte after a magic-bytes sniff
and Pillow ``verify()``: EXIF (GPS included) from direct API uploads was kept,
nothing was re-encoded, and the only size control was Pillow's decompression
bomb limit. Every upload, and the Google avatar, now goes through
``normalize_profile_image``: validated, rotated upright, stripped of metadata,
downscaled, and re-encoded as WebP. Animated GIFs are kept as they are when
they are small enough, since re-encoding animations is lossy and slow.

This is G1's own copy of the checks in ``animes/serializers/base.py`` so G2 can
change that one freely (spec 1, "Consumes").
"""

from __future__ import annotations

import io
from typing import Literal

import magic
from django.conf import settings
from django.core.files.base import ContentFile, File
from PIL import Image, ImageOps

from ...shared.logger import logger

ImageKind = Literal["avatar", "banner"]

AVATAR_MAX_SIDE = 512
BANNER_MAX_WIDTH = 2560
WEBP_QUALITY = 85
GIF_MAX_FRAMES = 120
# Far below Pillow's bomb limit (~179 MP): no phone photo needs more.
MAX_SOURCE_PIXELS = 40_000_000

_LABELS: dict[str, str] = {"avatar": "Avatar", "banner": "Banner"}


class ProfileImageError(ValueError):
    """The upload is not an acceptable profile image; the message is user-facing."""


def _sniff_mime(file: File) -> str | None:
    file.seek(0)
    head = file.read(2048)
    file.seek(0)
    try:
        return magic.from_buffer(head, mime=True)
    except magic.MagicException:
        # If libmagic itself fails, Pillow's checks below still decide.
        logger.warning("Image magic sniffing failed", exc_info=True)
        return None


def _open_verified(file: File, label: str) -> Image.Image:
    try:
        Image.open(file).verify()  # verify() leaves the image unusable; reopen below
        file.seek(0)
        image = Image.open(file)
    except Exception as exc:
        # Pillow signals a bad file with many unrelated types (OSError,
        # SyntaxError, ValueError, struct.error, DecompressionBombError...).
        raise ProfileImageError(f"Invalid or corrupted image file for {label}.") from exc
    return image


def _target_size(image: Image.Image, kind: ImageKind) -> tuple[int, int]:
    width, height = image.size
    if kind == "avatar":
        scale = min(1.0, AVATAR_MAX_SIDE / max(width, height))
    else:
        scale = min(1.0, BANNER_MAX_WIDTH / width)
    return max(1, round(width * scale)), max(1, round(height * scale))


def normalize_profile_image(file: File, kind: ImageKind, *, max_size: int) -> File:
    """Return a safe file to store for ``kind``, or raise ``ProfileImageError``.

    Still images come back as a new WebP ``ContentFile`` with no metadata,
    no larger than 512x512 (avatar) or 2560 px wide (banner). Animated GIFs come
    back unchanged when they have at most 120 frames.
    """
    label = _LABELS[kind]
    if file.size is None or file.size > max_size:
        raise ProfileImageError(
            f"{label} file too large. Maximum size is {max_size // (1024 * 1024)}MB."
        )

    mime = _sniff_mime(file)
    if mime is not None and mime not in settings.ALLOWED_IMAGE_TYPES:
        raise ProfileImageError(
            f"Invalid file content for {label}. Allowed types: JPEG, PNG, WebP, GIF."
        )

    image = _open_verified(file, label)
    width, height = image.size
    if width * height > MAX_SOURCE_PIXELS:
        raise ProfileImageError(f"{label} is too large ({width}x{height} pixels).")

    frames = getattr(image, "n_frames", 1)
    if image.format == "GIF" and frames > 1:
        if frames > GIF_MAX_FRAMES:
            raise ProfileImageError(
                f"Animated {label.lower()}s can have at most {GIF_MAX_FRAMES} frames."
            )
        file.seek(0)
        return file

    image = ImageOps.exif_transpose(image) or image
    has_alpha = image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info
    )
    image = image.convert("RGBA" if has_alpha else "RGB")
    target = _target_size(image, kind)
    if target != image.size:
        image = image.resize(target, Image.Resampling.LANCZOS)

    output = io.BytesIO()
    # No exif=/xmp= arguments: nothing from the source's metadata is written.
    image.save(output, format="WEBP", quality=WEBP_QUALITY, method=4)
    return ContentFile(output.getvalue(), name=f"{kind}.webp")
