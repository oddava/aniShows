from dataclasses import dataclass
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from apps.animes.models import Anime, Review
from apps.users.models import UserProfile


class ReportError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class ReportResult:
    payload: dict
    status_code: int


def generate_report(report_type: str, days: int) -> ReportResult:
    start_date = timezone.now() - timedelta(days=days)

    if report_type == "content_quality":
        return ReportResult(payload=_content_quality_payload(), status_code=200)

    if report_type == "user_engagement":
        return ReportResult(payload=_user_engagement_payload(start_date), status_code=200)

    raise ReportError(f"Unknown report type: {report_type}", 400)


def _content_quality_payload() -> dict:
    missing_descriptions = Anime.objects.filter(description="").count()
    missing_covers = Anime.objects.filter(cover_image="").count()
    no_genres = Anime.objects.annotate(genre_count=Count("genres")).filter(genre_count=0).count()
    no_studios = Anime.objects.filter(studio__isnull=True).count()

    return {
        "report_type": "content_quality",
        "metrics": {
            "missing_descriptions": missing_descriptions,
            "missing_covers": missing_covers,
            "no_genres": no_genres,
            "no_studios": no_studios,
        },
    }


def _user_engagement_payload(start_date) -> dict:
    active_users_period = UserProfile.objects.filter(last_activity__gte=start_date).count()
    new_reviews_period = Review.objects.filter(created_at__gte=start_date).count()

    return {
        "report_type": "user_engagement",
        "period_days": (timezone.now() - start_date).days,
        "metrics": {
            "active_users": active_users_period,
            "new_reviews": new_reviews_period,
        },
    }
