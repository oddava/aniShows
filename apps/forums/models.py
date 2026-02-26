from django.db import models
from django.conf import settings
from django.db.models import F


class Category(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    slug = models.SlugField(unique=True)
    order = models.IntegerField(default=0)
    thread_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ["order", "name"]
        indexes = [
            models.Index(fields=["order", "name"]),
        ]

    def __str__(self):
        return self.name

    def update_thread_count(self):
        """Update denormalized thread count"""
        self.thread_count = self.threads.count()
        self.save(update_fields=["thread_count"])


class Tag(models.Model):
    name = models.CharField(max_length=50)
    slug = models.SlugField(unique=True)
    color = models.CharField(max_length=7, default="#A855F7")  # Hex color, default purple

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Thread(models.Model):
    category = models.ForeignKey(Category, related_name="threads", on_delete=models.CASCADE)
    title = models.CharField(max_length=255, db_index=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="forum_threads", on_delete=models.CASCADE
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    is_pinned = models.BooleanField(default=False, db_index=True)
    is_locked = models.BooleanField(default=False)
    view_count = models.PositiveIntegerField(default=0)
    reply_count = models.PositiveIntegerField(default=0)
    like_count = models.PositiveIntegerField(default=0)
    tags = models.ManyToManyField(Tag, related_name="threads", blank=True)

    class Meta:
        ordering = ["-is_pinned", "-updated_at"]
        indexes = [
            models.Index(fields=["-is_pinned", "-updated_at"]),
            models.Index(fields=["category", "-is_pinned", "-updated_at"]),
            models.Index(fields=["-updated_at"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self):
        return self.title

    def update_reply_count(self):
        """Update denormalized reply count"""
        self.reply_count = self.posts.count()
        self.save(update_fields=["reply_count"])

    def update_like_count(self):
        """Update denormalized like count"""
        from django.db import transaction

        def _update():
            # Refresh from DB to ensure we see the latest likes
            self.refresh_from_db()
            self.like_count = self.likes.count()
            self.save(update_fields=["like_count"])

        transaction.on_commit(_update)

    def increment_view_count(self):
        """Atomically increment view count"""
        self.__class__.objects.filter(pk=self.pk).update(view_count=F("view_count") + 1)
        self.refresh_from_db(fields=["view_count"])


class Post(models.Model):
    thread = models.ForeignKey(Thread, related_name="posts", on_delete=models.CASCADE)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="forum_posts", on_delete=models.CASCADE
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    like_count = models.PositiveIntegerField(default=0)
    parent = models.ForeignKey(
        "self",
        related_name="replies",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    depth = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["thread", "created_at"]),
            models.Index(fields=["thread", "parent", "created_at"]),
        ]

    def __str__(self):
        return f"Post by {self.author.username} in {self.thread.title}"

    def update_like_count(self):
        """Update denormalized like count"""
        from django.db import transaction

        def _update():
            # Refresh from DB to ensure we see the latest likes
            self.refresh_from_db()
            self.like_count = self.likes.count()
            self.save(update_fields=["like_count"])

        transaction.on_commit(_update)


class ThreadLike(models.Model):
    thread = models.ForeignKey(Thread, related_name="likes", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="liked_threads", on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("thread", "user")

    def __str__(self):
        return f"{self.user.username} likes {self.thread.title}"


class PostLike(models.Model):
    post = models.ForeignKey(Post, related_name="likes", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="liked_posts", on_delete=models.CASCADE
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("post", "user")

    def __str__(self):
        return f"{self.user.username} likes Post {self.post.id}"
