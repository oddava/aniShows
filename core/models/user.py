from django.contrib.auth.models import User
from django.contrib.postgres.fields import ArrayField
from django.db.models import OneToOneField, CASCADE, Model, ForeignKey, TextChoices
from django.db.models.fields import TextField, URLField, BigIntegerField, CharField, IntegerField, DateTimeField

class UserProfile(Model):
    user = OneToOneField(User, on_delete=CASCADE)
    avatar = URLField(blank=True, null=True)
    bio = TextField(blank=True, null=True)
    preferred_genres = ArrayField(CharField(max_length=50), default=list)
    telegram_id = BigIntegerField(null=True, blank=True)

class UserAnimeList(Model):
    class UserAnimeStatus(TextChoices):
        watching = "Watching",
        completed = "Completed",
        on_hold = "On Hold",
        dropped = "Dropped",
        plan_to_watch = "Plan to Watch",

    user = ForeignKey(User, on_delete=CASCADE)
    anime = ForeignKey("core.Anime", on_delete=CASCADE)
    status = CharField(max_length=20, choices=UserAnimeStatus.choices)
    score = IntegerField(default=0)
    episodes_watched = IntegerField(default=0)
    updated_at = DateTimeField(auto_now=True)
