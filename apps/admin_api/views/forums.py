"""Forum administration: categories and tags (superuser writes), threads and posts (staff).

Thread and post moderation goes through ``apps.forums.services.moderation``, which
writes the audit row itself when something changed; a repeat is a no-op, marked so
the fallback middleware writes nothing either.
"""

from __future__ import annotations

import re

from django.db import transaction
from django.db.models import Count
from django_filters import BooleanFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.fields import CharField, IntegerField, SerializerMethodField
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.serializers import ModelSerializer
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from ...core.models import AuditLog
from ...forums.cache_utils import invalidate_category_detail_cache, invalidate_thread_caches
from ...forums.models import Category, Post, Tag, Thread
from ...forums.serializers import ModerationReasonSerializer
from ...forums.services import moderation
from ...forums.services.events import run_after_commit
from ...forums.services.interactions import _move_thread
from ..permissions import AdminPolicyMixin
from ..services.audit import mark_nothing_to_audit, record_admin_action
from ..services.slugs import unique_slug
from .audit_mixins import AuditedModelViewSetMixin

SNIPPET_LENGTH = 200
HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _person(user) -> dict | None:
    return {"id": user.id, "username": user.username} if user else None


class AdminForumCategorySerializer(ModelSerializer):
    slug = CharField(max_length=50, required=False, allow_blank=True)

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description", "order", "thread_count"]
        read_only_fields = ["thread_count"]

    def validate(self, attrs):
        attrs["slug"] = unique_slug(Category, self.instance, attrs)
        return attrs


class AdminForumTagSerializer(ModelSerializer):
    slug = CharField(max_length=50, required=False, allow_blank=True)
    thread_count = IntegerField(read_only=True, default=0)

    class Meta:
        model = Tag
        fields = ["id", "name", "slug", "color", "thread_count"]

    def validate_color(self, value):
        if not HEX_COLOR.match(value or ""):
            raise ValidationError("Use a #RRGGBB colour.")
        return value.lower()

    def validate(self, attrs):
        attrs["slug"] = unique_slug(Tag, self.instance, attrs)
        return attrs


class AdminForumThreadSerializer(ModelSerializer):
    category = SerializerMethodField()
    author = SerializerMethodField()
    snippet = SerializerMethodField()

    class Meta:
        model = Thread
        fields = [
            "id",
            "title",
            "category",
            "author",
            "created_at",
            "updated_at",
            "is_pinned",
            "is_locked",
            "is_removed",
            "removed_at",
            "removal_reason",
            "reply_count",
            "view_count",
            "like_count",
            "snippet",
        ]

    def get_category(self, obj):
        return {"id": obj.category_id, "name": obj.category.name, "slug": obj.category.slug}

    def get_author(self, obj):
        return _person(obj.author)

    def get_snippet(self, obj):
        return (obj.content or "")[:SNIPPET_LENGTH]


class AdminForumThreadDetailSerializer(AdminForumThreadSerializer):
    class Meta(AdminForumThreadSerializer.Meta):
        fields = [*AdminForumThreadSerializer.Meta.fields, "content"]


class AdminForumPostSerializer(ModelSerializer):
    thread = SerializerMethodField()
    author = SerializerMethodField()
    snippet = SerializerMethodField()

    class Meta:
        model = Post
        fields = [
            "id",
            "thread",
            "author",
            "snippet",
            "depth",
            "like_count",
            "created_at",
            "is_removed",
            "removal_reason",
            "removed_by_author",
        ]

    def get_thread(self, obj):
        return {"id": obj.thread_id, "title": obj.thread.title}

    def get_author(self, obj):
        return _person(obj.author)

    def get_snippet(self, obj):
        return (obj.content or "")[:SNIPPET_LENGTH]


class AdminForumPostDetailSerializer(AdminForumPostSerializer):
    class Meta(AdminForumPostSerializer.Meta):
        fields = [*AdminForumPostSerializer.Meta.fields, "content"]


class AdminForumCategoryViewSet(AdminPolicyMixin, AuditedModelViewSetMixin, ModelViewSet):
    serializer_class = AdminForumCategorySerializer
    audit_entity_type = "ForumCategory"
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "slug"]
    queryset = Category.objects.order_by("order", "name")

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        with transaction.atomic():
            if Thread.objects.filter(category=category).exists():
                return Response(
                    {"detail": "Move or delete this category's threads first."},
                    status=status.HTTP_409_CONFLICT,
                )
            self.perform_destroy(category)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminForumTagViewSet(AdminPolicyMixin, AuditedModelViewSetMixin, ModelViewSet):
    serializer_class = AdminForumTagSerializer
    audit_entity_type = "ForumTag"
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "slug"]

    def get_queryset(self):
        return Tag.objects.annotate(thread_count=Count("threads")).order_by("name")


class ThreadFilter(FilterSet):
    category = NumberFilter(field_name="category_id")
    author = NumberFilter(field_name="author_id")
    is_removed = BooleanFilter(field_name="is_removed")
    is_pinned = BooleanFilter(field_name="is_pinned")
    is_locked = BooleanFilter(field_name="is_locked")

    class Meta:
        model = Thread
        fields = ["category", "author", "is_removed", "is_pinned", "is_locked"]


class PostFilter(FilterSet):
    thread = NumberFilter(field_name="thread_id")
    author = NumberFilter(field_name="author_id")
    is_removed = BooleanFilter(field_name="is_removed")

    class Meta:
        model = Post
        fields = ["thread", "author", "is_removed"]


def _reason(request) -> str:
    serializer = ModerationReasonSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data["reason"].strip()


def _flag(request, name: str) -> bool:
    value = request.data.get(name)
    if not isinstance(value, bool):
        raise ValidationError({name: "Must be true or false."})
    return value


def _invalidate_thread(thread: Thread) -> None:
    def _invalidate():
        invalidate_thread_caches(thread.id)
        invalidate_category_detail_cache(thread.category.slug)

    run_after_commit(_invalidate, "Failed to invalidate caches for thread %s", thread.id)


class AdminForumThreadViewSet(
    AdminPolicyMixin, ListModelMixin, RetrieveModelMixin, DestroyModelMixin, GenericViewSet
):
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ThreadFilter
    search_fields = ["title", "content", "author__username"]
    ordering_fields = ["created_at", "updated_at", "reply_count", "view_count"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return Thread.objects.select_related("category", "author")

    def get_serializer_class(self):
        if self.action == "list":
            return AdminForumThreadSerializer
        return AdminForumThreadDetailSerializer

    def _respond(self, thread_id: int) -> Response:
        return Response(self.get_serializer(self.get_queryset().get(pk=thread_id)).data)

    def _locked(self) -> Thread:
        return (
            Thread.objects.select_related("category")
            .select_for_update(of=("self",))
            .get(pk=self.get_object().pk)
        )

    def _set_flag(self, request, field: str, operation: str) -> Response:
        desired = _flag(request, field)
        with transaction.atomic():
            thread = self._locked()
            previous = getattr(thread, field)
            if previous == desired:
                mark_nothing_to_audit(request)
            else:
                setattr(thread, field, desired)
                thread.save(update_fields=[field])
                record_admin_action(
                    request,
                    action=AuditLog.ActionType.UPDATE,
                    entity_type="forum_thread",
                    entity_id=thread.pk,
                    entity_repr=thread.title,
                    previous={field: previous},
                    new={field: desired},
                    metadata={"operation": operation},
                )
                _invalidate_thread(thread)
        return self._respond(thread.pk)

    @action(detail=True, methods=["post"])
    def pin(self, request, pk=None):
        """``{"is_pinned": bool}``: pin or unpin (idempotent)."""
        return self._set_flag(request, "is_pinned", "forum.thread.pin")

    @action(detail=True, methods=["post"])
    def lock(self, request, pk=None):
        """``{"is_locked": bool}``: lock or unlock (idempotent)."""
        desired = _flag(request, "is_locked")
        with transaction.atomic():
            thread = self._locked()
            if thread.is_locked != desired:
                moderation.toggle_thread_lock(thread, request=request)
            mark_nothing_to_audit(request)
        return self._respond(thread.pk)

    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        """Soft-remove with an optional ``reason``; a repeat changes nothing."""
        reason = _reason(request)
        thread = self.get_object()
        moderation.remove_thread(thread, request=request, reason=reason)
        mark_nothing_to_audit(request)
        return self._respond(thread.pk)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        thread = self.get_object()
        moderation.restore_thread(thread, request=request)
        mark_nothing_to_audit(request)
        return self._respond(thread.pk)

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """``{"category_id": id}``: move the thread (counters follow, audited)."""
        raw = request.data.get("category_id")
        if isinstance(raw, bool) or not isinstance(raw, int | str):
            raise ValidationError({"category_id": "A category id is required."})
        try:
            target = Category.objects.get(pk=int(raw))
        except (TypeError, ValueError, Category.DoesNotExist):
            raise ValidationError({"category_id": "Category not found."}) from None
        with transaction.atomic():
            thread = self._locked()
            from_category_id = thread.category_id
            if from_category_id == target.pk:
                mark_nothing_to_audit(request)
            else:
                thread.category = target
                thread.save(update_fields=["category"])
                _move_thread(thread, from_category_id)
                moderation.record_thread_move(request, thread, from_category_id=from_category_id)
                _invalidate_thread(thread)
        return self._respond(thread.pk)

    def destroy(self, request, *args, **kwargs):
        """Hard delete (superuser): the thread and every post in it."""
        thread = self.get_object()
        thread_id, category_slug = thread.pk, thread.category.slug
        with transaction.atomic():
            record_admin_action(
                request,
                action=AuditLog.ActionType.DELETE,
                entity_type="forum_thread",
                entity_id=thread.pk,
                entity_repr=thread.title,
                previous={
                    "title": thread.title,
                    "author": thread.author.username if thread.author else None,
                    "category_id": thread.category_id,
                    "reply_count": thread.reply_count,
                },
                metadata={"operation": "forum.thread.delete"},
            )
            thread.delete()
            run_after_commit(
                lambda: (
                    invalidate_thread_caches(thread_id),
                    invalidate_category_detail_cache(category_slug),
                ),
                "Failed to invalidate caches for deleted thread %s",
                thread_id,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminForumPostViewSet(AdminPolicyMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = PostFilter
    search_fields = ["content", "author__username"]
    ordering_fields = ["created_at", "like_count"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return Post.objects.select_related("thread", "author")

    def get_serializer_class(self):
        if self.action == "list":
            return AdminForumPostSerializer
        return AdminForumPostDetailSerializer

    def _respond(self, post_id: int) -> Response:
        return Response(self.get_serializer(self.get_queryset().get(pk=post_id)).data)

    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        reason = _reason(request)
        post = self.get_object()
        moderation.remove_post(post, request=request, reason=reason)
        mark_nothing_to_audit(request)
        return self._respond(post.pk)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        post = self.get_object()
        moderation.restore_post(post, request=request)
        mark_nothing_to_audit(request)
        return self._respond(post.pk)
