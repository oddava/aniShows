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
    PositiveSmallIntegerField,
    Prefetch,
    TextField,
    TimeField,
    UniqueConstraint,
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

    # Titles are not unique (remakes, films sharing a name); slug and the provider IDs are.
    title = CharField(max_length=200)
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
    studios = ManyToManyField(
        "anime.Studio", through="anime.AnimeStudio", related_name="anime", blank=True
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
    broadcast_day = CharField(max_length=16, blank=True, db_index=True)
    broadcast_time = TimeField(null=True, blank=True)
    broadcast_timezone = CharField(max_length=64, blank=True)
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

    # Real provider IDs only. Jikan-only rows have anilist_id=NULL and are deduped by mal_id.
    mal_id = IntegerField(null=True, blank=True, unique=True)
    anilist_id = IntegerField(null=True, blank=True, unique=True)
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
            Index(fields=["release_date"]),
            Index(fields=["-member_count"]),
            Index(fields=["status", "anime_type", "-release_date"]),
            Index(fields=["season", "season_year", "-popularity_rank"]),
            Index(fields=["season_year", "season", "-member_count"]),
            Index(fields=["status", "-site_rank", "-rating"]),
            Index(fields=["anime_type", "status", "-rating"]),
            Index(fields=["source_material"], name="anime_source_material_idx"),
            Index(fields=["episode_count"], name="anime_episode_count_idx"),
            Index(fields=["duration_minutes"], name="anime_duration_minutes_idx"),
            Index(fields=["season_year", "-popularity_rank"], name="anime_season_year_pop_idx"),
            Index(fields=["title", "status"]),
            Index(fields=["title_jp", "status"]),
            Index(fields=["status", "broadcast_day", "next_airing_date"], name="anime_schedule_day_idx"),
            GinIndex(fields=["title"], name="anime_title_trgm_gin", opclasses=["gin_trgm_ops"]),
            GinIndex(
                fields=["title_jp"], name="anime_title_jp_trgm_gin", opclasses=["gin_trgm_ops"]
            ),
            GinIndex(
                fields=["synopsis"], name="anime_synopsis_trgm_gin", opclasses=["gin_trgm_ops"]
            ),
            GinIndex(fields=["tags"], name="anime_tags_gin"),
        ]

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        return f"/anime/{self.slug}/"

    @staticmethod
    def studios_prefetch(prefix: str = "") -> Prefetch:
        """Prefetch for ``ordered_studios``/``primary_studio`` without per-row queries.

        ``prefix`` is the lookup path to the anime, e.g. ``"anime__"`` from a review.
        """
        return Prefetch(
            f"{prefix}studio_links", queryset=AnimeStudio.objects.select_related("studio")
        )

    @property
    def ordered_studios(self) -> list:
        """Studios in provider order; uses a prefetched ``studio_links`` when present."""
        return [link.studio for link in self.studio_links.all()]

    @property
    def primary_studio(self):
        studios = self.ordered_studios
        return studios[0] if studios else None

    def set_studios(self, studios) -> None:
        """Replace the studio list, keeping the given order (first = primary)."""
        unique = list(dict.fromkeys(studio for studio in studios if studio is not None))
        current = [link.studio_id for link in self.studio_links.order_by("position", "id")]
        if current == [studio.pk for studio in unique]:
            return
        self.studio_links.all().delete()
        AnimeStudio.objects.bulk_create(
            AnimeStudio(anime=self, studio=studio, position=index)
            for index, studio in enumerate(unique)
        )
        if hasattr(self, "_prefetched_objects_cache"):
            self._prefetched_objects_cache.pop("studio_links", None)
            self._prefetched_objects_cache.pop("studios", None)

    @classmethod
    def available_slug(cls, base_slug: str, *, year: int | None = None) -> str:
        """First free slug among base, base-YEAR, base-2 ... base-101."""
        base_slug = base_slug[:190] or "anime"
        candidates = [base_slug]
        if year:
            candidates.append(f"{base_slug}-{year}")
        candidates.extend(f"{base_slug}-{counter}" for counter in range(2, 102))
        taken = set(cls.objects.filter(slug__in=candidates).values_list("slug", flat=True))
        for candidate in candidates:
            if candidate not in taken:
                return candidate
        raise ValueError(f"Could not generate a unique slug from '{base_slug}'")

    @classmethod
    def public_queryset(cls):
        """Anime visible on public user-facing surfaces."""
        return cls.objects.exclude(offline_sync_state__quarantined=True)


class AnimeStudio(Model):
    anime = ForeignKey("anime.Anime", CASCADE, related_name="studio_links")
    studio = ForeignKey("anime.Studio", CASCADE, related_name="anime_links")
    position = PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            UniqueConstraint(fields=["anime", "studio"], name="anime_studio_unique"),
        ]


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
