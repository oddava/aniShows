from django.db.models import Count, Exists, OuterRef, Prefetch
from rest_framework.viewsets import ReadOnlyModelViewSet

from ..models import AnimeCharacter, Character, UserFavoriteCharacter
from ..serializers import CharacterDetailSerializer


class CharacterViewSet(ReadOnlyModelViewSet):
    """Character detail endpoint."""

    serializer_class = CharacterDetailSerializer
    pagination_class = None

    def get_queryset(self):
        queryset = Character.objects.prefetch_related(
            Prefetch(
                "roles",
                queryset=AnimeCharacter.objects.select_related("anime", "voice_actor").order_by(
                    "-anime__release_date", "id"
                ),
            )
        ).annotate(_favorite_count=Count("favorites", distinct=True))

        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                _is_favorite=Exists(
                    UserFavoriteCharacter.objects.filter(user=user, character=OuterRef("pk"))
                )
            )

        return queryset
