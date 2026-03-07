from django.db.models import (
    Model,
    CharField,
    TextField,
    SlugField,
    IntegerField,
    PositiveIntegerField,
    PositiveSmallIntegerField,
    BooleanField,
    ForeignKey,
    ManyToManyField,
    CASCADE,
    Index,
    F,
)

from apps.shared.models import TimestampMixin, CreatedAtMixin

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

    def update_thread_count(self):
        self.thread_count = self.threads.count()
        self.save(update_fields=["thread_count"])

class Tag(Model):
    name = CharField(max_length=50)
    slug = SlugField(unique=True)
    color = CharField(max_length=7, default="#A855F7")

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

class Thread(TimestampMixin, Model):
    category = ForeignKey(Category, CASCADE, related_name="threads")
    title = CharField(max_length=255, db_index=True)
    author = ForeignKey("users.CustomUser", CASCADE, related_name="forum_threads")
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
            Index(fields=["-updated_at"]),
            Index(fields=["-created_at"]),
        ]

    def __str__(self):
        return self.title

    def update_reply_count(self):
        self.reply_count = self.posts.count()
        self.save(update_fields=["reply_count"])

    def update_like_count(self):
        from django.db import transaction

        def _update():
            self.refresh_from_db()
            self.like_count = self.likes.count()
            self.save(update_fields=["like_count"])

        transaction.on_commit(_update)

    def increment_view_count(self):
        self.__class__.objects.filter(pk=self.pk).update(view_count=F("view_count") + 1)
        self.refresh_from_db(fields=["view_count"])

class Post(TimestampMixin, Model):
    thread = ForeignKey(Thread, CASCADE, related_name="posts")
    author = ForeignKey("users.CustomUser", CASCADE, related_name="forum_posts")
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
        return f"Post by {self.author.username} in {self.thread.title}"

    def update_like_count(self):
        from django.db import transaction

        def _update():
            self.refresh_from_db()
            self.like_count = self.likes.count()
            self.save(update_fields=["like_count"])

        transaction.on_commit(_update)

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
