"""Slugs for admin-created records: typed ones checked, generated ones made to fit."""

from __future__ import annotations

from django.utils.text import slugify
from rest_framework.exceptions import ValidationError


def unique_slug(model, instance, attrs) -> str:
    """The given slug, else the current one (an update), else one made from the name.

    A slug made from the name is cut to the column's length and, if taken, gets
    a ``-2``, ``-3`` … suffix; a slug the admin typed must be free as given.
    """
    max_length = model._meta.get_field("slug").max_length
    clashes = model.objects.all() if instance is None else model.objects.exclude(pk=instance.pk)
    if attrs.get("slug"):
        slug = slugify(attrs["slug"])[:max_length].strip("-")
        if slug and clashes.filter(slug=slug).exists():
            raise ValidationError({"slug": "This slug is already taken."})
    elif instance is not None and "slug" not in attrs:
        return instance.slug
    else:
        name = attrs.get("name") or getattr(instance, "name", "")
        # A name with no Latin letters (冒険) slugifies to nothing: use the
        # record type instead ("genre", "genre-2"), rather than an error about
        # a field the admin left blank.
        base = (slugify(name) or (model._meta.model_name if name else ""))[:max_length].strip("-")
        slug = base
        suffix = 2
        while base and clashes.filter(slug=slug).exists():
            tail = f"-{suffix}"
            slug = f"{base[: max_length - len(tail)].rstrip('-')}{tail}"
            suffix += 1
    if not slug:
        raise ValidationError({"slug": "Enter a name or slug with letters or digits."})
    return slug
