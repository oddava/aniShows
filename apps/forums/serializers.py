from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError
from rest_framework.exceptions import ValidationError
from rest_framework.fields import CharField, IntegerField, SerializerMethodField
from rest_framework.relations import PrimaryKeyRelatedField
from rest_framework.serializers import ModelSerializer, Serializer

from ..users.services.avatar_service import get_user_avatar_url
from .models import Category, Post, Tag, Thread
from .services.excerpt import build_excerpt

User = get_user_model()

TOO_DEEP_MESSAGE = "This conversation is too deep to reply here. Reply higher up."
REMOVED_PARENT_MESSAGE = "This reply was removed and can't be replied to."
# Forum bodies are rendered in every viewer's browser: keep them bounded.
CONTENT_FIELD_KWARGS = {"content": {"max_length": settings.FORUM_CONTENT_MAX_LENGTH}}


def _viewer_is_staff(serializer) -> bool:
    request = serializer.context.get("request")
    return bool(request and request.user.is_staff)


class LikedByUserMixin:
    """Mixin for serializers that need is_liked_by_user field."""

    def get_is_liked_by_user(self, obj):
        # Prefer the annotated attribute if it exists
        if hasattr(obj, "is_liked_by_user"):
            return obj.is_liked_by_user

        return False


class RemovalReasonMixin:
    """``removal_reason`` is shown to staff only."""

    def get_removal_reason(self, obj) -> str:
        return obj.removal_reason if _viewer_is_staff(self) else ""


class CustomUserSerializer(ModelSerializer):
    avatar = SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "avatar"]

    def get_avatar(self, obj):
        # The avatar URL itself is resolved best-effort; only the linked-account
        # lookup touches the database.
        try:
            return get_user_avatar_url(obj)
        except DatabaseError:
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
        if not getattr(obj, "latest_thread_id", None):
            return None
        return {
            "id": obj.latest_thread_id,
            "title": obj.latest_thread_title,
            "updated_at": obj.latest_thread_updated_at,
            "author": obj.latest_thread_author_username,
        }


class ThreadListSerializer(LikedByUserMixin, ModelSerializer):
    """Lightweight serializer for thread lists: a plain-text ``excerpt`` instead of ``content``."""

    author = CustomUserSerializer(read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    like_count = IntegerField(read_only=True)
    is_liked_by_user = SerializerMethodField()
    category_name = CharField(source="category.name", read_only=True)
    category_slug = CharField(source="category.slug", read_only=True)
    excerpt = SerializerMethodField()

    class Meta:
        model = Thread
        fields = [
            "id",
            "category",
            "category_name",
            "category_slug",
            "title",
            "excerpt",
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

    def get_excerpt(self, obj) -> str:
        return build_excerpt(obj.content)


class ThreadSerializer(RemovalReasonMixin, LikedByUserMixin, ModelSerializer):
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
    is_subscribed = SerializerMethodField()
    removal_reason = SerializerMethodField()

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
            "edited_at",
            "is_pinned",
            "is_locked",
            "view_count",
            "reply_count",
            "tags",
            "tag_ids",
            "like_count",
            "is_liked_by_user",
            "is_subscribed",
            "is_removed",
            "removal_reason",
        ]
        extra_kwargs = CONTENT_FIELD_KWARGS
        read_only_fields = [
            "author",
            "created_at",
            "updated_at",
            "edited_at",
            "is_pinned",
            "is_locked",
            "view_count",
            "reply_count",
            "is_removed",
        ]

    def validate(self, attrs):
        if self.instance is None:
            return attrs
        if not _viewer_is_staff(self):
            # Moving a thread is a moderator action.
            attrs.pop("category", None)
        elif self.instance.author_id != self.context["request"].user.id:
            # Staff may move someone else's thread but not rewrite it.
            attrs = {key: value for key, value in attrs.items() if key == "category"}
        return attrs

    def get_is_subscribed(self, obj) -> bool:
        return bool(getattr(obj, "is_subscribed", False))


class PostSerializer(RemovalReasonMixin, LikedByUserMixin, ModelSerializer):
    """A post. Removed posts keep their place; non-staff see no content or author."""

    author = CustomUserSerializer(read_only=True)
    like_count = IntegerField(read_only=True)
    is_liked_by_user = SerializerMethodField()
    # Declared fields are popped off the class, so ``Field.parent`` is not shadowed.
    parent = PrimaryKeyRelatedField(  # type: ignore[assignment]
        queryset=Post.objects.all(), required=False, allow_null=True
    )
    depth = IntegerField(read_only=True)
    reply_count = SerializerMethodField()
    removal = SerializerMethodField()
    removal_reason = SerializerMethodField()
    has_hidden_replies = SerializerMethodField()
    can_reply = SerializerMethodField()

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
            "edited_at",
            "is_removed",
            "removal",
            "removal_reason",
            "has_hidden_replies",
            "can_reply",
        ]
        extra_kwargs = CONTENT_FIELD_KWARGS
        read_only_fields = [
            "author",
            "created_at",
            "updated_at",
            "like_count",
            "depth",
            "edited_at",
            "is_removed",
        ]

    def validate_thread(self, thread):
        if thread.is_removed and not _viewer_is_staff(self):
            raise ValidationError("Thread not found.")
        return thread

    def validate(self, attrs):
        if self.instance is not None:
            if self.instance.is_removed:
                raise ValidationError({"content": "A removed reply can't be edited."})
            # A post cannot be moved: that would bypass the checks below and
            # break the reply tree and the threads' reply counters.
            attrs.pop("thread", None)
            attrs.pop("parent", None)
            return attrs

        parent = attrs.get("parent")
        thread = attrs.get("thread")
        if parent and thread and parent.thread_id != thread.id:
            raise ValidationError({"parent": "Parent post must belong to the same thread."})
        if parent and parent.depth >= Post.MAX_DEPTH:
            raise ValidationError({"parent": TOO_DEEP_MESSAGE})
        if parent and parent.is_removed and not _viewer_is_staff(self):
            raise ValidationError({"parent": REMOVED_PARENT_MESSAGE})

        if thread and thread.is_locked and not _viewer_is_staff(self):
            raise ValidationError({"thread": "This thread is locked."})
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.is_removed and not _viewer_is_staff(self):
            data["content"] = ""
            data["author"] = None
        return data

    def get_reply_count(self, obj) -> int:
        """The number of direct replies (annotated by ``build_post_queryset``)."""
        return getattr(obj, "reply_count", 0)

    def get_removal(self, obj) -> str | None:
        return obj.removal

    def get_has_hidden_replies(self, obj) -> bool:
        return getattr(obj, "has_hidden_replies", False)

    def get_can_reply(self, obj) -> bool:
        thread = obj.thread
        if obj.depth >= Post.MAX_DEPTH or obj.is_removed or thread.is_removed:
            return False
        return not thread.is_locked or _viewer_is_staff(self)


class ModerationReasonSerializer(Serializer):
    reason = CharField(max_length=200, required=False, allow_blank=True, default="")
