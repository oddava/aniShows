from dataclasses import dataclass
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Avg, Count, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from apps.animes.models import Anime, Genre, Review, ReviewVote, Studio, UserFavorite
from apps.core.models import AuditLog
from apps.shared.logger import logger
from apps.users.models import UserAnimeList, UserProfile

User = get_user_model()
REPORT_CACHE_PREFIX = "admin:reports:v2"
REPORT_CACHE_TIMEOUT_SECONDS = 300


class ReportError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class ReportResult:
    payload: dict
    status_code: int


def _percent_change(current: int | float, previous: int | float) -> float:
    if previous == 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 2)


def _period_bounds(days: int):
    now = timezone.now()
    start = now - timedelta(days=days)
    prev_start = start - timedelta(days=days)
    return now, start, prev_start


def generate_report(report_type: str, days: int, force_refresh: bool = False) -> ReportResult:
    try:
        normalized_days = max(1, int(days))
    except (TypeError, ValueError):
        raise ReportError("days must be a valid integer.", 400)

    allowed_report_types = {"overview", "users", "content", "engagement"}
    if report_type not in allowed_report_types:
        raise ReportError(f"Unknown report type: {report_type}", 400)

    cache_key = f"{REPORT_CACHE_PREFIX}:{report_type}:{normalized_days}"
    if not force_refresh:
        cached = cache.get(cache_key)
        if isinstance(cached, dict):
            return ReportResult(payload=cached, status_code=200)

    try:
        if report_type == "overview":
            payload = _overview_payload(normalized_days)
        elif report_type == "users":
            payload = _users_payload(normalized_days)
        elif report_type == "content":
            payload = _content_payload(normalized_days)
        else:
            payload = _engagement_payload(normalized_days)
    except Exception as exc:
        logger.exception(
            "Failed to generate admin report",
            extra={"report_type": report_type, "days": normalized_days},
        )
        raise ReportError("Failed to generate report data.", 500) from exc

    cache.set(cache_key, payload, timeout=REPORT_CACHE_TIMEOUT_SECONDS)
    return ReportResult(payload=payload, status_code=200)


def _overview_payload(days: int) -> dict:
    now, start, prev_start = _period_bounds(days)
    user_queryset = User.objects.all()
    profile_queryset = UserProfile.objects.all()
    anime_queryset = Anime.objects.all()
    favorite_queryset = UserFavorite.objects.all()
    review_queryset = Review.objects.all()
    watchlist_queryset = UserAnimeList.objects.all()
    studio_queryset = Studio.objects.all()
    genre_queryset = Genre.objects.all()
    activity_log_queryset = AuditLog.objects.select_related("user")

    user_counts = user_queryset.aggregate(
        total_users=Count("id"),
        users_before_period=Count("id", filter=Q(date_joined__lt=start)),
        new_users=Count("id", filter=Q(date_joined__gte=start)),
        prev_new_users=Count(
            "id",
            filter=Q(date_joined__gte=prev_start, date_joined__lt=start),
        ),
    )
    profile_counts = profile_queryset.aggregate(
        active_users=Count("id", filter=Q(last_activity__gte=start)),
        prev_active_users=Count(
            "id",
            filter=Q(last_activity__gte=prev_start, last_activity__lt=start),
        ),
        returning_users=Count(
            "id",
            filter=Q(last_activity__gte=start, user__date_joined__lt=start),
        ),
        prev_returning_users=Count(
            "id",
            filter=Q(
                last_activity__gte=prev_start,
                last_activity__lt=start,
                user__date_joined__lt=prev_start,
            ),
        ),
    )

    total_users = user_counts["total_users"]
    users_before_period = user_counts["users_before_period"]
    new_users = user_counts["new_users"]
    prev_new_users = user_counts["prev_new_users"]

    active_users = profile_counts["active_users"]
    prev_active_users = profile_counts["prev_active_users"]
    returning_users = profile_counts["returning_users"]
    retention = round((returning_users / active_users) * 100, 2) if active_users else 0.0

    prev_returning_users = profile_counts["prev_returning_users"]
    prev_retention = (
        round((prev_returning_users / prev_active_users) * 100, 2) if prev_active_users else 0.0
    )

    anime_totals = anime_queryset.aggregate(
        anime_total=Count("id"),
        episodes_total=Coalesce(Sum("episode_count"), Value(0)),
    )
    anime_total = anime_totals["anime_total"]
    episodes_total = anime_totals["episodes_total"]

    favorite_counts = favorite_queryset.aggregate(
        favorites=Count("id"),
        prev_favorites=Count("id", filter=Q(added_at__lt=start)),
        favorites_in_period=Count("id", filter=Q(added_at__gte=start)),
        prev_favorites_in_period=Count(
            "id",
            filter=Q(added_at__gte=prev_start, added_at__lt=start),
        ),
    )
    favorites = favorite_counts["favorites"]
    prev_favorites = favorite_counts["prev_favorites"]
    favorites_in_period = favorite_counts["favorites_in_period"]
    prev_favorites_in_period = favorite_counts["prev_favorites_in_period"]

    review_counts = review_queryset.aggregate(
        reviews=Count("id"),
        reviews_in_period=Count("id", filter=Q(created_at__gte=start)),
        prev_reviews_in_period=Count(
            "id",
            filter=Q(created_at__gte=prev_start, created_at__lt=start),
        ),
        avg_rating=Avg("rating"),
    )
    reviews = review_counts["reviews"]
    reviews_in_period = review_counts["reviews_in_period"]
    prev_reviews_in_period = review_counts["prev_reviews_in_period"]
    avg_rating = review_counts["avg_rating"] or 0.0

    watchlist_counts = watchlist_queryset.aggregate(
        watchlists=Count("id"),
        watchlists_in_period=Count("id", filter=Q(updated_at__gte=start)),
        prev_watchlists_in_period=Count(
            "id",
            filter=Q(updated_at__gte=prev_start, updated_at__lt=start),
        ),
    )
    watchlists = watchlist_counts["watchlists"]
    watchlists_in_period = watchlist_counts["watchlists_in_period"]
    prev_watchlists_in_period = watchlist_counts["prev_watchlists_in_period"]

    growth_by_day = list(
        user_queryset.filter(date_joined__gte=start)
        .annotate(date=TruncDate("date_joined"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )

    last_7_days = now - timedelta(days=min(days, 7))
    daily_signups = list(
        user_queryset.filter(date_joined__gte=last_7_days)
        .annotate(date=TruncDate("date_joined"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )

    activity_logs = activity_log_queryset.order_by("-timestamp")[:20]
    recent_activity = [
        {
            "type": log.action,
            "text": (
                f"{log.user.username if log.user else 'System'} "
                f"{log.action.lower()} "
                f"{log.entity_type}"
                f"{f' #{log.entity_id}' if log.entity_id else ''}"
            ),
            "time": log.timestamp.isoformat(),
        }
        for log in activity_logs
    ]

    return {
        "users": {
            "total": total_users,
            "growth": _percent_change(new_users, users_before_period),
            "new": new_users,
            "new_growth": _percent_change(new_users, prev_new_users),
            "active": active_users,
            "active_growth": _percent_change(active_users, prev_active_users),
            "retention": retention,
            "retention_change": round(retention - prev_retention, 2),
            "growth_by_day": growth_by_day,
            "daily_signups": daily_signups,
        },
        "content": {
            "anime_total": anime_total,
            "episodes_total": episodes_total,
            "studios_total": studio_queryset.count(),
            "genres_total": genre_queryset.count(),
        },
        "engagement": {
            "favorites": favorites,
            "favorites_growth": _percent_change(favorites_in_period, prev_favorites_in_period),
            "reviews": reviews,
            "reviews_growth": _percent_change(reviews_in_period, prev_reviews_in_period),
            "watchlists": watchlists,
            "watchlists_growth": _percent_change(watchlists_in_period, prev_watchlists_in_period),
            "avg_rating": round(float(avg_rating), 2),
            "total_favorites_before_period": prev_favorites,
        },
        "recent_activity": recent_activity,
    }


def _users_payload(days: int) -> dict:
    now, start, prev_start = _period_bounds(days)
    user_queryset = User.objects.all()
    profile_queryset = UserProfile.objects.all()

    user_counts = user_queryset.aggregate(
        total_users=Count("id"),
        new_users=Count("id", filter=Q(date_joined__gte=start)),
        active=Count("id", filter=Q(is_active=True)),
        inactive=Count("id", filter=Q(is_active=False)),
        staff=Count("id", filter=Q(is_staff=True)),
    )
    profile_counts = profile_queryset.aggregate(
        returning_users=Count(
            "id",
            filter=Q(last_activity__gte=start, user__date_joined__lt=start),
        ),
        active_users_count=Count("id", filter=Q(last_activity__gte=start)),
        verified=Count("id", filter=Q(email_verified=True)),
        unverified=Count("id", filter=Q(email_verified=False)),
    )

    total_users = user_counts["total_users"]
    new_users = user_counts["new_users"]
    returning_users = profile_counts["returning_users"]
    active_users_count = profile_counts["active_users_count"]

    user_breakdown = {
        "active": user_counts["active"],
        "inactive": user_counts["inactive"],
        "verified": profile_counts["verified"],
        "unverified": profile_counts["unverified"],
        "staff": user_counts["staff"],
    }

    registration_trend = list(
        user_queryset.filter(date_joined__gte=start)
        .annotate(date=TruncDate("date_joined"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )

    active_users = list(
        user_queryset.annotate(
            activity_list_entries=Count("anime_lists", distinct=True),
            activity_reviews=Count("reviews", distinct=True),
            activity_favorites=Count("favorites", distinct=True),
            actions=Count("anime_lists", distinct=True)
            + Count("reviews", distinct=True)
            + Count("favorites", distinct=True),
        )
        .filter(actions__gt=0)
        .order_by("-actions", "-date_joined")
        .values(
            "id",
            "username",
            "activity_list_entries",
            "activity_reviews",
            "activity_favorites",
        )[:10]
    )

    active_users = [
        {
            "id": item["id"],
            "username": item["username"],
            "list_entries": item["activity_list_entries"],
            "reviews": item["activity_reviews"],
            "favorites": item["activity_favorites"],
        }
        for item in active_users
    ]

    return {
        "period_days": (now - start).days,
        "previous_period_start": prev_start.date().isoformat(),
        "total_users": total_users,
        "new_users": new_users,
        "returning_users": returning_users,
        "active_users_count": active_users_count,
        "user_breakdown": user_breakdown,
        "registration_trend": registration_trend,
        "active_users": active_users,
    }


def _content_payload(days: int) -> dict:
    _, start, _ = _period_bounds(days)
    anime_queryset = Anime.objects.all()
    genre_queryset = Genre.objects.all()
    studio_queryset = Studio.objects.all()

    total_anime = anime_queryset.count()
    new_anime = anime_queryset.filter(created_at__gte=start).count()

    by_status = {
        row["status"]: row["count"]
        for row in anime_queryset.values("status").annotate(count=Count("id")).order_by("status")
    }
    by_type = {
        row["anime_type"]: row["count"]
        for row in anime_queryset.values("anime_type").annotate(count=Count("id")).order_by("anime_type")
    }

    top_genres = list(
        genre_queryset.annotate(anime_count=Count("anime"))
        .order_by("-anime_count", "name")
        .values("id", "name", "anime_count")[:10]
    )
    top_studios = list(
        studio_queryset.annotate(anime_count=Count("anime"))
        .order_by("-anime_count", "name")
        .values("id", "name", "anime_count")[:10]
    )

    content_trend = list(
        anime_queryset.filter(created_at__gte=start)
        .annotate(date=TruncDate("created_at"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )

    missing_cover = anime_queryset.filter(
        Q(cover_image__isnull=True) | Q(cover_image=""),
        Q(cover_image_external_url__isnull=True) | Q(cover_image_external_url=""),
    ).count()
    missing_synopsis = anime_queryset.filter(Q(synopsis__isnull=True) | Q(synopsis="")).count()
    missing_studio = anime_queryset.filter(studio__isnull=True).count()
    missing_rating = anime_queryset.filter(rating__isnull=True).count()

    completeness = 100.0
    if total_anime:
        missing_points = missing_cover + missing_synopsis + missing_studio + missing_rating
        completeness = round(100 - ((missing_points / (total_anime * 4)) * 100), 2)

    return {
        "total_anime": total_anime,
        "new_anime": new_anime,
        "by_status": by_status,
        "by_type": by_type,
        "top_genres": top_genres,
        "top_studios": top_studios,
        "content_trend": content_trend,
        "missing_metadata": {
            "total": total_anime,
            "cover_image": missing_cover,
            "synopsis": missing_synopsis,
            "studio": missing_studio,
            "rating": missing_rating,
            "completeness": completeness,
        },
    }


def _engagement_payload(days: int) -> dict:
    _, start, _ = _period_bounds(days)
    review_queryset = Review.objects.all()
    list_entry_queryset = UserAnimeList.objects.all()
    favorite_queryset = UserFavorite.objects.all()
    vote_queryset = ReviewVote.objects.all()
    anime_queryset = Anime.objects.all()

    total_reviews = review_queryset.count()
    new_reviews = review_queryset.filter(created_at__gte=start).count()
    avg_rating = review_queryset.aggregate(avg=Avg("rating"))["avg"] or 0.0

    reviews_by_rating = {
        row["rating"]: row["count"]
        for row in review_queryset.values("rating").annotate(count=Count("id")).order_by("rating")
    }
    list_by_status = {
        row["status"]: row["count"]
        for row in list_entry_queryset.values("status").annotate(count=Count("id")).order_by("status")
    }

    reviews_trend = list(
        review_queryset.filter(created_at__gte=start)
        .annotate(date=TruncDate("created_at"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )
    favorites_trend = list(
        favorite_queryset.filter(added_at__gte=start)
        .annotate(date=TruncDate("added_at"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )

    review_votes = {
        "helpful": vote_queryset.filter(is_helpful=True).count(),
        "unhelpful": vote_queryset.filter(is_helpful=False).count(),
    }

    most_reviewed = list(
        anime_queryset.annotate(review_count=Count("reviews"))
        .order_by("-review_count", "title")
        .values("id", "title", "slug", "rating", "review_count")[:10]
    )
    most_favorited = list(
        anime_queryset.annotate(favorite_count=Count("favorites"))
        .order_by("-favorite_count", "title")
        .values("id", "title", "slug", "rating", "favorite_count")[:10]
    )

    return {
        "total_reviews": total_reviews,
        "new_reviews": new_reviews,
        "avg_rating": round(float(avg_rating), 2),
        "reviews_by_rating": reviews_by_rating,
        "list_by_status": list_by_status,
        "reviews_trend": reviews_trend,
        "favorites_trend": favorites_trend,
        "review_votes": review_votes,
        "most_reviewed": most_reviewed,
        "most_favorited": most_favorited,
    }
