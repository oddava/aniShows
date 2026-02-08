from django.contrib.auth.models import User
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db.models import (
    Model,
    TextField,
    CharField,
    URLField,
    IntegerField,
    DateField,
    DecimalField,
    DateTimeField,
    BooleanField,
    ManyToManyField,
    SET_NULL,
    ForeignKey,
    ImageField,
    SlugField,
    CASCADE,
    JSONField,
)
from django.db.models.enums import TextChoices
from django.db.models.indexes import Index
from django.utils import timezone

from root import settings
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
    name = CharField(max_length=200)
    name_native = CharField(max_length=200, blank=True)
    image = ImageField(
        upload_to="characters/", blank=True, null=True, storage=MediaStorage()
    )
    image_url = URLField(blank=True, null=True)
    description = TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Staff(Model):
    name = CharField(max_length=200)
    name_native = CharField(max_length=200, blank=True)
    image = ImageField(
        upload_to="staff/", blank=True, null=True, storage=MediaStorage()
    )
    image_url = URLField(blank=True, null=True)
    description = TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Anime(Model):
    class AnimeType(TextChoices):
        tv = "TV"
        movie = "Movie"
        ova = "OVA"
        special = "Special"

    class AnimeStatus(TextChoices):
        airing = "Airing"
        finished = "Finished"
        upcoming = "Upcoming"

    title = CharField(max_length=200, unique=True)
    title_jp = CharField(max_length=200, blank=True)
    slug = SlugField(max_length=200, unique=True)

    synopsis = TextField()
    anime_type = CharField(
        max_length=20, choices=AnimeType.choices, default=AnimeType.tv
    )
    status = CharField(
        max_length=20, choices=AnimeStatus.choices, default=AnimeStatus.airing
    )
    episode_count = IntegerField(default=0)
    duration_minutes = IntegerField(default=24)
    member_count = IntegerField(default=0)  # AniList popularity/planning count

    release_date = DateField(null=True, blank=True)
    end_date = DateField(null=True, blank=True)

    cover_image = ImageField(
        upload_to="anime/covers/", blank=True, null=True, storage=MediaStorage()
    )
    banner_image = ImageField(
        upload_to="anime/banners/", blank=True, null=True, storage=MediaStorage()
    )
    trailer_url = URLField(blank=True)

    rating = DecimalField(
        max_digits=3,
        decimal_places=1,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
    )

    # Relationships
    genres = ManyToManyField("anime.Genre", related_name="anime")
    studio = ForeignKey(
        "anime.Studio", on_delete=SET_NULL, null=True, related_name="anime"
    )

    characters = ManyToManyField(
        "anime.Character",
        through="anime.AnimeCharacter",
        related_name="animes",
        blank=True,
    )
    staff = ManyToManyField(
        "anime.Staff", through="anime.AnimeStaff", related_name="animes", blank=True
    )

    # Extended Info
    external_links = JSONField(
        default=list, blank=True
    )  # List of {site: str, url: str, icon: str}
    relations = JSONField(
        default=list, blank=True
    )  # List of related media {id: int, type: str, title: str}
    status_distribution = JSONField(
        default=dict, blank=True
    )  # { "CURRENT": 100, "PLANNING": 200... }

    # Ranks
    site_rank = IntegerField(null=True, blank=True)  # e.g #115 highest rated
    popularity_rank = IntegerField(null=True, blank=True)  # e.g #50 most popular
    trending_rank = IntegerField(
        null=True, blank=True
    )  # Current trending rank (1 = most trending)

    # Timestamps
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    # SEO
    meta_description = CharField(max_length=160, blank=True)

    # Airing Schedule
    next_airing_episode = IntegerField(null=True, blank=True)
    next_airing_date = DateTimeField(null=True, blank=True)

    # External IDs for import/export
    mal_id = IntegerField(null=True, blank=True, unique=True, db_index=True)
    anilist_id = IntegerField(null=True, blank=True, unique=True, db_index=True)

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
        ]

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        return f"/anime/{self.slug}/"


class AnimeCharacter(Model):
    class Role(TextChoices):
        MAIN = "MAIN", "Main"
        SUPPORTING = "SUPPORTING", "Supporting"
        BACKGROUND = "BACKGROUND", "Background"

    anime = ForeignKey(Anime, on_delete=CASCADE, related_name="cast")
    character = ForeignKey(Character, on_delete=CASCADE, related_name="roles")
    role = CharField(max_length=20, choices=Role.choices, default=Role.SUPPORTING)
    voice_actor = ForeignKey(
        Staff, on_delete=SET_NULL, null=True, blank=True, related_name="voice_roles"
    )

    class Meta:
        ordering = ["role", "character__name"]
        unique_together = (
            "anime",
            "character",
            "voice_actor",
        )  # Allowing same character multiple times if different VAs (rare but possible across langs if we tracked that, otherwise safe)


class AnimeStaff(Model):
    anime = ForeignKey(Anime, on_delete=CASCADE, related_name="production_staff")
    staff = ForeignKey(Staff, on_delete=CASCADE, related_name="production_credits")
    role = CharField(max_length=200)  # e.g. "Director", "Original Creator"

    class Meta:
        ordering = ["id"]


class UserFavorite(Model):
    user = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="favorites"
    )
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name="favorites")
    added_at = DateTimeField(auto_now_add=True)
    order = IntegerField(default=0)  # User-defined order for display

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["order", "-added_at"]
        indexes = [
            Index(fields=["user", "order"]),  # Composite index for ordering favorites
            Index(fields=["user", "-added_at"]),  # For recent favorites queries
            Index(fields=["anime"]),  # For counting favorites per anime
        ]

    def __str__(self):
        return f"{self.user.username} - {self.anime.title}"


class UserHistory(Model):
    user = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="history"
    )
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name="history")
    viewed_at = DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["-viewed_at"]
        verbose_name_plural = "User histories"

    def __str__(self):
        return f"{self.user.username} viewed {self.anime.title}"


class Review(Model):
    user = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="reviews"
    )
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name="reviews")
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
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["anime", "-created_at"]),
            Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username}'s review of {self.anime.title}"


class ReviewVote(Model):
    """Track helpful votes on reviews"""

    user = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="review_votes"
    )
    review = ForeignKey(Review, on_delete=CASCADE, related_name="votes")
    is_helpful = BooleanField(default=True)  # True = helpful, False = not helpful
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "review")
        indexes = [
            Index(fields=["review", "is_helpful"]),  # For counting helpful votes
            Index(fields=["user", "review"]),  # For quick vote lookup
        ]

    def __str__(self):
        vote_type = "helpful" if self.is_helpful else "not helpful"
        return f"{self.user.username} voted {vote_type} on review {self.review.id}"


class UserRecommendation(Model):
    """Precomputed anime recommendations for users"""

    class RecommendationReason(TextChoices):
        GENRE_MATCH = "genre_match", "Genre Match"
        STUDIO_MATCH = "studio_match", "Studio Match"
        TYPE_MATCH = "type_match", "Type Match"
        SIMILAR_USERS = "similar_users", "Similar Users"
        TRENDING = "trending", "Trending"
        TOP_RATED = "top_rated", "Top Rated"
        BECAUSE_YOU_LIKED = "because_you_liked", "Because You Liked"

    user = ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="recommendations"
    )
    anime = ForeignKey(
        "anime.Anime", on_delete=CASCADE, related_name="user_recommendations"
    )
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
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

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
        """Get human-readable explanation for the recommendation"""
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
