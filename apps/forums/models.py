from django.db.models import (
    CASCADE,
    SET_NULL,
    BooleanField,
    CharField,
    DateTimeField,
    F,
    ForeignKey,
    Index,
    IntegerField,
    ManyToManyField,
    Model,
    PositiveIntegerField,
    PositiveSmallIntegerField,
    SlugField,
    TextField,
    UniqueConstraint,
    Value,
)
from django.db.models.functions import Greatest

from ..shared.models import CreatedAtMixin, TimestampMixin


class Category(Model):
    name = CharField(max_length=255)
    description = TextField(blank=True)
    slug = SlugField(unique=True)
    order = IntegerField(default=0)
    thread_count = PositiveIntegerField(default=0)

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ["order", "name"]
        indexes = [
            Index(fields=["order", "name"]),
        ]

    def __str__(self):
        return self.name

    def adjust_thread_count(self, delta: int):
        self.__class__.objects.filter(pk=self.pk).update(
            thread_count=Greatest(F("thread_count") + delta, Value(0))
        )


class Tag(Model):
    name = CharField(max_length=50)
    slug = SlugField(unique=True)
    color = CharField(max_length=7, default="#A855F7")

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ModerationFields(Model):
    """Edit marker and soft-removal state shared by threads and posts."""

    edited_at = DateTimeField(null=True, blank=True)
    is_removed = BooleanField(default=False, db_index=True)
    removed_by = ForeignKey("users.CustomUser", SET_NULL, null=True, blank=True, related_name="+")
    removed_at = DateTimeField(null=True, blank=True)
    removal_reason = CharField(max_length=200, blank=True)

    class Meta:
        abstract = True


class Thread(TimestampMixin, ModerationFields, Model):
    category = ForeignKey(Category, CASCADE, related_name="threads")
    # Mention notifications sent for this thread across all its edits (capped).
    mentions_notified = PositiveSmallIntegerField(default=0)
    title = CharField(max_length=255, db_index=True)
    # D-6: a deleted account's threads stay, shown as by "deleted user" (author NULL).
    author = ForeignKey(
        "users.CustomUser", SET_NULL, null=True, blank=True, related_name="forum_threads"
    )
    content = TextField()
    is_pinned = BooleanField(default=False, db_index=True)
    is_locked = BooleanField(default=False)
    view_count = PositiveIntegerField(default=0)
    reply_count = PositiveIntegerField(default=0)
    like_count = PositiveIntegerField(default=0)
    tags = ManyToManyField(Tag, related_name="threads", blank=True)

    class Meta:
        ordering = ["-is_pinned", "-updated_at"]
        indexes = [
            Index(fields=["-is_pinned", "-updated_at"]),
            Index(fields=["category", "-is_pinned", "-updated_at"]),
            Index(fields=["category", "-updated_at"]),
            Index(fields=["-updated_at"]),
            Index(fields=["-created_at"]),
        ]

    def __str__(self):
        return self.title

    def adjust_reply_count(self, delta: int):
        self.__class__.objects.filter(pk=self.pk).update(
            reply_count=Greatest(F("reply_count") + delta, Value(0))
        )

    def adjust_like_count(self, delta: int):
        self.__class__.objects.filter(pk=self.pk).update(
            like_count=Greatest(F("like_count") + delta, Value(0))
        )


class Post(TimestampMixin, ModerationFields, Model):
    # Absolute depth of the deepest reply (0 = top level); a post at this depth
    # cannot be replied to.
    MAX_DEPTH = 10

    thread = ForeignKey(Thread, CASCADE, related_name="posts")
    # D-6: a deleted account's posts stay, shown as by "deleted user" (author NULL).
    author = ForeignKey(
        "users.CustomUser", SET_NULL, null=True, blank=True, related_name="forum_posts"
    )
    # The author deleted it (shown as "[deleted]"), as opposed to a moderator removal.
    removed_by_author = BooleanField(default=False)
    # Mention notifications sent for this post across all its edits (capped).
    mentions_notified = PositiveSmallIntegerField(default=0)
    content = TextField()
    like_count = PositiveIntegerField(default=0)
    parent = ForeignKey(
        "self",
        CASCADE,
        related_name="replies",
        null=True,
        blank=True,
    )
    depth = PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            Index(fields=["thread", "created_at"]),
            Index(fields=["thread", "parent", "created_at"]),
        ]

    def __str__(self):
        author = self.author.username if self.author_id else "deleted user"
        return f"Post by {author} in {self.thread.title}"

    def adjust_like_count(self, delta: int):
        self.__class__.objects.filter(pk=self.pk).update(
            like_count=Greatest(F("like_count") + delta, Value(0))
        )

    @property
    def removal(self) -> str | None:
        """``None``, ``"author"`` (the author deleted it) or ``"moderator"``."""
        if not self.is_removed:
            return None
        return "author" if self.removed_by_author else "moderator"


class ThreadLike(CreatedAtMixin, Model):
    thread = ForeignKey(Thread, CASCADE, related_name="likes")
    user = ForeignKey("users.CustomUser", CASCADE, related_name="liked_threads")

    class Meta:
        unique_together = ("thread", "user")

    def __str__(self):
        return f"{self.user.username} likes {self.thread.title}"


class PostLike(CreatedAtMixin, Model):
    post = ForeignKey(Post, CASCADE, related_name="likes")
    user = ForeignKey("users.CustomUser", CASCADE, related_name="liked_posts")

    class Meta:
        unique_together = ("post", "user")

    def __str__(self):
        return f"{self.user.username} likes Post {self.post.id}"


class ThreadSubscription(CreatedAtMixin, Model):
    """A user who is notified about new posts in a thread."""

    user = ForeignKey("users.CustomUser", CASCADE, related_name="forum_thread_subscriptions")
    thread = ForeignKey(Thread, CASCADE, related_name="subscriptions")

    class Meta:
        constraints = [
            UniqueConstraint(fields=["user", "thread"], name="forums_threadsub_user_thread_uniq"),
        ]
        indexes = [Index(fields=["thread"], name="forums_threadsub_thread_idx")]

    def __str__(self):
        return f"{self.user_id} follows thread {self.thread_id}"
