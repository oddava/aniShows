"""Secure file upload utilities for user and anime media."""

import os
import uuid

from django.core.exceptions import ValidationError


def generate_secure_filename(filename, allowed_extensions=None):
    """
    Generate a secure, random filename to prevent path traversal attacks.

    Args:
        filename: Original filename
        allowed_extensions: List of allowed file extensions (e.g., ['jpg', 'png'])

    Returns:
        Secure random filename with preserved extension

    Raises:
        ValidationError: If extension is not allowed or filename is invalid
    """
    if not filename:
        raise ValidationError("Filename cannot be empty")

    # Extract extension
    _name, ext = os.path.splitext(filename)
    if not ext:
        raise ValidationError("File must have an extension")

    # Clean extension (remove leading dot and convert to lowercase)
    ext = ext.lower().lstrip(".")

    # Validate extension
    if allowed_extensions and ext not in allowed_extensions:
        raise ValidationError(
            f"File extension '.{ext}' is not allowed. Allowed: {', '.join(allowed_extensions)}"
        )

    # Generate secure random filename
    secure_name = uuid.uuid4().hex

    return f"{secure_name}.{ext}"


def user_avatar_path(instance, filename):
    """
    Generate secure upload path for user avatars.
    Stores files in avatars/<user_id>/<secure_filename>
    """
    from ..models import UserProfile

    user_id = instance.user.id if isinstance(instance, UserProfile) else instance.id

    secure_filename = generate_secure_filename(
        filename, allowed_extensions=["jpg", "jpeg", "png", "webp", "gif"]
    )

    return f"avatars/{user_id}/{secure_filename}"


def user_banner_path(instance, filename):
    """
    Generate secure upload path for user banners.
    Stores files in banners/<user_id>/<secure_filename>
    """
    from ..models import UserProfile

    user_id = instance.user.id if isinstance(instance, UserProfile) else instance.id

    secure_filename = generate_secure_filename(
        filename, allowed_extensions=["jpg", "jpeg", "png", "webp", "gif"]
    )

    return f"banners/{user_id}/{secure_filename}"


def anime_image_path(instance, filename, image_type="cover"):
    """
    Generate secure upload path for anime images.
    Stores files in anime/<image_type>/<anime_id>/<secure_filename>
    """
    anime_id = instance.id

    secure_filename = generate_secure_filename(
        filename, allowed_extensions=["jpg", "jpeg", "png", "webp"]
    )

    return f"anime/{image_type}/{anime_id}/{secure_filename}"


def badge_image_path(instance, filename):
    """
    Generate secure upload path for badge images.
    Stores files in badges/<secure_filename>
    """
    secure_filename = generate_secure_filename(
        filename, allowed_extensions=["jpg", "jpeg", "png", "webp", "svg", "gif"]
    )

    return f"badges/{secure_filename}"
