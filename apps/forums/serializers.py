import bleach
from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Category, Thread, Post, Tag

User = get_user_model()


class CustomUserSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "avatar"]

    def get_avatar(self, obj):
        try:
            profile = obj.userprofile
            return profile.avatar.url if profile and profile.avatar else None
        except Exception:
            return None


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name", "slug", "color"]


class CategorySerializer(serializers.ModelSerializer):
    latest_thread = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "description", "slug", "order", "thread_count", "latest_thread"]

    def get_latest_thread(self, obj):
        # We can prefetch this using a Prefetch object in the view, but since categories are few, it's okay for now.
        # Alternatively, if prefetched, it will be in obj.prefetched_latest_thread
        if hasattr(obj, "prefetched_latest_thread"):
            latest = obj.prefetched_latest_thread[0] if obj.prefetched_latest_thread else None
        else:
            latest = obj.threads.order_by("-updated_at").select_related("author").first()

        if latest:
            return {
                "id": latest.id,
                "title": latest.title,
                "updated_at": latest.updated_at,
                "author": latest.author.username,
            }
        return None


class ThreadListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for thread lists - excludes content for faster loading"""

    author = CustomUserSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    like_count = serializers.IntegerField(read_only=True)
    is_liked_by_user = serializers.SerializerMethodField()
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_slug = serializers.CharField(source="category.slug", read_only=True)

    class Meta:
        model = Thread
        fields = [
            "id",
            "category",
            "category_name",
            "category_slug",
            "title",
            "author",
            "created_at",
            "updated_at",
            "is_pinned",
            "is_locked",
            "view_count",
            "reply_count",
            "tags",
            "like_count",
            "is_liked_by_user",
        ]
        read_only_fields = [
            "author",
            "created_at",
            "updated_at",
            "is_pinned",
            "is_locked",
            "view_count",
            "reply_count",
        ]

    def get_is_liked_by_user(self, obj):
        # Prefer the annotated attribute if it exists
        if hasattr(obj, "is_liked_by_user"):
            return obj.is_liked_by_user

        user = self.context["request"].user
        if user and user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False


class ThreadSerializer(serializers.ModelSerializer):
    """Full serializer for thread detail view"""

    author = CustomUserSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source="tags", many=True, write_only=True, required=False
    )
    like_count = serializers.IntegerField(read_only=True)
    is_liked_by_user = serializers.SerializerMethodField()
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_slug = serializers.CharField(source="category.slug", read_only=True)

    class Meta:
        model = Thread
        fields = [
            "id",
            "category",
            "category_name",
            "category_slug",
            "title",
            "author",
            "content",
            "created_at",
            "updated_at",
            "is_pinned",
            "is_locked",
            "view_count",
            "reply_count",
            "tags",
            "tag_ids",
            "like_count",
            "is_liked_by_user",
        ]
        read_only_fields = [
            "author",
            "created_at",
            "updated_at",
            "is_pinned",
            "is_locked",
            "view_count",
            "reply_count",
        ]

    def validate_content(self, value):
        return bleach.clean(value, tags=[], strip=True)

    def get_is_liked_by_user(self, obj):
        # Prefer the annotated attribute if it exists
        if hasattr(obj, "is_liked_by_user"):
            return obj.is_liked_by_user

        user = self.context["request"].user
        if user and user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False


class PostSerializer(serializers.ModelSerializer):
    author = CustomUserSerializer(read_only=True)
    like_count = serializers.IntegerField(read_only=True)
    is_liked_by_user = serializers.SerializerMethodField()
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Post.objects.all(), required=False, allow_null=True
    )
    depth = serializers.IntegerField(read_only=True)
    reply_count = serializers.SerializerMethodField()

    def validate(self, attrs):
        # Ensure parent post belongs to the same thread
        parent = attrs.get("parent")
        thread = attrs.get("thread")
        if parent and thread and parent.thread_id != thread.id:
            raise serializers.ValidationError(
                {"parent": "Parent post must belong to the same thread."}
            )
        return attrs

    class Meta:
        model = Post
        fields = [
            "id",
            "thread",
            "author",
            "content",
            "created_at",
            "updated_at",
            "like_count",
            "is_liked_by_user",
            "parent",
            "depth",
            "reply_count",
        ]
        read_only_fields = ["author", "created_at", "updated_at", "like_count", "depth"]

    def validate_content(self, value):
        return bleach.clean(value, tags=[], strip=True)

    def get_is_liked_by_user(self, obj):
        # Prefer the annotated attribute if it exists
        if hasattr(obj, "is_liked_by_user"):
            return obj.is_liked_by_user

        user = self.context["request"].user
        if user and user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False

    def get_reply_count(self, obj):
        """Get the number of direct replies to this post"""
        if hasattr(obj, "reply_count"):
            return obj.reply_count
        return obj.replies.count()
