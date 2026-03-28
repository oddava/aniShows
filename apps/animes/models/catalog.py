from django.db.models import (
    CharField,
    DateField,
    ImageField,
    IntegerField,
    Model,
    SlugField,
    TextField,
    URLField,
)
from imagekit.models import ImageSpecField
from imagekit.processors import ResizeToFit

from root.storage_backends import MediaStorage


class Genre(Model):
    name = CharField(max_length=50, unique=True)
    slug = SlugField(max_length=50, unique=True)
    description = TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Studio(Model):
    name = CharField(max_length=100, unique=True)
    founded_date = DateField(null=True, blank=True)
    website = URLField(blank=True)

    def __str__(self):
        return self.name


class Character(Model):
    anilist_id = IntegerField(null=True, blank=True, unique=True, db_index=True)
    name = CharField(max_length=200)
    name_native = CharField(max_length=200, blank=True)
    image = ImageField(upload_to="characters/", blank=True, null=True, storage=MediaStorage())
    image_small = ImageSpecField(
        source="image",
        processors=[ResizeToFit(60, 90)],
        format="WEBP",
        options={"quality": 80},
    )
    image_medium = ImageSpecField(
        source="image",
        processors=[ResizeToFit(150, 225)],
        format="WEBP",
        options={"quality": 85},
    )
    image_url = URLField(blank=True, null=True)
    description = TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Staff(Model):
    anilist_id = IntegerField(null=True, blank=True, unique=True, db_index=True)
    name = CharField(max_length=200)
    name_native = CharField(max_length=200, blank=True)
    image = ImageField(upload_to="staff/", blank=True, null=True, storage=MediaStorage())
    image_small = ImageSpecField(
        source="image",
        processors=[ResizeToFit(60, 90)],
        format="WEBP",
        options={"quality": 80},
    )
    image_medium = ImageSpecField(
        source="image",
        processors=[ResizeToFit(150, 225)],
        format="WEBP",
        options={"quality": 85},
    )
    image_url = URLField(blank=True, null=True)
    description = TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name
