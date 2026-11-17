"""Social models (G5 Community): follows."""

from django.db.models import (
    CASCADE,
    CheckConstraint,
    F,
    ForeignKey,
    Index,
    Model,
    Q,
)

from ...shared.models import CreatedAtMixin

__all__ = [
    "UserFollow",
]


class UserFollow(CreatedAtMixin, Model):
    follower = ForeignKey("users.CustomUser", CASCADE, related_name="following")
    following = ForeignKey("users.CustomUser", CASCADE, related_name="followers")

    class Meta:
        # The unique pair also serves (follower, following) lookups.
        unique_together = ("follower", "following")
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["follower", "-created_at"]),
            Index(fields=["following", "-created_at"]),
            Index(fields=["following", "follower"]),
        ]
        constraints = [
            CheckConstraint(condition=~Q(follower=F("following")), name="users_userfollow_no_self"),
        ]

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"
