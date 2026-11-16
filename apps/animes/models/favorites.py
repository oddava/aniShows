"""Favorite models (G5 Community): anime, character and staff favorites."""

from django.db.models import (
    CASCADE,
    DateTimeField,
    ForeignKey,
    Index,
    IntegerField,
    Model,
)

__all__ = [
    "UserFavorite",
    "UserFavoriteCharacter",
    "UserFavoriteStaff",
]


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


class UserFavoriteCharacter(Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="favorite_characters")
    character = ForeignKey("anime.Character", CASCADE, related_name="favorites")
    added_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "character")
        ordering = ["-added_at"]
        indexes = [
            Index(fields=["user", "-added_at"]),
            Index(fields=["character"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.character.name}"


class UserFavoriteStaff(Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="favorite_staff")
    staff = ForeignKey("anime.Staff", CASCADE, related_name="favorites")
    added_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "staff")
        ordering = ["-added_at"]
        indexes = [
            Index(fields=["user", "-added_at"]),
            Index(fields=["staff"]),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.staff.name}"
