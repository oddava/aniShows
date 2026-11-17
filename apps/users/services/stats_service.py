"""User stats: one implementation for the Celery task, the inline fallback and the command (P1-5).

``compute_user_stats(user_ids)`` runs a fixed number of grouped aggregates for any
number of users. Every caller (``UserTaskService.update_user_stats``,
``calculate_user_stats``, ``create_or_update_user_stats``, ``populate_user_stats``) goes
through it, so the numbers agree whichever path refreshed them. An episode with no
known duration counts as 24 minutes everywhere. ``UserStats`` also carries G5's
follow/review counters; this module stays their only writer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import Avg, Count, ExpressionWrapper, F, IntegerField, Q, Sum, Value
from django.db.models.functions import Coalesce, NullIf
from django.utils import timezone

from ...animes.models import Review, ReviewVote, UserFavorite
from ..models import UserAnimeList, UserFollow, UserStats

if TYPE_CHECKING:
    from collections.abc import Iterable

DEFAULT_EPISODE_MINUTES = 24
STATS_FIELDS = (
    "followers_count",
    "following_count",
    "anime_count",
    "episodes_watched",
    "total_minutes",
    "days_watched",
    "mean_score",
    "favorites_count",
    "reviews_count",
    "resonance_count",
)


def serialize_user_stats(
    stats_data: dict,
    *,
    include_follow_counts: bool = False,
    include_last_updated=False,
):
    payload = {
        "anime_count": int(stats_data.get("anime_count", 0) or 0),
        "episodes_watched": int(stats_data.get("episodes_watched", 0) or 0),
        "total_minutes": int(stats_data.get("total_minutes", 0) or 0),
        "days_watched": round(float(stats_data.get("days_watched", 0) or 0), 1),
        "mean_score": round(stats_data["mean_score"], 1) if stats_data.get("mean_score") else None,
        "favorites_count": int(stats_data.get("favorites_count", 0) or 0),
        "reviews_count": int(stats_data.get("reviews_count", 0) or 0),
        "resonance_count": int(stats_data.get("resonance_count", 0) or 0),
    }
    if include_follow_counts:
        payload["followers_count"] = int(stats_data.get("followers_count", 0) or 0)
        payload["following_count"] = int(stats_data.get("following_count", 0) or 0)
    if include_last_updated:
        payload["last_updated"] = stats_data.get("last_updated")
    return payload


def get_materialized_user_stats_payload(
    stats: UserStats,
    *,
    include_follow_counts: bool = False,
    include_last_updated: bool = False,
):
    stats_data = {field: getattr(stats, field) for field in STATS_FIELDS}
    stats_data["last_updated"] = stats.last_updated
    return serialize_user_stats(
        stats_data,
        include_follow_counts=include_follow_counts,
        include_last_updated=include_last_updated,
    )


def _counts_by(queryset, field: str) -> dict[int, int]:
    return {row[field]: row["total"] for row in queryset.values(field).annotate(total=Count("id"))}


def compute_user_stats(user_ids: Iterable[int]) -> dict[int, dict]:
    """Stats for each user id, in seven grouped queries whatever the number of users."""
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}

    followers = _counts_by(UserFollow.objects.filter(following_id__in=ids), "following_id")
    following = _counts_by(UserFollow.objects.filter(follower_id__in=ids), "follower_id")
    favorites = _counts_by(UserFavorite.objects.filter(user_id__in=ids), "user_id")
    reviews = _counts_by(Review.objects.filter(user_id__in=ids), "user_id")
    resonance = _counts_by(
        ReviewVote.objects.filter(review__user_id__in=ids, vote_type=ReviewVote.VoteType.HELPFUL),
        "review__user_id",
    )
    episode_minutes = Coalesce(
        NullIf(F("anime__duration_minutes"), 0), Value(DEFAULT_EPISODE_MINUTES)
    )
    lists = {
        row["user_id"]: row
        for row in UserAnimeList.objects.filter(user_id__in=ids)
        .values("user_id")
        .annotate(
            anime_count=Count("id"),
            episodes=Coalesce(Sum("episodes_watched"), 0),
            mean=Avg("score", filter=Q(score__gt=0)),
            minutes=Coalesce(
                Sum(
                    ExpressionWrapper(
                        F("episodes_watched") * episode_minutes, output_field=IntegerField()
                    )
                ),
                0,
            ),
        )
    }

    result: dict[int, dict] = {}
    for uid in ids:
        row = lists.get(uid, {})
        minutes = int(row.get("minutes") or 0)
        mean = row.get("mean")
        result[uid] = {
            "followers_count": int(followers.get(uid, 0)),
            "following_count": int(following.get(uid, 0)),
            "anime_count": int(row.get("anime_count") or 0),
            "episodes_watched": int(row.get("episodes") or 0),
            "total_minutes": minutes,
            "days_watched": round(minutes / 1440.0, 1),
            "mean_score": round(mean, 1) if mean is not None else None,
            "favorites_count": int(favorites.get(uid, 0)),
            "reviews_count": int(reviews.get(uid, 0)),
            "resonance_count": int(resonance.get(uid, 0)),
        }
    return result


def calculate_user_stats(user) -> dict:
    """One user's stats computed now (the fallback when no ``UserStats`` row exists)."""
    return compute_user_stats([user.id])[user.id]


def calculate_user_stats_with_follows(user) -> dict:
    return calculate_user_stats(user)


def save_user_stats(user_ids: Iterable[int]) -> int:
    """Compute and store ``UserStats`` for ``user_ids`` in bulk; returns how many were written."""
    computed = compute_user_stats(user_ids)
    if not computed:
        return 0
    now = timezone.now()
    existing = {stats.user_id: stats for stats in UserStats.objects.filter(user_id__in=computed)}
    to_create, to_update = [], []
    for uid, data in computed.items():
        stats = existing.get(uid)
        if stats is None:
            to_create.append(UserStats(user_id=uid, is_active=True, last_updated=now, **data))
            continue
        for field, value in data.items():
            setattr(stats, field, value)
        stats.last_updated = now
        to_update.append(stats)
    if to_create:
        UserStats.objects.bulk_create(to_create, batch_size=500, ignore_conflicts=True)
    if to_update:
        UserStats.objects.bulk_update(to_update, [*STATS_FIELDS, "last_updated"], batch_size=500)
    return len(computed)


def create_or_update_user_stats(user) -> UserStats:
    """Refresh and return one user's ``UserStats`` row."""
    save_user_stats([user.id])
    return UserStats.objects.get(user_id=user.id)
