from django.core.validators import MaxValueValidator, MinValueValidator
from django.db.models import (
    CASCADE,
    SET_NULL,
    BooleanField,
    CharField,
    DateTimeField,
    ForeignKey,
    Index,
    IntegerField,
    Model,
    TextField,
)
from django.db.models.enums import TextChoices

from apps.shared.models import CreatedAtMixin, TimestampMixin


class Review(TimestampMixin, Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="reviews")
    anime = ForeignKey("anime.Anime", CASCADE, related_name="reviews")
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

    class Meta:
        unique_together = ("user", "anime")
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["anime", "-created_at"]),
            Index(fields=["user", "-created_at"]),
            Index(fields=["anime", "user"]),
            Index(fields=["rating", "-created_at"]),
            Index(fields=["has_spoilers", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username}'s review of {self.anime.title}"


class ReviewVote(CreatedAtMixin, Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="review_votes")
    review = ForeignKey("anime.Review", CASCADE, related_name="votes")
    is_helpful = BooleanField(default=True)

    class Meta:
        unique_together = ("user", "review")
        indexes = [
            Index(fields=["review", "is_helpful"]),
            Index(fields=["user", "review"]),
        ]

    def __str__(self):
        vote_type = "helpful" if self.is_helpful else "not helpful"
        return f"{self.user.username} voted {vote_type} on review {self.review.id}"


class ReviewComment(TimestampMixin, Model):
    user = ForeignKey("users.CustomUser", CASCADE, related_name="review_comments")
    review = ForeignKey("anime.Review", CASCADE, related_name="comments")
    text = TextField(max_length=2000)
    is_deleted = BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["review", "-created_at"]),
            Index(fields=["user", "-created_at"]),
            Index(fields=["review", "is_deleted"]),
        ]

    def __str__(self):
        return f"{self.user.username}'s comment on review {self.review.id}"

    def soft_delete(self):
        self.is_deleted = True
        self.save(update_fields=["is_deleted", "updated_at"])


class ReviewReport(TimestampMixin, Model):
    class Reason(TextChoices):
        SPOILER = "spoiler", "Spoiler"
        SPAM = "spam", "Spam"
        HARASSMENT = "harassment", "Harassment"
        HATE_SPEECH = "hate_speech", "Hate Speech"
        MISINFORMATION = "misinformation", "Misinformation"
        OFF_TOPIC = "off_topic", "Off Topic"
        OTHER = "other", "Other"

    class Status(TextChoices):
        OPEN = "open", "Open"
        IN_REVIEW = "in_review", "In Review"
        RESOLVED = "resolved", "Resolved"
        DISMISSED = "dismissed", "Dismissed"

    review = ForeignKey("anime.Review", CASCADE, related_name="reports")
    reporter = ForeignKey("users.CustomUser", CASCADE, related_name="review_reports")
    reason = CharField(max_length=30, choices=Reason.choices, default=Reason.OTHER)
    description = TextField(blank=True)

    status = CharField(max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True)
    resolved_by = ForeignKey(
        "users.CustomUser",
        SET_NULL,
        null=True,
        blank=True,
        related_name="resolved_review_reports",
    )
    resolved_at = DateTimeField(null=True, blank=True)
    resolution_notes = TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("review", "reporter")
        indexes = [
            Index(fields=["status", "-created_at"]),
            Index(fields=["review", "status"]),
            Index(fields=["reporter", "-created_at"]),
        ]

    def __str__(self):
        return f"Report by {self.reporter.username} on review {self.review_id}"
