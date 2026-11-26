from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db.models import Count, Prefetch
from django.http import HttpResponse
from django.utils import timezone
from django_filters import BooleanFilter, DateFilter, FilterSet, IsoDateTimeFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ViewSet

from ...animes.models import Review, UserFavorite
from ...core.models import AuditLog
from ...users.admin_serializers import AdminUserSerializer
from ...users.models import UserAnimeList
from ..permissions import AdminPolicyMixin
from ..services.audit import record_admin_action
from ..services.media import poster_url
from ..services.query_helpers import related_count
from ..services.user_admin_service import (
    AdminUserActionError,
    clear_user_profile,
    delete_user_account,
    moderation_history,
    restore_user,
    revoke_user_sessions,
    send_user_password_reset,
    set_user_staff,
    suspend_user,
    verify_user_email,
)
from ..services.user_detail_service import user_detail_extras, users_csv

User = get_user_model()


class UserFilter(FilterSet):
    is_staff = BooleanFilter(field_name="is_staff")
    is_active = BooleanFilter(field_name="is_active")
    is_superuser = BooleanFilter(field_name="is_superuser")
    email_verified = BooleanFilter(field_name="userprofile__email_verified")
    joined_after = DateFilter(field_name="date_joined", lookup_expr="date__gte")
    joined_before = DateFilter(field_name="date_joined", lookup_expr="date__lte")
    # An exact moment with its offset ("2026-11-26T00:00:00+05:00"): the admin's
    # local day, which UTC dates cannot express.
    joined_since = IsoDateTimeFilter(field_name="date_joined", lookup_expr="gte")

    class Meta:
        model = User
        fields = [
            "is_staff",
            "is_active",
            "is_superuser",
            "email_verified",
            "joined_after",
            "joined_before",
            "joined_since",
        ]


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
    ordering_fields = ["date_joined", "username", "email", "last_login"]
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
        data.update(user_detail_extras(user))
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

    @action(detail=True, methods=["post"])
    def revoke_sessions(self, request, pk=None):
        """End every session of the account (all devices sign out)."""
        return self._run(revoke_user_sessions, request, self.get_object())

    @action(detail=True, methods=["post"])
    def verify_email(self, request, pk=None):
        """Mark the account's email as verified (superuser)."""
        return self._run(verify_user_email, request, self.get_object())

    @action(detail=True, methods=["post"])
    def send_password_reset(self, request, pk=None):
        """Email the account the standard password reset link."""
        return self._run(send_user_password_reset, request, self.get_object())

    @action(detail=True, methods=["post"])
    def clear_profile(self, request, pk=None):
        """Clear ``fields`` (bio, avatar, banner) with a reason."""
        return self._run(
            clear_user_profile,
            request,
            self.get_object(),
            request.data.get("fields"),
            request.data.get("reason"),
        )

    @action(detail=False, methods=["get"])
    def export(self, request):
        """The filtered list as CSV (superuser: it holds emails). At most 10,000 rows."""
        queryset = self.filter_queryset(self.get_queryset()).prefetch_related(None)
        content, rows = users_csv(queryset)
        record_admin_action(
            request,
            action=AuditLog.ActionType.EXPORT,
            entity_type="User",
            entity_repr=f"Export {rows} users",
            metadata={"rows": rows, "filters": dict(request.query_params.items())},
        )
        response = HttpResponse(content, content_type="text/csv; charset=utf-8")
        stamp = timezone.now().strftime("%Y%m%d-%H%M")
        response["Content-Disposition"] = f'attachment; filename="users-{stamp}.csv"'
        return response

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
