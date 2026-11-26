"""Members' list imports (MAL, AniList): staff read them to help with failed imports."""

from __future__ import annotations

from django_filters import CharFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.fields import SerializerMethodField
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.serializers import ModelSerializer
from rest_framework.viewsets import GenericViewSet

from ...users.models import UserImportJob
from ..permissions import AdminPolicyMixin

DETAIL_ITEMS_LIMIT = 50


class AdminUserImportSerializer(ModelSerializer):
    user = SerializerMethodField()

    class Meta:
        model = UserImportJob
        fields = [
            "id",
            "user",
            "source",
            "mode",
            "status",
            "total_entries",
            "processed_entries",
            "imported_entries",
            "skipped_entries",
            "failed_entries",
            "failure_reason",
            "created_at",
            "started_at",
            "completed_at",
        ]

    def get_user(self, obj):
        return {"id": obj.user_id, "username": obj.user.username}


class AdminUserImportDetailSerializer(AdminUserImportSerializer):
    # A field named like Serializer.errors: DRF's metaclass moves declared
    # fields off the class, so the property is untouched at runtime.
    errors = SerializerMethodField()  # type: ignore[assignment]
    unmatched = SerializerMethodField()

    class Meta(AdminUserImportSerializer.Meta):
        fields = [*AdminUserImportSerializer.Meta.fields, "errors", "unmatched"]

    def get_errors(self, obj):
        return list(obj.errors or [])[:DETAIL_ITEMS_LIMIT]

    def get_unmatched(self, obj):
        return list(obj.unmatched or [])[:DETAIL_ITEMS_LIMIT]


class UserImportFilter(FilterSet):
    status = CharFilter(field_name="status")
    source = CharFilter(field_name="source")
    user = NumberFilter(field_name="user_id")

    class Meta:
        model = UserImportJob
        fields = ["status", "source", "user"]


class AdminUserImportViewSet(AdminPolicyMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = UserImportFilter
    search_fields = ["user__username", "source_identifier"]
    ordering_fields = ["created_at", "completed_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        queryset = UserImportJob.objects.select_related("user")
        if self.action == "list":
            # The JSON columns can be large; the list never shows them.
            queryset = queryset.defer("errors", "unmatched", "payload")
        return queryset.defer("payload") if self.action != "list" else queryset

    def get_serializer_class(self):
        if self.action == "list":
            return AdminUserImportSerializer
        return AdminUserImportDetailSerializer
