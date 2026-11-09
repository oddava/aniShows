import bleach
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError
from rest_framework.fields import CharField, IntegerField, SerializerMethodField
from rest_framework.relations import PrimaryKeyRelatedField
from rest_framework.serializers import ModelSerializer

from ..users.services.avatar_service import get_user_avatar_url
from .models import Category, Post, Tag, Thread

User = get_user_model()

class LikedByUserMixin:
    """Mixin for serializers that need is_liked_by_user field."""

    def get_is_liked_by_user(self, obj):
        # Prefer the annotated attribute if it exists
        if hasattr(obj, "is_liked_by_user"):
            return obj.is_liked_by_user

        return False

class ContentSanitizationMixin:
    """Mixin for serializers that sanitize content with bleach."""

    def validate_content(self, value):
        return bleach.clean(value, tags=[], strip=True)

class CustomUserSerializer(ModelSerializer):
    avatar = SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "avatar"]

    def get_avatar(self, obj):
        try:
            return get_user_avatar_url(obj)
        except Exception:
            return None

class TagSerializer(ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name", "slug", "color"]

class CategorySerializer(ModelSerializer):
    latest_thread = SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "description", "slug", "order", "thread_count", "latest_thread"]

    def get_latest_thread(self, obj):
        if getattr(obj, "latest_thread_id", None):
            return {
                "id": obj.latest_thread_id,
                "title": obj.latest_thread_title,
                "updated_at": obj.latest_thread_updated_at,
                "author": obj.latest_thread_author_username,
            }

        if hasattr(obj, "prefetched_latest_thread"):
            latest = obj.prefetched_latest_thread[0] if obj.prefetched_latest_thread else None
        else:
            latest = None

        if latest:
            return {
                "id": latest.id,
                "title": latest.title,
                "updated_at": latest.updated_at,
                "author": latest.author.username,
            }
        return None

class ThreadListSerializer(LikedByUserMixin, ModelSerializer):
    """Lightweight serializer for thread lists - excludes content for faster loading"""

    author = CustomUserSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    like_count = IntegerField(read_only=True)
    is_liked_by_user = SerializerMethodField()
    category_name = CharField(source="category.name", read_only=True)
    category_slug = CharField(source="category.slug", read_only=True)

    class Meta:
        model = Thread
        fields = [
            "id",
            "category",
            "category_name",
            "category_slug",
            "title",
            "content",
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

class ThreadSerializer(ContentSanitizationMixin, LikedByUserMixin, ModelSerializer):
    """Full serializer for thread detail view"""

    author = CustomUserSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = PrimaryKeyRelatedField(
        queryset=Tag.objects.all(), source="tags", many=True, write_only=True, required=False
    )
    like_count = IntegerField(read_only=True)
    is_liked_by_user = SerializerMethodField()
    category_name = CharField(source="category.name", read_only=True)
    category_slug = CharField(source="category.slug", read_only=True)

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

class PostSerializer(ContentSanitizationMixin, LikedByUserMixin, ModelSerializer):
    author = CustomUserSerializer(read_only=True)
    like_count = IntegerField(read_only=True)
    is_liked_by_user = SerializerMethodField()
    parent = PrimaryKeyRelatedField(
        queryset=Post.objects.all(), required=False, allow_null=True
    )
    depth = IntegerField(read_only=True)
    reply_count = SerializerMethodField()

    def validate(self, attrs):
        if self.instance is not None:
            # A post cannot be moved: that would bypass the checks below and
            # break the reply tree and the threads' reply counters.
            attrs.pop("thread", None)
            attrs.pop("parent", None)
            return attrs

        parent = attrs.get("parent")
        thread = attrs.get("thread")
        if parent and thread and parent.thread_id != thread.id:
            raise ValidationError(
                {"parent": "Parent post must belong to the same thread."}
            )

        request = self.context.get("request")
        is_staff = bool(request and request.user.is_staff)
        if thread and thread.is_locked and not is_staff:
            raise ValidationError({"thread": "This thread is locked."})
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

    def get_reply_count(self, obj):
        """Get the number of direct replies to this post"""
        if hasattr(obj, "reply_count"):
            return obj.reply_count
        return 0
