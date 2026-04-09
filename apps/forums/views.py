from django.core.cache import cache
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.decorators import action
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
from rest_framework.throttling import BaseThrottle
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from ..core.utils import get_client_ip
from ..shared.public_cache import get_or_build_public_payload
from ..users.throttling import ForumLikeRateThrottle, ForumWriteRateThrottle
from .cache_utils import (
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
from .models import Tag
from .serializers import (
    CategorySerializer,
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
    get_threaded_posts_page,
    toggle_post_like,
    toggle_thread_like,
    toggle_thread_pin,
    unlike_post,
    unlike_thread,
    update_post,
    update_thread,
)
from .services.interactions import hash_viewer_identifier


class IsOwnerOrReadOnly(BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        return obj.author == request.user


class ThreadListQuerySerializer(Serializer):
    page = IntegerField(required=False, default=1, min_value=1)


class PostListQuerySerializer(Serializer):
    page = IntegerField(required=False, default=1, min_value=1)

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
    permission_classes = [IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
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
        return build_thread_queryset(self.request.user)

    def perform_create(self, serializer):
        create_thread(serializer, self.request.user)

    def perform_update(self, serializer):
        update_thread(serializer)

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

        if request.query_params.get("search") or request.user.is_authenticated:
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
        thread_id = kwargs.get("pk")
        instance = self.get_object()

        if request.user.is_authenticated:
            viewer_id = f"user_{request.user.id}"
        else:
            ip = get_client_ip(request)
            viewer_id = f"ip_{hash_viewer_identifier(ip)}"

        view_cache_key = f"forum:view:{thread_id}:{viewer_id}"
        if not cache.get(view_cache_key):
            cache.set(view_cache_key, True, timeout=3600)
            buffer_thread_view_increment(int(thread_id))

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
        permission_classes=[IsAuthenticated],
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
        permission_classes=[IsAuthenticated],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def unlike(self, request, pk=None):
        thread = self.get_object()
        result = unlike_thread(thread, request.user)
        return Response(result.payload, status=result.status_code)


class PostViewSet(ModelViewSet):
    serializer_class = PostSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["thread__id"]
    ordering_fields = ["created_at"]

    def get_throttles(self) -> list[BaseThrottle]:
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [ForumWriteRateThrottle()]
        return list(super().get_throttles())

    def get_queryset(self):
        return build_post_queryset(self.request.user)

    def list(self, request, *args, **kwargs):
        """Cache post list for thread and handle threaded pagination"""
        thread_id = request.query_params.get("thread__id")
        query_serializer = PostListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        page = query_serializer.validated_data["page"]

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
                final_posts = get_threaded_posts_page(queryset, thread_id, list(page_obj))

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
        create_post(serializer, self.request.user)

    def perform_update(self, serializer):
        update_post(serializer)

    def perform_destroy(self, instance):
        delete_post(instance)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def like(self, request, pk=None):
        post = self.get_object()
        result = toggle_post_like(post, request.user)
        return Response(result.payload, status=result.status_code)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated],
        throttle_classes=[ForumLikeRateThrottle],
    )
    def unlike(self, request, pk=None):
        post = self.get_object()
        result = unlike_post(post, request.user)
        return Response(result.payload, status=result.status_code)
