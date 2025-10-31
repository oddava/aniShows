from django.contrib.auth.models import User
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db.models import Model, TextField, CharField, URLField, IntegerField, DateField, DecimalField, \
    DateTimeField, \
    ManyToManyField, SET_NULL, ForeignKey, ImageField, SlugField, CASCADE
from django.db.models.enums import TextChoices
from django.db.models.indexes import Index
from django.utils import timezone


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


class AnimeType(TextChoices):
    tv = 'TV'
    movie = 'Movie'
    ova = 'OVA'
    special = 'Special'


class AnimeStatus(TextChoices):
    airing = 'Airing'
    finished = 'Finished'
    upcoming = 'Upcoming'


class Anime(Model):
    title = CharField(max_length=200, db_index=True)
    title_english = CharField(max_length=200, blank=True)
    title_japanese = CharField(max_length=200, blank=True)
    slug = SlugField(max_length=200, unique=True)

    synopsis = TextField()
    anime_type = CharField(max_length=20, choices=AnimeType.choices, default=AnimeType.tv)
    status = CharField(max_length=20, choices=AnimeStatus.choices, default=AnimeStatus.airing)
    episode_count = IntegerField(default=0)
    duration_minutes = IntegerField(default=24)

    release_date = DateField(null=True, blank=True)
    end_date = DateField(null=True, blank=True)

    cover_image = ImageField(upload_to='anime/covers/', blank=True)
    banner_image = ImageField(upload_to='anime/banners/', blank=True)
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


class UserFavorite(Model):
    user = ForeignKey(User, on_delete=CASCADE, related_name='favorites')
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name='favorites')
    added_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'anime')
        ordering = ['-added_at']

    def __str__(self):
        return f"{self.user.username} - {self.anime.title}"


class UserHistory(Model):
    user = ForeignKey(User, on_delete=CASCADE, related_name='history')
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name='history')
    viewed_at = DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ('user', 'anime')
        ordering = ['-viewed_at']
        verbose_name_plural = 'User histories'

    def __str__(self):
        return f"{self.user.username} viewed {self.anime.title}"


class Review(Model):
    user = ForeignKey(User, on_delete=CASCADE, related_name='reviews')
    anime = ForeignKey("anime.Anime", on_delete=CASCADE, related_name='reviews')
    rating = IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)]
    )
    text = TextField()
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'anime')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username}'s review of {self.anime.title}"
