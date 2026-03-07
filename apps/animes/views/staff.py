from rest_framework.viewsets import ReadOnlyModelViewSet
from django.db.models import Prefetch

from apps.animes.models import Staff, AnimeCharacter, AnimeStaff
from apps.animes.serializers import StaffDetailSerializer


class StaffViewSet(ReadOnlyModelViewSet):
    """
    Staff detail endpoint.  Only the retrieve (detail) action is meaningful;
    the list action is intentionally disabled.
    """

    queryset = Staff.objects.all()
    serializer_class = StaffDetailSerializer
    pagination_class = None

    def get_queryset(self):
        return Staff.objects.prefetch_related(
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
        )
