from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import OneToOneField, CASCADE, Model, ForeignKey, TextChoices, EmailField, ImageField, BooleanField, Index
from django.db.models.fields import TextField, URLField, CharField, IntegerField, DateTimeField
from django.conf import settings
from root.storage_backends import MediaStorage


class CustomUser(AbstractUser):
    pass


class UserProfile(Model):
    user = OneToOneField(settings.AUTH_USER_MODEL, on_delete=CASCADE)
    avatar = ImageField(upload_to='avatars/', blank=True, null=True, storage=MediaStorage())
    banner = ImageField(upload_to='banners/', blank=True, null=True, storage=MediaStorage())
    bio = TextField(blank=True, null=True)
    last_username_change = DateTimeField(null=True, blank=True)
    is_private = BooleanField(default=False)
    email_verified = BooleanField(default=False)
    # preferred_genres = ArrayField(CharField(max_length=50), default=list)
    # telegram_id = BigIntegerField(null=True, blank=True)


class UserAnimeList(Model):
    class UserAnimeStatus(TextChoices):
        watching = "Watching"
        completed = "Completed"
        on_hold = "On Hold"
        dropped = "Dropped"
        plan_to_watch = "Plan to Watch"

    user = ForeignKey(settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name='anime_lists')
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name='user_lists')
    status = CharField(max_length=20, choices=UserAnimeStatus.choices)
    score = IntegerField(default=0)
    episodes_watched = IntegerField(default=0)
    updated_at = DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = ('user', 'anime')
        ordering = ['-updated_at']
        indexes = [
            Index(fields=['user', 'status']),
            Index(fields=['-updated_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.anime.title} ({self.status})"