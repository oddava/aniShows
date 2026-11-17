"""Per-user tracking models (G3 Lists): episode ratings and view history."""

from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db.models import (
    CASCADE,
    DateTimeField,
    DecimalField,
    ForeignKey,
    Index,
    IntegerField,
    Model,
)
from django.utils import timezone

from ...shared.models import TimestampMixin

__all__ = [
    "EpisodeRating",
    "UserHistory",
]


class UserHistory(Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="history")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="history")
    viewed_at = DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["-viewed_at"]
        indexes = [
            Index(fields=["-viewed_at"]),
        ]
        verbose_name_plural = "User histories"

    def __str__(self):
        return f"{self.user.username} viewed {self.anime.title}"


class EpisodeRating(TimestampMixin, Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="episode_ratings")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="episode_ratings")
    episode_number = IntegerField(validators=[MinValueValidator(1)])
    rating = DecimalField(
        max_digits=2,
        decimal_places=1,
        validators=[MinValueValidator(Decimal("0.5")), MaxValueValidator(Decimal("5.0"))],
    )

    class Meta:
        ordering = ["anime_id", "episode_number", "-updated_at"]
        unique_together = ("user", "anime", "episode_number")
        indexes = [
            Index(fields=["anime", "episode_number"]),
            Index(fields=["user", "anime"]),
            Index(fields=["anime", "user", "episode_number"]),
        ]

    def __str__(self):
        return (
            f"{self.user.username} rated {self.anime.title} episode "
            f"{self.episode_number} {self.rating}/5"
        )
