"""Profile image validation and normalisation (G1 P1-5, A12).

Avatars and banners used to be stored byte for byte after a magic-bytes sniff
and Pillow ``verify()``: EXIF (GPS included) from direct API uploads was kept,
nothing was re-encoded, and the only size control was Pillow's decompression
bomb limit. Every upload, and the Google avatar, now goes through
``normalize_profile_image``: validated, rotated upright, stripped of metadata,
downscaled, and re-encoded as WebP. Animations are cropped and resized frame by
frame into an animated WebP, compressed until they fit the stored size.

This is G1's own copy of the checks in ``animes/serializers/base.py`` so G2 can
change that one freely (spec 1, "Consumes").
"""

from __future__ import annotations

import io
import math
from typing import Literal

import magic
from django.conf import settings
from django.core.files.base import ContentFile, File
from PIL import Image, ImageOps, ImageSequence

from ...shared.logger import logger

ImageKind = Literal["avatar", "banner"]

AVATAR_MAX_SIDE = 512
BANNER_MAX_WIDTH = 2560
# Banners are wide; this only stops a tall one exceeding WebP's 16383 px limit.
BANNER_MAX_HEIGHT = 2560
WEBP_QUALITY = 85
# Frames kept in an animation; a longer one keeps every n-th frame.
GIF_MAX_FRAMES = 120
DEFAULT_FRAME_MS = 100
# Decode budget for an animation: width x height x frames of the source.
MAX_ANIMATION_PIXELS = 400_000_000
# Tried in turn until an animation fits the stored size.
ANIMATED_QUALITIES = (85, 75, 65, 55)
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


def clean_crop(value) -> tuple[int, int, int, int] | None:
    """A crop box from the client, ``{x, y, width, height}`` in source pixels, or None."""
    if value in (None, "", {}):
        return None
    if not isinstance(value, dict):
        raise ProfileImageError("The crop must be an object with x, y, width and height.")
    try:
        box = tuple(round(float(value[key])) for key in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError) as exc:
        raise ProfileImageError("The crop must have numeric x, y, width and height.") from exc
    if box[2] <= 0 or box[3] <= 0:
        raise ProfileImageError("The crop must have a positive width and height.")
    return box  # type: ignore[return-value]


def _crop_box(size: tuple[int, int], crop) -> tuple[int, int, int, int] | None:
    """The crop clamped to the image (left, top, right, bottom), or None for the whole image."""
    if crop is None:
        return None
    width, height = size
    x, y, w, h = crop
    left, top = max(0, min(x, width - 1)), max(0, min(y, height - 1))
    right, bottom = max(left + 1, min(x + w, width)), max(top + 1, min(y + h, height))
    if (left, top, right, bottom) == (0, 0, width, height):
        return None
    return left, top, right, bottom


def _fit(size: tuple[int, int], kind: ImageKind) -> tuple[int, int]:
    width, height = size
    if kind == "avatar":
        scale = min(1.0, AVATAR_MAX_SIDE / max(width, height))
    else:
        scale = min(1.0, BANNER_MAX_WIDTH / width, BANNER_MAX_HEIGHT / height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def normalize_profile_image(
    file: File,
    kind: ImageKind,
    *,
    max_size: int,
    stored_max: int | None = None,
    crop: tuple[int, int, int, int] | None = None,
) -> File:
    """Return a safe file to store for ``kind``, or raise ``ProfileImageError``.

    ``max_size`` caps the upload; ``crop`` (source pixels) is applied first.
    Still images come back as WebP with no metadata, no larger than 512x512
    (avatar) or 2560 px wide (banner). Animations (GIF, animated WebP/PNG) are
    cropped and resized frame by frame into an animated WebP, with quality
    stepped down until the file fits ``stored_max``; a long one keeps every
    n-th frame (timing preserved) so at most 120 remain.
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
    try:
        if getattr(image, "is_animated", False) and frames > 1:
            if width * height * frames > MAX_ANIMATION_PIXELS:
                raise ProfileImageError(
                    f"This animated {label.lower()} is too long or too large to process."
                )
            return _reencode_animated(image, kind, crop, stored_max)
        return _reencode(image, kind, crop)
    except ProfileImageError:
        raise
    except Exception as exc:
        # Unusual sources (16-bit modes, broken frames) fail deep inside Pillow
        # with assorted types; the user gets a 400, never a 500.
        logger.warning("Could not re-encode a %s upload", kind, exc_info=True)
        raise ProfileImageError(f"{label} could not be processed. Try another image.") from exc


def _reencode(image: Image.Image, kind: ImageKind, crop=None) -> File:
    image = ImageOps.exif_transpose(image) or image
    has_alpha = image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info
    )
    image = image.convert("RGBA" if has_alpha else "RGB")
    box = _crop_box(image.size, crop)
    if box is not None:
        image = image.crop(box)
    target = _fit(image.size, kind)
    if target != image.size:
        image = image.resize(target, Image.Resampling.LANCZOS)

    output = io.BytesIO()
    # No exif=/xmp= arguments: nothing from the source's metadata is written.
    image.save(output, format="WEBP", quality=WEBP_QUALITY, method=4)
    return ContentFile(output.getvalue(), name=f"{kind}.webp")


def _reencode_animated(image: Image.Image, kind: ImageKind, crop, stored_max: int | None) -> File:
    """Every frame cropped, resized and written as one animated WebP that fits ``stored_max``."""
    total = image.n_frames
    step = max(1, math.ceil(total / GIF_MAX_FRAMES))
    box = _crop_box(image.size, crop)
    frames: list[Image.Image] = []
    durations: list[int] = []
    for index, frame in enumerate(ImageSequence.Iterator(image)):
        duration = int(frame.info.get("duration") or DEFAULT_FRAME_MS)
        if index % step:
            # A dropped frame's time goes to the one kept before it.
            durations[-1] += duration
            continue
        frame = frame.convert("RGBA")
        if box is not None:
            frame = frame.crop(box)
        frames.append(frame)
        durations.append(duration)

    target = _fit(frames[0].size, kind)
    budget = stored_max or 0
    for scale in (1.0, 0.8, 0.64):
        size = (max(1, round(target[0] * scale)), max(1, round(target[1] * scale)))
        sized = [f.resize(size, Image.Resampling.LANCZOS) if f.size != size else f for f in frames]
        for quality in ANIMATED_QUALITIES:
            output = io.BytesIO()
            sized[0].save(
                output,
                format="WEBP",
                save_all=True,
                append_images=sized[1:],
                duration=durations,
                loop=image.info.get("loop", 0),
                quality=quality,
                method=4,
            )
            data = output.getvalue()
            if not budget or len(data) <= budget:
                return ContentFile(data, name=f"{kind}.webp")
    raise ProfileImageError(
        f"This animated {_LABELS[kind].lower()} stays too heavy even when compressed. "
        "Try a shorter clip."
    )
