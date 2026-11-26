from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from ..permissions import VerifiedEmailForWrites
from ..serializers.lists import UserAnimeListArtworkSerializer, UserAnimeListSerializer
from ..services.list_service import (
    ListQueryError,
    delete_user_anime_list_entry,
    get_lists_summary,
    get_user_anime_list_queryset,
    update_user_anime_list_entry,
    upsert_user_anime_list_entry,
)

User = get_user_model()


class UserAnimeListViewSet(ModelViewSet):
    serializer_class = UserAnimeListSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]

    def get_serializer_class(self):
        # Home's "Continue watching" cards ask for banner art (?artwork=1);
        # every other list read keeps the lighter rows.
        if self.action == "list" and self.request.query_params.get("artwork") == "1":
            return UserAnimeListArtworkSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        params = self.request.query_params
        try:
            return get_user_anime_list_queryset(
                self.request.user,
                username=params.get("username"),
                list_status=params.get("status"),
                search=params.get("q"),
                ordering=params.get("ordering"),
            )
        except ListQueryError as exc:
            raise ValidationError({exc.field: exc.message}) from exc

    def create(self, request, *args, **kwargs):
        """Upsert: 201 for a new entry, 200 when the anime was already on the list."""
        serializer, created = upsert_user_anime_list_entry(
            self.get_serializer_class(),
            request.user,
            request.data,
            self.get_serializer_context(),
        )
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def perform_update(self, serializer):
        update_user_anime_list_entry(serializer, self.request.user)

    def perform_destroy(self, instance):
        delete_user_anime_list_entry(instance, self.request.user)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Counts per status, totals, score histogram and top genres in one cached payload."""
        return Response(get_lists_summary(request.user, request.query_params.get("username")))
