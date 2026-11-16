"""Moderation queue endpoints (G6 P1-1): staff resolve, dismiss or remove reported content."""

from django.db import transaction
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from ...core.models import AuditLog
from ..permissions import AdminPolicyMixin
from ..services.audit import record_admin_action
from ..services.moderation_service import (
    OUTCOME_DISMISS,
    ModerationError,
    forum_moderation,
    moderation_summary,
    parse_queue_filters,
    reported_reviews_queryset,
    resolve_review,
    serialize_reported_page,
    serialize_signal_page,
    signal_reviews_queryset,
)


def _error(exc: ModerationError) -> Response:
    return Response({"detail": exc.message}, status=exc.status_code)


class AdminModerationReviewViewSet(AdminPolicyMixin, GenericViewSet):
    """``moderation/reviews/``: the review report queue and its resolve action."""

    def list(self, request):
        try:
            filters = parse_queue_filters(request.query_params)
        except ModerationError as exc:
            return _error(exc)

        if filters.signals:
            page = self.paginate_queryset(signal_reviews_queryset(filters))
            rows = serialize_signal_page(page or [], filters)
        else:
            page = self.paginate_queryset(reported_reviews_queryset(filters))
            rows = serialize_reported_page(page or [], filters)
        return self.get_paginated_response(rows)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        try:
            payload = resolve_review(
                request, pk, request.data.get("outcome"), request.data.get("notes")
            )
        except ModerationError as exc:
            return _error(exc)
        return Response(payload)


class AdminModerationForumViewSet(AdminPolicyMixin, GenericViewSet):
    """``moderation/forums/``: forum reports, delegated to G5's module once it exists."""

    def _module_or_404(self):
        module = forum_moderation()
        if module is None:
            return None, Response(
                {"detail": "Forum moderation is not available."}, status=status.HTTP_404_NOT_FOUND
            )
        return module, None

    def list(self, request):
        module, missing = self._module_or_404()
        if missing is not None:
            return missing
        try:
            page = max(int(request.query_params.get("page", 1)), 1)
        except (TypeError, ValueError):
            return Response({"detail": "page must be an integer."}, status=400)
        rows, count = module.list_open_reports(page, request.query_params.get("reason") or None)
        return Response({"count": count, "results": rows, "page": page})

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        module, missing = self._module_or_404()
        if missing is not None:
            return missing
        outcome = request.data.get("outcome")
        notes = request.data.get("notes") or ""
        if not isinstance(notes, str) or len(notes) > 1000:
            return Response({"detail": "notes must be a string of at most 1000 characters."}, 400)
        try:
            with transaction.atomic():
                result = module.resolve_reports(pk, outcome, request.user, notes.strip())
                self._audit(request, pk, outcome, notes.strip())
        except ValueError:
            return Response({"detail": "Invalid outcome."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result if isinstance(result, dict) else {"outcome": outcome})

    @staticmethod
    def _audit(request, pk, outcome, notes):
        record_admin_action(
            request,
            action=(
                AuditLog.ActionType.DISMISS
                if outcome == OUTCOME_DISMISS
                else AuditLog.ActionType.RESOLVE
            ),
            entity_type="ForumPost",
            entity_id=pk,
            entity_repr=f"Forum report {outcome}",
            metadata={"outcome": outcome, "notes": notes},
        )


class AdminModerationSummaryView(AdminPolicyMixin, APIView):
    """Open report counts for the nav badge."""

    def get(self, request):
        return Response(moderation_summary())
