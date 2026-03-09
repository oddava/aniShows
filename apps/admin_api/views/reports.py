from datetime import timedelta

from django.db.models import Count
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.animes.models import Anime, Review
from apps.core.permissions import IsAdminUser
from apps.users.models import UserProfile


class AdminReportsView(APIView):
    """Generate various admin reports."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        report_type = request.query_params.get("type", "overview")
        days = int(request.query_params.get("days", 30))
        start_date = timezone.now() - timedelta(days=days)

        if report_type == "content_quality":
            return self._generate_content_quality_report()
        elif report_type == "user_engagement":
            return self._generate_user_engagement_report(start_date)
        else:
            return Response(
                {"detail": f"Unknown report type: {report_type}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def _generate_content_quality_report(self):
        """Report on content quality (missing descriptions, covers, etc.)."""
        missing_descriptions = Anime.objects.filter(description="").count()
        missing_covers = Anime.objects.filter(cover_image="").count()
        no_genres = Anime.objects.annotate(genre_count=Count("genres")).filter(genre_count=0).count()
        no_studios = Anime.objects.filter(studio__isnull=True).count()

        return Response(
            {
                "report_type": "content_quality",
                "metrics": {
                    "missing_descriptions": missing_descriptions,
                    "missing_covers": missing_covers,
                    "no_genres": no_genres,
                    "no_studios": no_studios,
                },
            }
        )

    def _generate_user_engagement_report(self, start_date):
        """Report on user engagement metrics."""
        active_users_period = UserProfile.objects.filter(last_activity__gte=start_date).count()
        new_reviews_period = Review.objects.filter(created_at__gte=start_date).count()

        return Response(
            {
                "report_type": "user_engagement",
                "period_days": (timezone.now() - start_date).days,
                "metrics": {
                    "active_users": active_users_period,
                    "new_reviews": new_reviews_period,
                },
            }
        )


class AdminBulkOperationsView(APIView):
    """Execute bulk operations on resources."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        operation = request.data.get("operation")
        entity_type = request.data.get("entity_type")
        entity_ids = request.data.get("entity_ids", [])

        if not operation or not entity_type or not entity_ids:
            return Response(
                {"detail": "operation, entity_type, and entity_ids are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(entity_ids, list):
            return Response(
                {"detail": "entity_ids must be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Dispatch to handlers
        if entity_type == "anime":
            return self._handle_anime_bulk(operation, entity_ids, request.data)
        elif entity_type == "review":
            return self._handle_review_bulk(operation, entity_ids)
        elif entity_type == "user":
            return self._handle_user_bulk(operation, entity_ids, request.user)
        else:
            return Response(
                {"detail": f"Unsupported entity_type: {entity_type}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def _handle_anime_bulk(self, operation, ids, data):
        if operation == "update_status":
            new_status = data.get("status")
            if not new_status:
                return Response(
                    {"detail": "status field required for update_status operation."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            updated_count = Anime.objects.filter(id__in=ids).update(status=new_status)
            return Response(
                {"message": f"Updated status to {new_status} for {updated_count} anime."}
            )

        elif operation == "delete":
            deleted_count, _ = Anime.objects.filter(id__in=ids).delete()
            return Response({"message": f"Deleted {deleted_count} anime."})

        return Response(
            {"detail": f"Unsupported anime operation: {operation}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _handle_review_bulk(self, operation, ids):
        if operation == "delete":
            deleted_count, _ = Review.objects.filter(id__in=ids).delete()
            return Response({"message": f"Deleted {deleted_count} reviews."})
        elif operation == "toggle_spoiler":
            reviews = Review.objects.filter(id__in=ids)
            updated = 0
            for r in reviews:
                r.has_spoilers = not r.has_spoilers
                r.save(update_fields=["has_spoilers"])
                updated += 1
            return Response({"message": f"Toggled spoiler status for {updated} reviews."})

        return Response(
            {"detail": f"Unsupported review operation: {operation}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _handle_user_bulk(self, operation, ids, request_user):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        # Prevent actions on self or superusers
        users = User.objects.filter(id__in=ids).exclude(id=request_user.id).exclude(is_superuser=True)
        count = users.count()

        if count == 0:
            return Response({"message": "No valid users selected for operation."})

        if operation == "ban":
            users.update(is_active=False)
            return Response({"message": f"Banned {count} users."})
        elif operation == "unban":
            users.update(is_active=True)
            return Response({"message": f"Unbanned {count} users."})

        return Response(
            {"detail": f"Unsupported user operation: {operation}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
