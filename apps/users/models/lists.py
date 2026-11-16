"""List models (G3 Lists & AniList sync): entries, activity, import jobs, stats."""

from django.db.models import (
    CASCADE,
    BooleanField,
    ForeignKey,
    Index,
    JSONField,
    Model,
    OneToOneField,
    TextChoices,
)
from django.db.models.fields import (
    CharField,
    DateField,
    DateTimeField,
    FloatField,
    IntegerField,
    TextField,
)

from ...shared.models import CreatedAtMixin

__all__ = [
    "UserActivity",
    "UserAnimeList",
    "UserImportJob",
    "UserStats",
]


class UserAnimeList(Model):
    class UserAnimeStatus(TextChoices):
        watching = "Watching"
        completed = "Completed"
        on_hold = "On Hold"
        dropped = "Dropped"
        plan_to_watch = "Plan to Watch"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="anime_lists")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="user_lists")
    status = CharField(max_length=20, choices=UserAnimeStatus.choices)
    score = IntegerField(default=0)
    episodes_watched = IntegerField(default=0)
    notes = TextField(blank=True, default="")
    started_at = DateField(null=True, blank=True)
    finished_at = DateField(null=True, blank=True)
    total_rewatches = IntegerField(default=0)
    is_rewatching = BooleanField(default=False)
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


class UserActivity(CreatedAtMixin, Model):
    class ActivityType(TextChoices):
        ADDED = "added", "Added to List"
        STATUS_CHANGE = "status_change", "Status Changed"
        PROGRESS = "progress", "Progress Updated"
        SCORE_CHANGE = "score", "Score Changed"
        COMPLETED = "completed", "Completed"
        REMOVED = "removed", "Removed from List"
        REWATCHING = "rewatching", "Started Rewatching"
        NOTES_UPDATE = "notes_update", "Notes Updated"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="activities")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="user_activities")
    activity_type = CharField(max_length=20, choices=ActivityType.choices)
    old_status = CharField(max_length=20, blank=True, null=True)
    new_status = CharField(max_length=20, blank=True, null=True)
    old_episodes = IntegerField(null=True, blank=True)
    new_episodes = IntegerField(null=True, blank=True)
    old_score = IntegerField(null=True, blank=True)
    new_score = IntegerField(null=True, blank=True)
    notes = TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "-created_at"]),
            Index(fields=["anime", "user"]),
            Index(fields=["user", "activity_type"]),
        ]
        verbose_name_plural = "User activities"

    def __str__(self):
        return f"{self.user.username} - {self.activity_type} - {self.anime.title}"


class UserImportJob(CreatedAtMixin, Model):
    class ImportStatus(TextChoices):
        pending = "pending", "Pending"
        processing = "processing", "Processing"
        completed = "completed", "Completed"
        failed = "failed", "Failed"

    class ImportSource(TextChoices):
        myanimelist_api = "mal_api", "MyAnimeList API"
        myanimelist_xml = "mal_xml", "MyAnimeList XML"
        anilist = "anilist", "AniList"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="import_jobs")
    source = CharField(max_length=20, choices=ImportSource.choices)
    status = CharField(max_length=20, choices=ImportStatus.choices, default=ImportStatus.pending)
    total_entries = IntegerField(default=0)
    processed_entries = IntegerField(default=0)
    imported_entries = IntegerField(default=0)
    skipped_entries = IntegerField(default=0)
    failed_entries = IntegerField(default=0)
    fetched_entries = IntegerField(default=0)
    errors = JSONField(default=list, blank=True)
    source_identifier = CharField(max_length=255, blank=True)
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


class UserStats(Model):
    user = OneToOneField(
        "users.CustomUser",
        CASCADE,
        related_name="stats",
        primary_key=True,
    )
    followers_count = IntegerField(default=0)
    following_count = IntegerField(default=0)
    anime_count = IntegerField(default=0)
    episodes_watched = IntegerField(default=0)
    total_minutes = IntegerField(default=0)
    days_watched = FloatField(default=0.0)
    mean_score = FloatField(null=True, blank=True)
    favorites_count = IntegerField(default=0)
    reviews_count = IntegerField(default=0)
    resonance_count = IntegerField(default=0)
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
        return round(self.total_minutes / 1440.0, 1)
