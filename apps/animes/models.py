from django.contrib.postgres.indexes import GinIndex
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db.models import (
    CASCADE,
    SET_NULL,
    BooleanField,
    CharField,
    DateField,
    DateTimeField,
    DecimalField,
    ForeignKey,
    ImageField,
    IntegerField,
    JSONField,
    ManyToManyField,
    Model,
    OneToOneField,
    SlugField,
    TextField,
    URLField,
)
from django.db.models.enums import TextChoices
from django.db.models.indexes import Index
from django.utils import timezone
from imagekit.models import ImageSpecField
from imagekit.processors import ResizeToFit

from apps.shared.models import CreatedAtMixin, SlugMixin, TimestampMixin
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


class Anime(TimestampMixin, SlugMixin, Model):
    class AnimeType(TextChoices):
        tv = "TV"
        movie = "Movie"
        ova = "OVA"
        ona = "ONA"
        special = "Special"
        unknown = "Unknown"

    class AnimeStatus(TextChoices):
        airing = "Airing"
        finished = "Finished"
        upcoming = "Upcoming"
        unknown = "Unknown"

    class SourceMaterial(TextChoices):
        original = "Original", "Original"
        manga = "Manga", "Manga"
        light_novel = "Light Novel", "Light Novel"
        visual_novel = "Visual Novel", "Visual Novel"
        game = "Game", "Game"
        web_manga = "Web Manga", "Web Manga"
        novel = "Novel", "Novel"
        music = "Music", "Music"
        mixed_media = "Mixed Media", "Mixed Media"
        picture_book = "Picture Book", "Picture Book"
        card_game = "Card Game", "Card Game"
        other = "Other", "Other"

    title = CharField(max_length=200, unique=True)
    title_jp = CharField(max_length=200, blank=True)
    synopsis = TextField()
    anime_type = CharField(max_length=20, choices=AnimeType.choices, default=AnimeType.tv)
    status = CharField(max_length=20, choices=AnimeStatus.choices, default=AnimeStatus.airing)
    episode_count = IntegerField(default=0)
    duration_minutes = IntegerField(default=24)
    member_count = IntegerField(default=0)

    release_date = DateField(null=True, blank=True)
    end_date = DateField(null=True, blank=True)

    cover_image = ImageField(
        upload_to="anime/covers/", blank=True, null=True, storage=MediaStorage()
    )
    cover_image_small = ImageSpecField(
        source="cover_image",
        processors=[ResizeToFit(150, 225)],
        format="WEBP",
        options={"quality": 85},
    )
    cover_image_medium = ImageSpecField(
        source="cover_image",
        processors=[ResizeToFit(230, 345)],
        format="WEBP",
        options={"quality": 85},
    )
    cover_image_large = ImageSpecField(
        source="cover_image",
        processors=[ResizeToFit(300, 450)],
        format="WEBP",
        options={"quality": 90},
    )
    banner_image = ImageField(
        upload_to="anime/banners/", blank=True, null=True, storage=MediaStorage()
    )
    banner_image_small = ImageSpecField(
        source="banner_image",
        processors=[ResizeToFit(400, 225)],
        format="WEBP",
        options={"quality": 80},
    )
    banner_image_medium = ImageSpecField(
        source="banner_image",
        processors=[ResizeToFit(800, 450)],
        format="WEBP",
        options={"quality": 85},
    )
    banner_image_large = ImageSpecField(
        source="banner_image",
        processors=[ResizeToFit(1200, 675)],
        format="WEBP",
        options={"quality": 90},
    )

    cover_image_external_url = URLField(blank=True, help_text="External AniList cover image URL")
    banner_image_external_url = URLField(blank=True, help_text="External AniList banner image URL")

    trailer_url = URLField(blank=True)

    rating = DecimalField(
        max_digits=3,
        decimal_places=1,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
    )

    genres = ManyToManyField("anime.Genre", related_name="anime")
    studio = ForeignKey("anime.Studio", SET_NULL, null=True, related_name="anime")

    characters = ManyToManyField(
        "anime.Character",
        through="anime.AnimeCharacter",
        related_name="animes",
        blank=True,
    )
    staff = ManyToManyField(
        "anime.Staff", through="anime.AnimeStaff", related_name="animes", blank=True
    )

    external_links = JSONField(default=list, blank=True)
    relations = JSONField(default=list, blank=True)
    status_distribution = JSONField(default=dict, blank=True)
    provider_ids = JSONField(default=dict, blank=True)
    synonyms = JSONField(default=list, blank=True)
    producers = JSONField(default=list, blank=True)
    tags = JSONField(default=list, blank=True)
    source_urls = JSONField(default=list, blank=True)
    offline_db_payload = JSONField(default=dict, blank=True)

    site_rank = IntegerField(null=True, blank=True)
    popularity_rank = IntegerField(null=True, blank=True)
    trending_rank = IntegerField(null=True, blank=True)

    meta_description = CharField(max_length=160, blank=True)

    next_airing_episode = IntegerField(null=True, blank=True)
    next_airing_date = DateTimeField(null=True, blank=True)
    last_aired_episode = IntegerField(null=True, blank=True)
    last_aired_at = DateTimeField(null=True, blank=True, db_index=True)

    source_material = CharField(
        max_length=50,
        choices=SourceMaterial.choices,
        blank=True,
        help_text="Original source material of the anime",
    )

    season = CharField(
        max_length=20,
        blank=True,
        help_text="Anime season (WINTER, SPRING, SUMMER, FALL)",
    )
    season_year = IntegerField(null=True, blank=True)

    mal_id = IntegerField(null=True, blank=True, unique=True, db_index=True)
    anilist_id = IntegerField(null=True, blank=True, unique=True, db_index=True)
    offline_db_last_seen_at = DateTimeField(null=True, blank=True, db_index=True)
    offline_db_last_update = DateField(null=True, blank=True)

    class Meta:
        ordering = ["-release_date", "-created_at"]
        indexes = [
            Index(fields=["status", "-release_date"]),
            Index(fields=["anime_type", "-rating"]),
            Index(fields=["-popularity_rank"]),
            Index(fields=["-trending_rank"]),
            Index(fields=["-site_rank"]),
            Index(fields=["studio", "-rating"]),
            Index(fields=["slug"]),
            Index(fields=["title"]),
            Index(fields=["release_date"]),
            Index(fields=["-member_count"]),
            Index(fields=["status", "anime_type", "-release_date"]),
            Index(fields=["season", "season_year", "-popularity_rank"]),
            Index(fields=["season_year", "season", "-member_count"]),
            Index(fields=["status", "-site_rank", "-rating"]),
            Index(fields=["anime_type", "status", "-rating"]),
            Index(fields=["title", "status"]),
            Index(fields=["title_jp", "status"]),
            GinIndex(fields=["title"], name="anime_title_trgm_gin", opclasses=["gin_trgm_ops"]),
            GinIndex(
                fields=["title_jp"], name="anime_title_jp_trgm_gin", opclasses=["gin_trgm_ops"]
            ),
            GinIndex(
                fields=["synopsis"], name="anime_synopsis_trgm_gin", opclasses=["gin_trgm_ops"]
            ),
        ]

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        return f"/anime/{self.slug}/"

    @classmethod
    def public_queryset(cls):
        """Anime visible on public user-facing surfaces."""
        return cls.objects.exclude(offline_sync_state__quarantined=True)


class AnimeCharacter(Model):
    class Role(TextChoices):
        MAIN = "MAIN", "Main"
        SUPPORTING = "SUPPORTING", "Supporting"
        BACKGROUND = "BACKGROUND", "Background"

    anime = ForeignKey(Anime, CASCADE, related_name="cast")
    character = ForeignKey(Character, CASCADE, related_name="roles")
    role = CharField(max_length=20, choices=Role.choices, default=Role.SUPPORTING)
    voice_actor = ForeignKey(Staff, SET_NULL, null=True, blank=True, related_name="voice_roles")

    class Meta:
        ordering = ["role", "character__name"]
        unique_together = (
            "anime",
            "character",
            "voice_actor",
        )


class AnimeStaff(Model):
    anime = ForeignKey(Anime, CASCADE, related_name="production_staff")
    staff = ForeignKey(Staff, CASCADE, related_name="production_credits")
    role = CharField(max_length=200)

    class Meta:
        ordering = ["id"]


class UserFavorite(Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="favorites")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="favorites")
    added_at = DateTimeField(auto_now_add=True)
    order = IntegerField(default=0)

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["order", "-added_at"]
        indexes = [
            Index(fields=["user", "order"]),
            Index(fields=["user", "-added_at"]),
            Index(fields=["anime"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.anime.title}"


class UserHistory(Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="history")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="history")
    viewed_at = DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["-viewed_at"]
        verbose_name_plural = "User histories"

    def __str__(self):
        return f"{self.user.username} viewed {self.anime.title}"


class Review(TimestampMixin, Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="reviews")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="reviews")
    rating = IntegerField(validators=[MinValueValidator(1), MaxValueValidator(10)])
    rating_story = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)], null=True, blank=True
    )
    rating_animation = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)], null=True, blank=True
    )
    rating_music = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)], null=True, blank=True
    )
    rating_characters = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)], null=True, blank=True
    )
    text = TextField(blank=True)
    has_spoilers = BooleanField(default=False)

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["anime", "-created_at"]),
            Index(fields=["user", "-created_at"]),
            Index(fields=["anime", "user"]),
            Index(fields=["rating", "-created_at"]),
            Index(fields=["has_spoilers", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username}'s review of {self.anime.title}"


class ReviewVote(CreatedAtMixin, Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="review_votes")
    review = ForeignKey(Review, CASCADE, related_name="votes")
    is_helpful = BooleanField(default=True)

    class Meta:
        unique_together = ("user", "review")
        indexes = [
            Index(fields=["review", "is_helpful"]),
            Index(fields=["user", "review"]),
        ]

    def __str__(self):
        vote_type = "helpful" if self.is_helpful else "not helpful"
        return f"{self.user.username} voted {vote_type} on review {self.review.id}"


class ReviewComment(TimestampMixin, Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="review_comments")
    review = ForeignKey(Review, CASCADE, related_name="comments")
    text = TextField(max_length=2000)
    is_deleted = BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["review", "-created_at"]),
            Index(fields=["user", "-created_at"]),
            Index(fields=["review", "is_deleted"]),
        ]

    def __str__(self):
        return f"{self.user.username}'s comment on review {self.review.id}"

    def soft_delete(self):
        self.is_deleted = True
        self.save(update_fields=["is_deleted", "updated_at"])


class ReviewReport(TimestampMixin, Model):
    class Reason(TextChoices):
        SPOILER = "spoiler", "Spoiler"
        SPAM = "spam", "Spam"
        HARASSMENT = "harassment", "Harassment"
        HATE_SPEECH = "hate_speech", "Hate Speech"
        MISINFORMATION = "misinformation", "Misinformation"
        OFF_TOPIC = "off_topic", "Off Topic"
        OTHER = "other", "Other"

    class Status(TextChoices):
        OPEN = "open", "Open"
        IN_REVIEW = "in_review", "In Review"
        RESOLVED = "resolved", "Resolved"
        DISMISSED = "dismissed", "Dismissed"

    review = ForeignKey("anime.Review", CASCADE, related_name="reports")
    reporter = ForeignKey("users.CustomUser", CASCADE, related_name="review_reports")
    reason = CharField(max_length=30, choices=Reason.choices, default=Reason.OTHER)
    description = TextField(blank=True)

    status = CharField(max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True)
    resolved_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        blank=True,
        related_name="resolved_review_reports",
    )
    resolved_at = DateTimeField(null=True, blank=True)
    resolution_notes = TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("review", "reporter")
        indexes = [
            Index(fields=["status", "-created_at"]),
            Index(fields=["review", "status"]),
            Index(fields=["reporter", "-created_at"]),
        ]

    def __str__(self):
        return f"Report by {self.reporter.username} on review {self.review_id}"


class UserRecommendation(TimestampMixin, Model):
    class RecommendationReason(TextChoices):
        GENRE_MATCH = "genre_match", "Genre Match"
        STUDIO_MATCH = "studio_match", "Studio Match"
        TYPE_MATCH = "type_match", "Type Match"
        SIMILAR_USERS = "similar_users", "Similar Users"
        TRENDING = "trending", "Trending"
        TOP_RATED = "top_rated", "Top Rated"
        BECAUSE_YOU_LIKED = "because_you_liked", "Because You Liked"

    user = ForeignKey("users.CustomUser", CASCADE, related_name="recommendations")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="user_recommendations")
    score = DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        help_text="Hybrid recommendation score (0-100)",
    )
    reason = CharField(
        max_length=50,
        choices=RecommendationReason.choices,
        default=RecommendationReason.GENRE_MATCH,
    )
    reason_metadata = JSONField(
        default=dict,
        blank=True,
        help_text="Additional context for the recommendation (e.g., {'matched_genres': ['Action'], 'source_anime': 'Attack on Titan'})",
    )
    is_dismissed = BooleanField(default=False)

    class Meta:
        ordering = ["-score", "-created_at"]
        indexes = [
            Index(fields=["user", "-score"]),
            Index(fields=["user", "is_dismissed"]),
            Index(fields=["anime"]),
            Index(fields=["created_at"]),
        ]
        unique_together = ("user", "anime")

    def __str__(self):
        return f"{self.user.username} - {self.anime.title} ({self.score})"

    def get_reason_display_text(self):
        if self.reason == self.RecommendationReason.GENRE_MATCH:
            genres = self.reason_metadata.get("matched_genres", [])
            if genres:
                return f"Because you like {', '.join(genres[:3])} anime"
            return "Matched your genre preferences"
        elif self.reason == self.RecommendationReason.STUDIO_MATCH:
            studio = self.reason_metadata.get("studio", "this studio")
            return f"From {studio}, which you seem to enjoy"
        elif self.reason == self.RecommendationReason.BECAUSE_YOU_LIKED:
            source = self.reason_metadata.get("source_anime", "a similar anime")
            return f"Because you liked {source}"
        elif self.reason == self.RecommendationReason.SIMILAR_USERS:
            return "Users with similar taste enjoyed this"
        elif self.reason == self.RecommendationReason.TRENDING:
            return "Trending now"
        elif self.reason == self.RecommendationReason.TOP_RATED:
            return "Highly rated by the community"
        return "Recommended for you"


class ThemeSong(TimestampMixin, Model):
    class SongType(TextChoices):
        OPENING = "opening", "Opening"
        ENDING = "ending", "Ending"

    anime = ForeignKey(Anime, CASCADE, related_name="theme_songs")
    song_type = CharField(max_length=10, choices=SongType.choices)
    track_number = IntegerField(default=1)
    title = CharField(max_length=300)
    artist = CharField(max_length=300, blank=True)
    episodes = CharField(max_length=100, blank=True)
    anilist_raw = CharField(max_length=500, blank=True)

    mal_id = IntegerField(null=True, blank=True)
    composer = CharField(max_length=300, blank=True)
    arranger = CharField(max_length=300, blank=True)
    year = IntegerField(null=True, blank=True)

    spotify_url = URLField(max_length=500, blank=True)
    youtube_url = URLField(max_length=500, blank=True)
    apple_music_url = URLField(max_length=500, blank=True)
    anisong_db_url = URLField(max_length=500, blank=True)

    last_synced = DateTimeField(null=True, blank=True)
    sync_source = CharField(max_length=20, blank=True, default="")

    class Meta:
        ordering = ["song_type", "track_number"]
        indexes = [
            Index(fields=["anime", "song_type"]),
            Index(fields=["anime", "track_number"]),
        ]
        unique_together = ("anime", "song_type", "track_number")

    def __str__(self):
        return f"{self.anime.title} - {self.song_type.upper()} {self.track_number}: {self.title}"


class OfflineCatalogImport(TimestampMixin, Model):
    class Status(TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    source_name = CharField(max_length=100, default="anime-offline-database")
    release_tag = CharField(max_length=50, blank=True)
    asset_name = CharField(max_length=100, default="anime-offline-database.jsonl.zst")
    source_url = URLField(max_length=500, blank=True)
    status = CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    started_at = DateTimeField(null=True, blank=True)
    completed_at = DateTimeField(null=True, blank=True)
    last_processed_line = IntegerField(default=0)
    records_seen = IntegerField(default=0)
    records_created = IntegerField(default=0)
    records_updated = IntegerField(default=0)
    records_marked_stale = IntegerField(default=0)
    records_failed = IntegerField(default=0)
    summary = JSONField(default=dict, blank=True)
    error_message = TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["source_name", "-created_at"]),
            Index(fields=["status", "-created_at"]),
        ]

    def __str__(self):
        release = self.release_tag or "latest"
        return f"{self.source_name} import {release} ({self.status})"


class OfflineAnimeSyncState(TimestampMixin, Model):
    class StageStatus(TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In Progress"
        SYNCED = "synced", "Synced"
        TRANSIENT_ERROR = "transient_error", "Transient Error"
        BLOCKED_IDENTITY = "blocked_identity", "Blocked: Identity Conflict"
        BLOCKED_NO_IDS = "blocked_no_ids", "Blocked: Missing IDs"
        QUARANTINED = "quarantined", "Quarantined"

    anime = OneToOneField("anime.Anime", CASCADE, related_name="offline_sync_state")
    metadata_status = CharField(
        max_length=30,
        choices=StageStatus.choices,
        default=StageStatus.PENDING,
        db_index=True,
    )
    franchise_status = CharField(
        max_length=30,
        choices=StageStatus.choices,
        default=StageStatus.PENDING,
        db_index=True,
    )
    themes_status = CharField(
        max_length=30,
        choices=StageStatus.choices,
        default=StageStatus.PENDING,
        db_index=True,
    )

    metadata_attempt_count = IntegerField(default=0)
    franchise_attempt_count = IntegerField(default=0)
    themes_attempt_count = IntegerField(default=0)
    attempt_count = IntegerField(default=0)

    last_attempt_at = DateTimeField(null=True, blank=True, db_index=True)
    next_attempt_at = DateTimeField(default=timezone.now, db_index=True)
    last_error_code = CharField(max_length=64, blank=True)
    last_error_message = TextField(blank=True)

    quarantined = BooleanField(default=False, db_index=True)
    quarantine_reason = CharField(max_length=120, blank=True)
    quarantine_context = JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["next_attempt_at", "id"]
        indexes = [
            Index(fields=["quarantined", "next_attempt_at"], name="anime_sync_q_due_idx"),
            Index(fields=["metadata_status", "next_attempt_at"], name="anime_sync_meta_due_idx"),
            Index(fields=["franchise_status", "next_attempt_at"], name="anime_sync_fr_due_idx"),
            Index(fields=["themes_status", "next_attempt_at"], name="anime_sync_th_due_idx"),
        ]

    def __str__(self):
        return f"Offline sync state for anime #{self.anime_id}"
