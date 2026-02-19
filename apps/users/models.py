from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import (
    OneToOneField,
    CASCADE,
    Model,
    ForeignKey,
    TextChoices,
    EmailField,
    ImageField,
    BooleanField,
    Index,
)
from django.db.models.fields import (
    TextField,
    URLField,
    CharField,
    IntegerField,
    FloatField,
    DateTimeField,
)
from django.conf import settings
from root.storage_backends import MediaStorage
from apps.api.utils.file_security import user_avatar_path, user_banner_path


class CustomUser(AbstractUser):
    pass


class UserProfile(Model):
    user = OneToOneField(settings.AUTH_USER_MODEL, on_delete=CASCADE, db_index=True)
    avatar = ImageField(
        upload_to=user_avatar_path, blank=True, null=True, storage=MediaStorage()
    )
    banner = ImageField(
        upload_to=user_banner_path, blank=True, null=True, storage=MediaStorage()
    )
    bio = TextField(blank=True, null=True)
    last_username_change = DateTimeField(null=True, blank=True)
    is_private = BooleanField(default=False)
    email_verified = BooleanField(default=False)

    # Reputation points from helpful review votes
    points = IntegerField(default=0)

    # Dynamic social links
    social_links = models.JSONField(default=list, blank=True)

    # Track last activity for online status
    last_activity = DateTimeField(null=True, blank=True)
    # preferred_genres = ArrayField(CharField(max_length=50), default=list)
    # telegram_id = BigIntegerField(null=True, blank=True)

    # Notification preferences
    email_new_episodes = BooleanField(default=True)
    push_new_episodes = BooleanField(default=True)
    push_review_replies = BooleanField(default=True)
    push_new_follower = BooleanField(default=True)


class UserAnimeList(Model):
    class UserAnimeStatus(TextChoices):
        watching = "Watching"
        completed = "Completed"
        on_hold = "On Hold"
        dropped = "Dropped"
        plan_to_watch = "Plan to Watch"

    user = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="anime_lists"
    )
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name="user_lists")
    status = CharField(max_length=20, choices=UserAnimeStatus.choices)
    score = IntegerField(default=0)
    episodes_watched = IntegerField(default=0)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["-updated_at"]
        indexes = [
            Index(fields=["user", "status"]),
            Index(fields=["-updated_at"]),
            Index(fields=["anime", "status"]),
            Index(fields=["anime", "user"]),
            Index(fields=["status", "anime"]),
            Index(fields=["user", "-updated_at"]),
            Index(fields=["user", "score"]),
            Index(fields=["anime", "score"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.anime.title} ({self.status})"


class UserImportJob(models.Model):
    """Track async import jobs for users"""

    class ImportStatus(models.TextChoices):
        pending = "pending", "Pending"
        processing = "processing", "Processing"
        completed = "completed", "Completed"
        failed = "failed", "Failed"

    class ImportSource(models.TextChoices):
        myanimelist_api = "mal_api", "MyAnimeList API"
        myanimelist_xml = "mal_xml", "MyAnimeList XML"
        anilist = "anilist", "AniList"

    user = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="import_jobs"
    )
    source = CharField(max_length=20, choices=ImportSource.choices)
    status = CharField(
        max_length=20, choices=ImportStatus.choices, default=ImportStatus.pending
    )

    # Progress tracking
    total_entries = IntegerField(default=0)
    processed_entries = IntegerField(default=0)
    imported_entries = IntegerField(default=0)
    skipped_entries = IntegerField(default=0)
    failed_entries = IntegerField(default=0)
    fetched_entries = IntegerField(default=0)  # Anime fetched from external API

    # Error tracking
    errors = models.JSONField(default=list, blank=True)

    # Source identifier (username, file path, etc.)
    source_identifier = CharField(max_length=255, blank=True)

    # Timestamps
    created_at = DateTimeField(auto_now_add=True)
    started_at = DateTimeField(null=True, blank=True)
    completed_at = DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "-created_at"]),
            Index(fields=["status", "created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.source} ({self.status})"

    @property
    def progress_percentage(self):
        if self.total_entries == 0:
            return 0
        return int((self.processed_entries / self.total_entries) * 100)


class UserFollow(Model):
    """Track user following relationships"""

    follower = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="following"
    )
    following = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="followers"
    )
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("follower", "following")
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["follower", "-created_at"]),
            Index(fields=["following", "-created_at"]),
            Index(fields=["follower", "following"]),  # For checking mutual follows
            Index(fields=["following", "follower"]),  # For reverse lookups
        ]

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"


class UserStats(Model):
    """Materialized view for user statistics - updated every 5 minutes via Celery.

    This table stores pre-calculated statistics to avoid expensive COUNT and SUM
    queries on the profile page. Data is batch-updated every 5 minutes.
    """

    user = OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=CASCADE,
        related_name="stats",
        primary_key=True,
    )

    # Social stats
    followers_count = IntegerField(default=0)
    following_count = IntegerField(default=0)

    # Anime stats
    anime_count = IntegerField(default=0)
    episodes_watched = IntegerField(default=0)
    total_minutes = IntegerField(default=0)
    days_watched = FloatField(default=0.0)
    mean_score = FloatField(null=True, blank=True)

    # Activity stats
    favorites_count = IntegerField(default=0)
    reviews_count = IntegerField(default=0)

    # Metadata
    last_updated = DateTimeField(auto_now=True)
    is_active = BooleanField(default=True)

    class Meta:
        db_table = "users_userstats"
        ordering = ["-last_updated"]
        indexes = [
            Index(fields=["-last_updated"]),
            Index(fields=["is_active", "-last_updated"]),
        ]

    def __str__(self):
        return f"Stats for {self.user.username}"

    @property
    def calculated_days_watched(self):
        """Calculate days from total minutes."""
        return round(self.total_minutes / 1440.0, 1)
