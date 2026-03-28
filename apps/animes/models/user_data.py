from django.core.validators import MaxValueValidator, MinValueValidator
from django.db.models import (
    CASCADE,
    BooleanField,
    CharField,
    DateTimeField,
    DecimalField,
    ForeignKey,
    Index,
    IntegerField,
    JSONField,
    Model,
)
from django.db.models.enums import TextChoices
from django.utils import timezone

from apps.shared.models import TimestampMixin


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
        if self.reason == self.RecommendationReason.STUDIO_MATCH:
            studio = self.reason_metadata.get("studio", "this studio")
            return f"From {studio}, which you seem to enjoy"
        if self.reason == self.RecommendationReason.BECAUSE_YOU_LIKED:
            source = self.reason_metadata.get("source_anime", "a similar anime")
            return f"Because you liked {source}"
        if self.reason == self.RecommendationReason.SIMILAR_USERS:
            return "Users with similar taste enjoyed this"
        if self.reason == self.RecommendationReason.TRENDING:
            return "Trending now"
        if self.reason == self.RecommendationReason.TOP_RATED:
            return "Highly rated by the community"
        return "Recommended for you"
