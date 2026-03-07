import re
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Exists, OuterRef, Count, Prefetch
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import hashlib

from rest_framework.viewsets import ReadOnlyModelViewSet, ModelViewSet

from apps.shared.logger import logger
from apps.core.utils import get_client_ip

from .models import Category, Thread, Post, Tag, ThreadLike, PostLike
from .serializers import (
    CategorySerializer,
    ThreadSerializer,
    ThreadListSerializer,
    PostSerializer,
    TagSerializer,
)
from .cache_utils import (
    get_cached_thread_list,
    cache_thread_list,
    get_cached_thread_detail,
    cache_thread_detail,
    get_cached_post_list,
    cache_post_list,
    get_cached_category_list,
    cache_category_list,
    get_cached_category_detail,
    cache_category_detail,
    get_cached_tag_list,
    cache_tag_list,
    invalidate_thread_caches,
    invalidate_post_list_cache,
    invalidate_thread_list_cache,
)
from apps.core.services.notification_service import NotificationService
from apps.users.throttling import ForumLikeRateThrottle, ForumWriteRateThrottle

User = get_user_model()


def _broadcast_to_thread(thread_id, event):
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        group_name = f"forum_thread_{thread_id}"
        async_to_sync(channel_layer.group_send)(group_name, event)
    except Exception:
        logger.exception("Failed to broadcast forum event for thread %s", thread_id)


class IsOwnerOrReadOnly(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.author == request.user


def handle_mentions(author, instance, is_thread=False):
    pattern = r"(?<=^|(?<=[^a-zA-Z0-9-_\.]))@([A-Za-z0-9_]+)"
    usernames = set(re.findall(pattern, instance.content))
    for username in usernames:
        if username == author.username:
            continue
        try:
            mentioned_user = User.objects.get(username__iexact=username)
            NotificationService.create_forum_mention_notification(
                user=mentioned_user, author=author, instance=instance, is_thread=is_thread
            )
        except User.DoesNotExist:
            pass


class TagViewSet(ReadOnlyModelViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    permission_classes = [permissions.AllowAny]
    lookup_field = "slug"
    ordering_fields = ["name"]
    ordering = ["name"]

    def list(self, request, *args, **kwargs):
        """Cache tag list"""
        cached = get_cached_tag_list()
        if cached is not None:
            return Response(cached)

        response = super().list(request, *args, **kwargs)
        cache_tag_list(response.data)
        return response


class CategoryViewSet(ReadOnlyModelViewSet):
    permission_classes = [permissions.AllowAny]
    serializer_class = CategorySerializer
    lookup_field = "slug"
    ordering_fields = ["order", "name"]
    ordering = ["order"]

    def get_queryset(self):
        latest_thread_prefetch = Prefetch(
            "threads",
            queryset=Thread.objects.select_related("author").order_by("-updated_at"),
            to_attr="prefetched_latest_thread",
        )
        return Category.objects.prefetch_related(latest_thread_prefetch)

    def list(self, request, *args, **kwargs):
        """Cache category list"""
        # Try to get from cache first
        cached = get_cached_category_list()
        if cached is not None:
            return Response(cached)

        # Get from database and cache
        response = super().list(request, *args, **kwargs)
        cache_category_list(response.data)
        return response

    def retrieve(self, request, *args, **kwargs):
        """Cache category detail"""
        slug = kwargs.get(self.lookup_field)

        # Try to get from cache first
        cached = get_cached_category_detail(slug)
        if cached is not None:
            return Response(cached)

        # Get from database and cache
        response = super().retrieve(request, *args, **kwargs)
        cache_category_detail(slug, response.data)
        return response


class ThreadViewSet(ModelViewSet):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["category__slug", "author__username", "tags__slug"]
    search_fields = ["title", "content"]
    ordering_fields = ["created_at", "updated_at", "view_count"]

    def get_serializer_class(self):
        """Use lightweight serializer for list views, full serializer for detail"""
        if self.action == "list":
            return ThreadListSerializer
        return ThreadSerializer

    def get_throttles(self) -> list:
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [ForumWriteRateThrottle()]  # type: ignore
        return list(super().get_throttles())

    def get_queryset(self):
        """Optimize queryset based on action - avoid prefetching posts for list views"""
        queryset = Thread.objects.select_related(
            "author", "author__userprofile", "category"
        ).prefetch_related("tags")

        if self.request.user.is_authenticated:
            queryset = queryset.annotate(
                is_liked_by_user=Exists(
                    ThreadLike.objects.filter(thread=OuterRef("pk"), user=self.request.user)
                ),
            )

        if self.action != "list":
            queryset = queryset.prefetch_related("posts")

        return queryset

    def perform_create(self, serializer):
        thread = serializer.save(author=self.request.user)
        handle_mentions(self.request.user, thread, is_thread=True)
        invalidate_thread_list_cache(thread.category.slug)

    def perform_update(self, serializer):
        thread = serializer.save()
        invalidate_thread_caches(thread.id, thread.category.slug)

    def perform_destroy(self, instance):
        category_slug = instance.category.slug
        thread_id = instance.id
        super().perform_destroy(instance)
        invalidate_thread_caches(thread_id, category_slug)

    def list(self, request, *args, **kwargs):
        """Cache thread list with query parameters"""
        category_slug = request.query_params.get("category__slug")
        tag_slug = request.query_params.get("tags__slug")
        page = int(request.query_params.get("page", 1))
        ordering = request.query_params.get("ordering", "-updated_at")

        if request.query_params.get("search") or request.user.is_authenticated:
            return super().list(request, *args, **kwargs)

        # Try to get from cache first
        cached = get_cached_thread_list(category_slug, tag_slug, page, ordering)
        if cached is not None:
            return Response(cached)

        # Get from database and cache
        response = super().list(request, *args, **kwargs)
        cache_thread_list(response.data, category_slug, tag_slug, page, ordering)
        return response

    def retrieve(self, request, *args, **kwargs):
        """Cache thread detail and handle unique view counts"""
        thread_id = kwargs.get("pk")
        instance = self.get_object()

        if request.user.is_authenticated:
            viewer_id = f"user_{request.user.id}"
        else:
            ip = get_client_ip(request)
            viewer_id = f"ip_{hashlib.md5(ip.encode()).hexdigest()}"

        view_cache_key = f"forum:view:{thread_id}:{viewer_id}"
        if not cache.get(view_cache_key):
            cache.set(view_cache_key, True, timeout=3600)
            instance.increment_view_count()

        if request.user.is_authenticated:
            serializer = self.get_serializer(instance)
            return Response(serializer.data)

        cached = get_cached_thread_detail(thread_id)
        if cached is not None:
            return Response(cached)

        serializer = self.get_serializer(instance)
        cache_thread_detail(thread_id, serializer.data)
        return Response(serializer.data)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[permissions.IsAuthenticated],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def like(self, request, pk=None):
        """Idempotent like - creates like if not exists, returns current state if already liked."""
        thread = self.get_object()
        like, created = ThreadLike.objects.get_or_create(thread=thread, user=request.user)

        if not created:
            return Response(
                {
                    "status": "already_liked",
                    "like_count": thread.like_count,
                    "is_liked": True,
                },
                status=status.HTTP_200_OK,
            )

        if thread.author != request.user:
            NotificationService.create_forum_like_notification(
                user=thread.author, author=request.user, instance=thread, is_thread=True
            )

        thread.like_count += 1

        # Broadcast thread like to WebSocket subscribers
        _broadcast_to_thread(
            thread.id,
            {
                "type": "forum.thread_liked",
                "thread_id": thread.id,
                "like_count": thread.like_count,
            },
        )

        return Response(
            {
                "status": "liked",
                "like_count": thread.like_count,
                "is_liked": True,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[permissions.IsAdminUser],
        url_path="toggle_pin",
    )
    def toggle_pin(self, request, pk=None):
        """Toggle pin status of a thread. Staff only."""
        thread = self.get_object()
        thread.is_pinned = not thread.is_pinned
        thread.save(update_fields=["is_pinned"])
        invalidate_thread_caches(thread.id, thread.category.slug)
        invalidate_thread_list_cache(thread.category.slug)
        return Response(
            {
                "status": "pinned" if thread.is_pinned else "unpinned",
                "is_pinned": thread.is_pinned,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[permissions.IsAuthenticated],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def unlike(self, request, pk=None):
        """Explicit unlike action - removes like if exists."""
        thread = self.get_object()

        try:
            like = ThreadLike.objects.get(thread=thread, user=request.user)
            like.delete()
            thread.like_count -= 1

            # Broadcast thread unlike to WebSocket subscribers
            _broadcast_to_thread(
                thread.id,
                {
                    "type": "forum.thread_liked",
                    "thread_id": thread.id,
                    "like_count": thread.like_count,
                },
            )

            return Response(
                {
                    "status": "unliked",
                    "like_count": thread.like_count,
                    "is_liked": False,
                },
                status=status.HTTP_200_OK,
            )
        except ThreadLike.DoesNotExist:
            return Response(
                {
                    "status": "not_liked",
                    "like_count": thread.like_count,
                    "is_liked": False,
                },
                status=status.HTTP_200_OK,
            )


class PostViewSet(ModelViewSet):
    serializer_class = PostSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["thread__id"]
    ordering_fields = ["created_at"]

    def get_throttles(self) -> list:
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [ForumWriteRateThrottle()]  # type: ignore
        return list(super().get_throttles())

    def get_queryset(self):
        queryset = Post.objects.select_related("author", "author__userprofile", "thread").annotate(
            reply_count=Count("replies")
        )

        if self.request.user.is_authenticated:
            queryset = queryset.annotate(
                is_liked_by_user=Exists(
                    PostLike.objects.filter(post=OuterRef("pk"), user=self.request.user)
                )
            )

        return queryset

    def list(self, request, *args, **kwargs):
        """Cache post list for thread and handle threaded pagination"""
        thread_id = request.query_params.get("thread__id")
        page = int(request.query_params.get("page", 1))

        if thread_id and not request.user.is_authenticated:
            # Try to get from cache first
            cached = get_cached_post_list(thread_id, page)
            if cached is not None:
                return Response(cached)

        # Base queryset
        queryset = self.filter_queryset(self.get_queryset())

        if thread_id:
            top_level_queryset = queryset.filter(parent__isnull=True)

            page_obj = self.paginate_queryset(top_level_queryset)
            if page_obj is not None:
                # We have a page of top-level posts. Now fetch only their descendants
                # instead of loading ALL child posts for the entire thread.
                top_level_posts = list(page_obj)
                top_level_ids = [post.id for post in top_level_posts]

                # Iteratively collect descendant IDs up to max depth (10)
                # to avoid loading the entire thread's replies into memory.
                ancestor_ids = set(top_level_ids)
                all_descendant_ids = set()
                current_parent_ids = top_level_ids

                for _depth in range(10):
                    if not current_parent_ids:
                        break
                    child_ids = list(
                        queryset.filter(
                            parent_id__in=current_parent_ids, thread_id=thread_id
                        ).values_list("id", flat=True)
                    )
                    if not child_ids:
                        break
                    all_descendant_ids.update(child_ids)
                    current_parent_ids = child_ids

                # Fetch the actual descendant post objects in a single query
                if all_descendant_ids:
                    descendants = list(queryset.filter(id__in=all_descendant_ids))
                else:
                    descendants = []

                final_posts = top_level_posts + descendants

                final_posts.sort(key=lambda x: x.created_at)

                serializer = self.get_serializer(final_posts, many=True)
                response = self.get_paginated_response(serializer.data)

                if thread_id and not request.user.is_authenticated:
                    cache_post_list(thread_id, page, response.data)

                return response

        page_obj = self.paginate_queryset(queryset)
        if page_obj is not None:
            serializer = self.get_serializer(page_obj, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        post = serializer.save(author=self.request.user)
        # Update thread's updated_at timestamp when a new post is made
        thread = serializer.validated_data["thread"]
        thread.save(update_fields=["updated_at"])

        if post.parent:
            post.depth = min(post.parent.depth + 1, 10)  # Max 10 levels
            post.save(update_fields=["depth"])

        handle_mentions(self.request.user, post, is_thread=False)

        if not post.parent and thread.author != self.request.user:
            NotificationService.create_forum_reply_notification(
                user=thread.author, thread=thread, post=post
            )

        if post.parent and post.parent.author != self.request.user:
            NotificationService.create_forum_reply_to_post_notification(
                user=post.parent.author, reply=post
            )

        invalidate_post_list_cache(thread.id)
        invalidate_thread_caches(thread.id, thread.category.slug)

        # Broadcast new post to all WebSocket subscribers of this thread
        _broadcast_to_thread(
            thread.id,
            {
                "type": "forum.new_post",
                "post": {
                    "id": post.id,
                    "thread_id": thread.id,
                    "parent_id": post.parent_id,
                    "author": {
                        "id": post.author.id,
                        "username": post.author.username,
                    },
                    "content": post.content,
                    "depth": post.depth,
                    "like_count": 0,
                    "created_at": post.created_at.isoformat(),
                },
            },
        )

    def perform_update(self, serializer):
        post = serializer.save()
        invalidate_post_list_cache(post.thread_id)

    def perform_destroy(self, instance):
        thread_id = instance.thread_id
        thread = instance.thread
        super().perform_destroy(instance)
        invalidate_post_list_cache(thread_id)
        invalidate_thread_caches(thread.id, thread.category.slug)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[permissions.IsAuthenticated],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def like(self, request, pk=None):
        """Idempotent like - creates like if not exists, returns current state if already liked."""
        post = self.get_object()
        like, created = PostLike.objects.get_or_create(post=post, user=request.user)

        if not created:
            return Response(
                {
                    "status": "already_liked",
                    "like_count": post.like_count,
                    "is_liked": True,
                },
                status=status.HTTP_200_OK,
            )

        if post.author != request.user:
            NotificationService.create_forum_like_notification(
                user=post.author, author=request.user, instance=post, is_thread=False
            )

        # Update denormalized count inline — avoids extra count() query
        new_count = post.likes.count()
        post.like_count = new_count
        post.save(update_fields=["like_count"])

        # Broadcast like to WebSocket subscribers
        _broadcast_to_thread(
            post.thread_id,
            {
                "type": "forum.post_liked",
                "post_id": post.id,
                "like_count": new_count,
            },
        )

        return Response(
            {
                "status": "liked",
                "like_count": new_count,
                "is_liked": True,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[permissions.IsAuthenticated],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def unlike(self, request, pk=None):
        """Explicit unlike action - removes like if exists."""
        post = self.get_object()

        try:
            like = PostLike.objects.get(post=post, user=request.user)
            like.delete()
            # Update denormalized count inline — avoids extra count() query
            new_count = post.likes.count()
            post.like_count = new_count
            post.save(update_fields=["like_count"])

            # Broadcast unlike to WebSocket subscribers
            _broadcast_to_thread(
                post.thread_id,
                {
                    "type": "forum.post_liked",
                    "post_id": post.id,
                    "like_count": new_count,
                },
            )

            return Response(
                {
                    "status": "unliked",
                    "like_count": new_count,
                    "is_liked": False,
                },
                status=status.HTTP_200_OK,
            )
        except PostLike.DoesNotExist:
            return Response(
                {
                    "status": "not_liked",
                    "like_count": post.like_count,
                    "is_liked": False,
                },
                status=status.HTTP_200_OK,
            )
