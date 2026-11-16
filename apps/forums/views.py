from django.core.cache import cache
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.fields import IntegerField
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.permissions import (
    SAFE_METHODS,
    AllowAny,
    BasePermission,
    IsAdminUser,
    IsAuthenticated,
    IsAuthenticatedOrReadOnly,
)
from rest_framework.response import Response
from rest_framework.serializers import Serializer
from rest_framework.throttling import BaseThrottle, UserRateThrottle
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from ..core.utils import get_client_ip
from ..shared.public_cache import get_or_build_public_payload
from ..users.permissions import VerifiedEmailForWrites
from ..users.throttling import ForumLikeRateThrottle, ForumWriteRateThrottle
from .cache_utils import (
    CACHEABLE_POST_LIST_PARAMS,
    CACHEABLE_POST_ORDERING,
    CACHEABLE_THREAD_LIST_PARAMS,
    CACHEABLE_THREAD_ORDERINGS,
    buffer_thread_view_increment,
    cache_category_detail,
    cache_category_list,
    cache_post_list,
    cache_tag_list,
    get_cached_category_detail,
    get_cached_category_list,
    get_cached_post_list,
    get_cached_tag_list,
    get_thread_detail_cache_key,
    get_thread_list_cache_key,
)
from .models import Tag, Thread
from .pagination import ForumPostPagination
from .serializers import (
    CategorySerializer,
    ModerationReasonSerializer,
    PostSerializer,
    TagSerializer,
    ThreadListSerializer,
    ThreadSerializer,
)
from .services import (
    build_category_queryset,
    build_post_queryset,
    build_thread_queryset,
    create_post,
    create_thread,
    delete_post,
    delete_thread,
    get_post_subtree,
    get_threaded_posts_page,
    moderation,
    subscriptions,
    toggle_post_like,
    toggle_thread_like,
    toggle_thread_pin,
    unlike_post,
    unlike_thread,
    update_post,
    update_thread,
)
from .services.interactions import hash_viewer_identifier


class CommunityActionRateThrottle(UserRateThrottle):
    """Thread subscriptions and staff moderation actions."""

    scope = "community_action"


class IsOwnerOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        return obj.author_id == request.user.id


class IsThreadOwnerOrStaffMover(IsOwnerOrReadOnly):
    """Staff may also update any thread (the serializer lets them change only its category)."""

    def has_object_permission(self, request, view, obj):
        if request.method in ("PUT", "PATCH") and request.user.is_staff:
            return True
        return super().has_object_permission(request, view, obj)


class ThreadListQuerySerializer(Serializer):
    page = IntegerField(required=False, default=1, min_value=1)


class PostListQuerySerializer(Serializer):
    page = IntegerField(required=False, default=1, min_value=1)
    thread__id = IntegerField(required=False, min_value=1)
    root = IntegerField(required=False, min_value=1)


def _moderation_reason(request) -> str:
    serializer = ModerationReasonSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data["reason"]


def _result_response(result) -> Response:
    return Response(result.payload, status=result.status_code)


_STAFF_ACTION = {
    "detail": True,
    "methods": ["post"],
    "permission_classes": [IsAdminUser],
    "throttle_classes": [CommunityActionRateThrottle],
}


class TagViewSet(ReadOnlyModelViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    permission_classes = [AllowAny]
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
    permission_classes = [AllowAny]
    serializer_class = CategorySerializer
    lookup_field = "slug"
    ordering_fields = ["order", "name"]
    ordering = ["order"]

    def get_queryset(self):
        return build_category_queryset()

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
    permission_classes = [
        IsAuthenticatedOrReadOnly,
        IsThreadOwnerOrStaffMover,
        VerifiedEmailForWrites,
    ]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["category__slug", "author__username", "tags__slug"]
    search_fields = ["title", "content"]
    ordering_fields = ["created_at", "updated_at", "view_count"]

    @staticmethod
    def _with_cache_status_header(response: Response, cache_status: str) -> Response:
        response["X-Cache-Status"] = cache_status
        return response

    def get_serializer_class(self):
        """Use lightweight serializer for list views, full serializer for detail"""
        if self.action == "list":
            return ThreadListSerializer
        return ThreadSerializer

    def get_throttles(self) -> list[BaseThrottle]:
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [ForumWriteRateThrottle()]
        return list(super().get_throttles())

    def get_queryset(self):
        # Removed threads stay out of every list; staff can still open them.
        user = self.request.user
        return build_thread_queryset(user, include_removed=user.is_staff and self.action != "list")

    def perform_create(self, serializer):
        create_thread(serializer, self.request.user)

    def perform_update(self, serializer):
        update_thread(serializer, request=self.request)

    def perform_destroy(self, instance):
        delete_thread(instance)

    def list(self, request, *args, **kwargs):
        """Cache thread list with query parameters"""
        category_slug = request.query_params.get("category__slug")
        tag_slug = request.query_params.get("tags__slug")
        query_serializer = ThreadListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        page = query_serializer.validated_data["page"]
        ordering = request.query_params.get("ordering", "-updated_at")

        # The shared cache key covers only these parameters; any other filter
        # (author, search, page_size, ...) would be served to everyone.
        cacheable = (
            not request.user.is_authenticated
            and set(request.query_params) <= CACHEABLE_THREAD_LIST_PARAMS
            and ordering in CACHEABLE_THREAD_ORDERINGS
        )
        if not cacheable:
            return super().list(request, *args, **kwargs)

        cache_key = get_thread_list_cache_key(category_slug, tag_slug, page, ordering)
        data, cache_status = get_or_build_public_payload(
            cache_key,
            lambda: super(ThreadViewSet, self).list(request, *args, **kwargs).data,
            ttl=300,
        )
        return self._with_cache_status_header(Response(data), cache_status)

    def retrieve(self, request, *args, **kwargs):
        """Cache thread detail and handle unique view counts"""
        instance = self.get_object()
        # The canonical id, not the URL's spelling ("01" and "1" are one thread).
        thread_id = instance.pk

        if request.user.is_authenticated:
            viewer_id = f"user_{request.user.id}"
        else:
            ip = get_client_ip(request)
            viewer_id = f"ip_{hash_viewer_identifier(ip)}"

        view_cache_key = f"forum:view:{thread_id}:{viewer_id}"
        if not cache.get(view_cache_key):
            cache.set(view_cache_key, True, timeout=3600)
            buffer_thread_view_increment(thread_id)

        if request.user.is_authenticated:
            serializer = self.get_serializer(instance)
            return Response(serializer.data)

        data, cache_status = get_or_build_public_payload(
            get_thread_detail_cache_key(thread_id),
            lambda: self.get_serializer(instance).data,
            ttl=300,
        )
        return self._with_cache_status_header(Response(data), cache_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, VerifiedEmailForWrites],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def like(self, request, pk=None):
        thread = self.get_object()
        result = toggle_thread_like(thread, request.user)
        return Response(result.payload, status=result.status_code)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAdminUser],
        url_path="toggle_pin",
    )
    def toggle_pin(self, request, pk=None):
        thread = self.get_object()
        result = toggle_thread_pin(thread)
        return Response(result.payload, status=result.status_code)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, VerifiedEmailForWrites],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def unlike(self, request, pk=None):
        thread = self.get_object()
        result = unlike_thread(thread, request.user)
        return Response(result.payload, status=result.status_code)

    @action(**_STAFF_ACTION, url_path="toggle_lock")
    def toggle_lock(self, request, pk=None):
        return _result_response(moderation.toggle_thread_lock(self.get_object(), request=request))

    @action(**_STAFF_ACTION)
    def remove(self, request, pk=None):
        thread = self.get_object()
        reason = _moderation_reason(request)
        return _result_response(moderation.remove_thread(thread, request=request, reason=reason))

    @action(**_STAFF_ACTION)
    def restore(self, request, pk=None):
        return _result_response(moderation.restore_thread(self.get_object(), request=request))

    @action(
        detail=True,
        methods=["post", "delete"],
        permission_classes=[IsAuthenticated],
        throttle_classes=[CommunityActionRateThrottle],
    )
    def subscription(self, request, pk=None):
        thread = self.get_object()
        if request.method == "DELETE":
            subscriptions.unsubscribe(request.user, thread)
            return Response({"is_subscribed": False})
        subscriptions.subscribe(request.user, thread)
        return Response({"is_subscribed": True})


class PostViewSet(ModelViewSet):
    serializer_class = PostSerializer
    pagination_class = ForumPostPagination
    permission_classes = [IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly, VerifiedEmailForWrites]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["thread__id"]
    ordering_fields = ["created_at"]
    ordering = [CACHEABLE_POST_ORDERING]

    def get_throttles(self) -> list[BaseThrottle]:
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [ForumWriteRateThrottle()]
        return list(super().get_throttles())

    def get_queryset(self):
        user = self.request.user
        return build_post_queryset(user, include_removed_threads=user.is_staff)

    def _ensure_thread_visible(self, thread_id: int) -> None:
        threads = Thread.objects.filter(pk=thread_id)
        if not self.request.user.is_staff:
            threads = threads.filter(is_removed=False)
        if not threads.exists():
            raise NotFound("Thread not found.")

    def list(self, request, *args, **kwargs):
        """A page of a thread's top-level posts with their replies, or one ``?root=`` subtree."""
        query_serializer = PostListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        thread_id = query_serializer.validated_data.get("thread__id")
        root_id = query_serializer.validated_data.get("root")
        page = query_serializer.validated_data["page"]
        if thread_id is None:
            if root_id is not None:
                raise ValidationError({"root": "root requires thread__id."})
            return super().list(request, *args, **kwargs)

        cacheable = (
            not request.user.is_authenticated
            and set(request.query_params) <= CACHEABLE_POST_LIST_PARAMS
            and request.query_params.get("ordering", CACHEABLE_POST_ORDERING)
            == CACHEABLE_POST_ORDERING
        )
        if cacheable:
            cached = get_cached_post_list(thread_id, page)
            if cached is not None:
                return Response(cached)

        self._ensure_thread_visible(thread_id)
        queryset = self.filter_queryset(self.get_queryset())

        if root_id is not None:
            root = get_object_or_404(queryset, pk=root_id)
            posts = get_post_subtree(queryset, thread_id, root)
            data = self.get_serializer(posts, many=True).data
            return Response({"count": 1, "next": None, "previous": None, "results": data})

        top_level_posts = self.paginate_queryset(queryset.filter(parent__isnull=True))
        posts = get_threaded_posts_page(queryset, thread_id, list(top_level_posts))
        response = self.get_paginated_response(self.get_serializer(posts, many=True).data)
        if cacheable:
            cache_post_list(thread_id, page, response.data)
        return response

    def perform_create(self, serializer):
        create_post(serializer, self.request.user)

    def perform_update(self, serializer):
        update_post(serializer)

    def perform_destroy(self, instance):
        delete_post(instance, actor=self.request.user)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, VerifiedEmailForWrites],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def like(self, request, pk=None):
        post = self.get_object()
        if post.is_removed:
            raise ValidationError({"post": "This reply was removed."})
        result = toggle_post_like(post, request.user)
        return Response(result.payload, status=result.status_code)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, VerifiedEmailForWrites],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def unlike(self, request, pk=None):
        post = self.get_object()
        result = unlike_post(post, request.user)
        return Response(result.payload, status=result.status_code)

    @action(**_STAFF_ACTION)
    def remove(self, request, pk=None):
        post = self.get_object()
        reason = _moderation_reason(request)
        return _result_response(moderation.remove_post(post, request=request, reason=reason))

    @action(**_STAFF_ACTION)
    def restore(self, request, pk=None):
        return _result_response(moderation.restore_post(self.get_object(), request=request))
