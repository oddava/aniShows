from django.contrib.auth.models import AbstractUser
from django.db.models import (
    CASCADE,
    SET_NULL,
    BooleanField,
    ForeignKey,
    GenericIPAddressField,
    ImageField,
    Index,
    JSONField,
    Model,
    OneToOneField,
    Q,
    SlugField,
    TextChoices,
    UniqueConstraint,
)
from django.db.models.fields import (
    CharField,
    DateField,
    DateTimeField,
    FloatField,
    IntegerField,
    TextField,
)
from django.db.models.functions import Lower
from django.utils.text import slugify

from root.storage_backends import MediaStorage

from ..shared.models import CreatedAtMixin
from .utils.file_security import badge_image_path, user_avatar_path, user_banner_path


class CustomUser(AbstractUser):
    class Meta(AbstractUser.Meta):
        constraints = [
            # One account per address, whatever its case. Blank emails (some
            # admin-created accounts) are exempt.
            UniqueConstraint(
                Lower("email"),
                condition=~Q(email=""),
                name="users_customuser_email_ci_unique",
            ),
        ]


class UserProfile(Model):
    user = OneToOneField("users.CustomUser", CASCADE, db_index=True)
    avatar = ImageField(upload_to=user_avatar_path, blank=True, null=True, storage=MediaStorage())
    banner = ImageField(upload_to=user_banner_path, blank=True, null=True, storage=MediaStorage())
    bio = TextField(blank=True, null=True)
    last_username_change = DateTimeField(null=True, blank=True)
    is_private = BooleanField(default=False)
    show_adult_content = BooleanField(default=False)
    email_verified = BooleanField(default=False)
    points = IntegerField(default=0)
    social_links = JSONField(default=list, blank=True)
    profile_primary_color = CharField(
        max_length=7,
        default="#8b5cf6",
        help_text="Hex color for profile accent (e.g., #8b5cf6)",
    )
    preferred_timezone = CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="IANA timezone name for localizing timestamps (blank uses auto-detected browser timezone).",
    )
    last_activity = DateTimeField(null=True, blank=True)
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


class UserFollow(CreatedAtMixin, Model):
    follower = ForeignKey("users.CustomUser", CASCADE, related_name="following")
    following = ForeignKey("users.CustomUser", CASCADE, related_name="followers")

    class Meta:
        unique_together = ("follower", "following")
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["follower", "-created_at"]),
            Index(fields=["following", "-created_at"]),
            Index(fields=["follower", "following"]),
            Index(fields=["following", "follower"]),
        ]

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"


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


class SocialLinkChangeLog(CreatedAtMixin, Model):
    class ActionChoices(TextChoices):
        ADD = "add", "Add"
        EDIT = "edit", "Edit"
        DELETE = "delete", "Delete"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="social_link_logs")
    action = CharField(max_length=20, choices=ActionChoices.choices)
    old_value = JSONField(null=True, blank=True)
    new_value = JSONField(default=dict)
    ip_address = GenericIPAddressField()

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "-created_at"], name="soclinklog_user_created_idx"),
            Index(fields=["action", "-created_at"], name="soclinklog_action_created_idx"),
            Index(fields=["created_at"], name="soclinklog_created_idx"),
            Index(fields=["ip_address"], name="soclinklog_ip_address_idx"),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.action} at {self.created_at}"


class Badge(CreatedAtMixin, Model):
    name = CharField(max_length=100)
    slug = SlugField(max_length=100, unique=True, blank=True)
    description = TextField()
    icon = CharField(
        max_length=50, blank=True, help_text="Lucide icon name (e.g., 'award', 'shield')"
    )
    image = ImageField(upload_to=badge_image_path, blank=True, null=True, storage=MediaStorage())
    color = CharField(
        max_length=20, default="blue", help_text="Tailwind color key (e.g., 'yellow', 'purple')"
    )
    priority = IntegerField(
        default=0, help_text="Higher = more prestigious, controls display ordering"
    )
    is_active = BooleanField(default=True, help_text="Whether this badge can still be granted")
    created_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        related_name="created_badges",
    )

    class Meta:
        ordering = ["-priority", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.name)
            slug = base_slug
            counter = 2
            while Badge.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)


class UserBadge(Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="badges")
    badge = ForeignKey(Badge, CASCADE, related_name="user_badges")
    granted_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        related_name="granted_badges",
    )
    granted_at = DateTimeField(auto_now_add=True)
    is_featured = BooleanField(default=False, help_text="User chose to display this badge")
    reason = CharField(
        max_length=255, blank=True, help_text="Optional note for why this was granted"
    )

    class Meta:
        unique_together = ("user", "badge")
        ordering = ["-granted_at"]
        indexes = [
            Index(fields=["user", "is_featured"]),
            Index(fields=["badge"]),
            Index(fields=["user", "-granted_at"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.badge.name}"
