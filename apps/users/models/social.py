"""Social models (G5 Community): follows."""

from django.db.models import (
    CASCADE,
    ForeignKey,
    Index,
    Model,
)

from ...shared.models import CreatedAtMixin

__all__ = [
    "UserFollow",
]


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
