from django.contrib.auth import get_user_model
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.viewsets import ModelViewSet

from ..permissions import VerifiedEmailForWrites
from ..serializers.users import UserAnimeListSerializer
from ..services.list_service import (
    create_user_anime_list_entry,
    delete_user_anime_list_entry,
    get_user_anime_list_queryset,
    update_user_anime_list_entry,
)

User = get_user_model()

class UserAnimeListViewSet(ModelViewSet):
    serializer_class = UserAnimeListSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]

    def get_queryset(self):
        return get_user_anime_list_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
            list_status=self.request.query_params.get("status"),
        )

    def perform_create(self, serializer):
        create_user_anime_list_entry(serializer, self.request.user)

    def perform_update(self, serializer):
        update_user_anime_list_entry(serializer, self.request.user)

    def perform_destroy(self, instance):
        delete_user_anime_list_entry(instance, self.request.user)
