from django.db.models import Count, Exists, OuterRef, Prefetch
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.animes.models import AnimeCharacter, AnimeStaff, Staff, UserFavoriteStaff
from apps.animes.serializers import StaffDetailSerializer


class StaffViewSet(ReadOnlyModelViewSet):
    """Staff detail endpoint.  Only the retrieve (detail) action is meaningful;
    the list action is intentionally disabled.
    """

    serializer_class = StaffDetailSerializer
    pagination_class = None

    def get_queryset(self):
        queryset = Staff.objects.prefetch_related(
            Prefetch(
                "voice_roles",
                queryset=AnimeCharacter.objects.select_related("anime", "character").order_by(
                    "-anime__release_date"
                ),
            ),
            Prefetch(
                "production_credits",
                queryset=AnimeStaff.objects.select_related("anime").order_by(
                    "-anime__release_date"
                ),
            ),
        ).annotate(_favorite_count=Count("favorites", distinct=True))

        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                _is_favorite=Exists(
                    UserFavoriteStaff.objects.filter(user=user, staff=OuterRef("pk"))
                )
            )

        return queryset
