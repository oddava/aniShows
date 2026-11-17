from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db.models import Count, Prefetch
from django_filters import BooleanFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ViewSet

from ...animes.models import Review, UserFavorite
from ...users.admin_serializers import AdminUserSerializer
from ...users.models import UserAnimeList
from ..permissions import AdminPolicyMixin
from ..services.media import poster_url
from ..services.query_helpers import related_count
from ..services.user_admin_service import (
    AdminUserActionError,
    delete_user_account,
    moderation_history,
    restore_user,
    set_user_staff,
    suspend_user,
)

User = get_user_model()


class UserFilter(FilterSet):
    is_staff = BooleanFilter(field_name="is_staff")
    is_active = BooleanFilter(field_name="is_active")

    class Meta:
        model = User
        fields = ["is_staff", "is_active"]


class AdminUserViewSet(
    AdminPolicyMixin,
    ListModelMixin,
    RetrieveModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    """User management: staff read, suspend and restore; superusers also promote and delete."""

    serializer_class = AdminUserSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = UserFilter
    search_fields = ["username", "email"]
    ordering_fields = ["date_joined", "username", "email"]
    ordering = ["-date_joined"]

    def get_queryset(self):
        google_accounts = SocialAccount.objects.filter(provider="google").only(
            "user_id", "provider", "extra_data"
        )
        return (
            User.objects.select_related("userprofile")
            .prefetch_related(
                Prefetch(
                    "socialaccount_set",
                    queryset=google_accounts,
                    to_attr="_prefetched_social_accounts",
                )
            )
            .annotate(
                _favorites_count=related_count(UserFavorite, "user"),
                _reviews_count=related_count(Review, "user"),
                _list_entries_count=related_count(UserAnimeList, "user"),
            )
        )

    def retrieve(self, request, *args, **kwargs):
        user = self.get_object()
        data = self.get_serializer(user).data
        data["moderation_history"] = moderation_history(user.pk)
        return Response(data)

    def _run(self, operation, *args):
        try:
            result = operation(*args)
        except AdminUserActionError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response(result.payload, status=result.status_code)

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        """Deactivate the account and end all of its sessions. Requires a reason."""
        return self._run(suspend_user, request, self.get_object(), request.data.get("reason"))

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        """Reactivate a suspended account. Requires a reason."""
        return self._run(restore_user, request, self.get_object(), request.data.get("reason"))

    @action(detail=True, methods=["post"])
    def toggle_staff(self, request, pk=None):
        """Set staff status explicitly: ``{"is_staff": true|false}``."""
        return self._run(set_user_staff, request, self.get_object(), request.data.get("is_staff"))

    def destroy(self, request, *args, **kwargs):
        return self._run(delete_user_account, request, self.get_object())


class AdminFavoritesStatsViewSet(AdminPolicyMixin, ViewSet):
    """Favorites statistics for the Analytics page."""

    @action(detail=False, methods=["get"])
    def stats(self, request):
        base_qs = UserFavorite.objects.all()
        top_anime = (
            base_qs.values(
                "anime_id",
                "anime__title",
                "anime__slug",
                "anime__cover_image",
                "anime__cover_image_external_url",
            )
            .annotate(favorite_count=Count("id"))
            .order_by("-favorite_count")[:6]
        )

        serialized_top = []
        for item in top_anime:
            poster = poster_url(item["anime__cover_image"], item["anime__cover_image_external_url"])
            serialized_top.append(
                {
                    "id": item["anime_id"],
                    "title": item["anime__title"],
                    "slug": item["anime__slug"],
                    "favorite_count": item["favorite_count"],
                    "poster": poster,
                    "poster_small": poster,
                }
            )

        totals = base_qs.aggregate(
            total_favorites=Count("id"),
            unique_users=Count("user_id", distinct=True),
            unique_anime=Count("anime_id", distinct=True),
        )
        return Response({**totals, "top_anime": serialized_top})
