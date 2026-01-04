from django.contrib.auth.models import User
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db.models import Model, TextField, CharField, URLField, IntegerField, DateField, DecimalField, \
    DateTimeField, BooleanField, \
    ManyToManyField, SET_NULL, ForeignKey, ImageField, SlugField, CASCADE, JSONField
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
        ordering = ['name']

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
    image = ImageField(upload_to='characters/', blank=True, null=True, storage=MediaStorage())
    image_url = URLField(blank=True, null=True)
    description = TextField(blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Staff(Model):
    name = CharField(max_length=200)
    name_native = CharField(max_length=200, blank=True)
    image = ImageField(upload_to='staff/', blank=True, null=True, storage=MediaStorage())
    image_url = URLField(blank=True, null=True)
    description = TextField(blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


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


    title = CharField(max_length=200, unique=True)
    title_jp = CharField(max_length=200, blank=True)
    slug = SlugField(max_length=200, unique=True)

    synopsis = TextField()
    anime_type = CharField(max_length=20, choices=AnimeType.choices, default=AnimeType.tv)
    status = CharField(max_length=20, choices=AnimeStatus.choices, default=AnimeStatus.airing)
    episode_count = IntegerField(default=0)
    duration_minutes = IntegerField(default=24)

    release_date = DateField(null=True, blank=True)
    end_date = DateField(null=True, blank=True)

    cover_image = ImageField(upload_to='anime/covers/', blank=True, null=True, storage=MediaStorage())
    banner_image = ImageField(upload_to='anime/banners/', blank=True, null=True, storage=MediaStorage())
    trailer_url = URLField(blank=True)

    rating = DecimalField(
        max_digits=3,
        decimal_places=1,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)]
    )

    # Relationships
    genres = ManyToManyField("anime.Genre", related_name='anime')
    studio = ForeignKey("anime.Studio", on_delete=SET_NULL, null=True, related_name='anime')
    
    characters = ManyToManyField(
        "anime.Character", 
        through="anime.AnimeCharacter",
        related_name="animes",
        blank=True
    )
    staff = ManyToManyField(
        "anime.Staff",
        through="anime.AnimeStaff",
        related_name="animes",
        blank=True
    )

    # Extended Info
    external_links = JSONField(default=list, blank=True)  # List of {site: str, url: str, icon: str}
    relations = JSONField(default=list, blank=True)       # List of related media {id: int, type: str, title: str}
    
    # Ranks
    site_rank = IntegerField(null=True, blank=True)       # e.g #115 highest rated
    popularity_rank = IntegerField(null=True, blank=True) # e.g #50 most popular

    # Timestamps
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    # SEO
    meta_description = CharField(max_length=160, blank=True)

    class Meta:
        ordering = ['-release_date', '-created_at']
        indexes = [
            Index(fields=['status', '-release_date']),
            Index(fields=['anime_type', '-rating']),
        ]

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        return f'/anime/{self.slug}/'


class AnimeCharacter(Model):
    class Role(TextChoices):
        MAIN = 'MAIN', 'Main'
        SUPPORTING = 'SUPPORTING', 'Supporting'
        BACKGROUND = 'BACKGROUND', 'Background'
    
    anime = ForeignKey(Anime, on_delete=CASCADE, related_name='cast')
    character = ForeignKey(Character, on_delete=CASCADE, related_name='roles')
    role = CharField(max_length=20, choices=Role.choices, default=Role.SUPPORTING)
    voice_actor = ForeignKey(Staff, on_delete=SET_NULL, null=True, blank=True, related_name='voice_roles')
    
    class Meta:
        ordering = ['role', 'character__name']
        unique_together = ('anime', 'character', 'voice_actor') # Allowing same character multiple times if different VAs (rare but possible across langs if we tracked that, otherwise safe)

class AnimeStaff(Model):
    anime = ForeignKey(Anime, on_delete=CASCADE, related_name='production_staff')
    staff = ForeignKey(Staff, on_delete=CASCADE, related_name='production_credits')
    role = CharField(max_length=200) # e.g. "Director", "Original Creator"

    class Meta:
        ordering = ['id']


class UserFavorite(Model):
    user = ForeignKey(settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name='favorites')
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name='favorites')
    added_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'anime')
        ordering = ['-added_at']

    def __str__(self):
        return f"{self.user.username} - {self.anime.title}"


class UserHistory(Model):
    user = ForeignKey(settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name='history')
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name='history')
    viewed_at = DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ('user', 'anime')
        ordering = ['-viewed_at']
        verbose_name_plural = 'User histories'

    def __str__(self):
        return f"{self.user.username} viewed {self.anime.title}"


class Review(Model):
    user = ForeignKey(settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name='reviews')
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name='reviews')
    rating = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)]
    )
    rating_story = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        null=True, blank=True
    )
    rating_animation = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        null=True, blank=True
    )
    rating_music = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        null=True, blank=True
    )
    rating_characters = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        null=True, blank=True
    )
    text = TextField(blank=True)
    has_spoilers = BooleanField(default=False)
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'anime')
        ordering = ['-created_at']
        indexes = [
            Index(fields=['anime', '-created_at']),
            Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return f"{self.user.username}'s review of {self.anime.title}"