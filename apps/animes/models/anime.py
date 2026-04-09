from django.contrib.postgres.indexes import GinIndex
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db.models import (
    CASCADE,
    SET_NULL,
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
    TextField,
    URLField,
)
from django.db.models.enums import TextChoices
from django.db.models.indexes import Index
from imagekit.models import ImageSpecField
from imagekit.processors import ResizeToFit

from root.storage_backends import MediaStorage

from ...shared.models import SlugMixin, TimestampMixin


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

    anime = ForeignKey("anime.Anime", CASCADE, related_name="cast")
    character = ForeignKey("anime.Character", CASCADE, related_name="roles")
    role = CharField(max_length=20, choices=Role.choices, default=Role.SUPPORTING)
    voice_actor = ForeignKey("anime.Staff", SET_NULL, null=True, blank=True, related_name="voice_roles")

    class Meta:
        ordering = ["role", "character__name"]
        unique_together = (
            "anime",
            "character",
            "voice_actor",
        )


class AnimeStaff(Model):
    anime = ForeignKey("anime.Anime", CASCADE, related_name="production_staff")
    staff = ForeignKey("anime.Staff", CASCADE, related_name="production_credits")
    role = CharField(max_length=200)

    class Meta:
        ordering = ["id"]


class ThemeSong(TimestampMixin, Model):
    class SongType(TextChoices):
        OPENING = "opening", "Opening"
        ENDING = "ending", "Ending"

    anime = ForeignKey("anime.Anime", CASCADE, related_name="theme_songs")
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
