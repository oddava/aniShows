from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Model, ForeignKey
from django.db.models.enums import TextChoices
from django.db.models.fields import TextField
from django.db.models.fields import IntegerField, DateField, FloatField, CharField, URLField


class Anime(Model):
    class AnimeType(TextChoices):
        tv = 'TV'
        movie = 'Movie'
        ova = 'OVA'
        special = 'Special'

    class AnimeStatus(TextChoices):
        airing = 'Airing'
        finished = 'Finished'
        upcoming = 'Upcoming'


    title = CharField(max_length=255)
    japanese_title = CharField(max_length=255)
    synopsis = TextField(blank=True)
    cover_image = URLField(blank=True)
    trailer_url = URLField(blank=True)
    type = CharField(max_length=20, choices=AnimeType.choices)
    status = CharField(max_length=20, choices=AnimeStatus.choices)
    episodes = IntegerField(default=0)
    genres = ArrayField(models.CharField(max_length=50), default=list)
    score = FloatField(default=0.0)
    popularity = IntegerField(default=0)
    release_date = DateField(null=True, blank=True)

class Review(models.Model):
    user = ForeignKey("core.UserProfile", on_delete=models.CASCADE)
    anime = ForeignKey("core.Anime", on_delete=models.CASCADE)
    rating = IntegerField(default=0)
    text = TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)