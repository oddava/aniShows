"""List entries: the read queryset (paging, search, sort), the upsert write path and the summary."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import (
    Count,
    ExpressionWrapper,
    F,
    FloatField,
    Max,
    Q,
)
from django.db.models.functions import NullIf
from django.http import Http404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from ...animes.models import Anime
from ...shared.errors import CACHE_ERRORS
from ...shared.logger import logger
from ..models import UserAnimeList
from .cache import invalidate_user_caches
from .profile_visibility import can_view_profile
from .stats_service import list_stat_expressions

User = get_user_model()
Status = UserAnimeList.UserAnimeStatus

LIST_ORDERINGS: dict[str, tuple[Any, ...]] = {
    "-updated_at": (F("updated_at").desc(), "-id"),
    "title": (F("anime__title").asc(), "id"),
    "-score": (F("score").desc(), F("updated_at").desc(), "-id"),
    "-progress": (F("progress_pct").desc(nulls_last=True), F("updated_at").desc(), "-id"),
    "started_at": (F("started_at").asc(nulls_last=True), "id"),
    "-finished_at": (F("finished_at").desc(nulls_last=True), "-id"),
}
DEFAULT_LIST_ORDERING = "-updated_at"

LISTS_SUMMARY_CACHE_TIMEOUT = 600
SUMMARY_TOP_GENRES = 12
# Minutes per episode when the catalog has no duration (same fallback as the stats).
DEFAULT_EPISODE_MINUTES = 24


class ListQueryError(ValueError):
    """An invalid query parameter (400)."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


def resolve_list_owner(request_user, username: str | None):
    """The user whose list is read, or ``None`` when the viewer may not see it.

    Raises ``Http404`` for an unknown username. A private profile reads as empty, as
    it always has (not 404), so a private user's link still renders a profile.
    """
    if username:
        try:
            target_user = User.objects.select_related("userprofile").get(username=username)
        except User.DoesNotExist as exc:
            raise Http404 from exc
        return target_user if can_view_profile(target_user, request_user) else None
    if request_user.is_authenticated:
        return request_user
    return None


def get_user_anime_list_queryset(
    request_user,
    username: str | None = None,
    list_status: str | None = None,
    *,
    search: str | None = None,
    ordering: str | None = None,
    genre: str | None = None,
):
    if list_status and list_status not in Status.values:
        raise ListQueryError("status", f"Unknown status '{list_status}'.")
    ordering = ordering or DEFAULT_LIST_ORDERING
    if ordering not in LIST_ORDERINGS:
        raise ListQueryError(
            "ordering", f"Ordering must be one of: {', '.join(sorted(LIST_ORDERINGS))}."
        )

    target_user = resolve_list_owner(request_user, username)
    if target_user is None:
        return UserAnimeList.objects.none()

    queryset = UserAnimeList.objects.filter(user=target_user)
    if list_status:
        queryset = queryset.filter(status=list_status)
    search = (search or "").strip()
    if search:
        # A user's list is small: a plain icontains over both titles is enough.
        queryset = queryset.filter(
            Q(anime__title__icontains=search) | Q(anime__title_jp__icontains=search)
        )
    genre = (genre or "").strip()
    if genre:
        # One genre slug: each entry's anime joins at most one matching row.
        queryset = queryset.filter(anime__genres__slug=genre)
    if ordering == "-progress":
        queryset = queryset.annotate(
            progress_pct=ExpressionWrapper(
                F("episodes_watched") * 100.0 / NullIf(F("anime__episode_count"), 0),
                output_field=FloatField(),
            )
        )
    return (
        queryset.select_related("anime")
        .prefetch_related("anime__genres", Anime.studios_prefetch("anime__"))
        .order_by(*LIST_ORDERINGS[ordering])
    )


def _save_entry(serializer, **save_kwargs) -> None:
    """Save, turning a constraint violation the validator missed into a 400, not a 500."""
    try:
        with transaction.atomic():
            serializer.save(**save_kwargs)
    except IntegrityError as exc:
        logger.warning("List entry write violated a constraint", exc_info=True)
        raise serializers.ValidationError(
            {"detail": "This list entry has an invalid combination of values."}
        ) from exc


def _after_write(user) -> None:
    invalidate_user_caches(user.id, user.username)
    # Also now, not only on commit (the side-effects handler does that): the
    # profile reads these numbers, so the response to this write's follow-up
    # GET must not see the old ones (P1).
    invalidate_lists_summary(user.id)


def upsert_user_anime_list_entry(serializer_class, user, data, context) -> tuple[Any, bool]:
    """POST ``lists/``: create the entry, or update it when (user, anime) already exists.

    Returns ``(serializer, created)``. Idempotent under concurrency: the existing row is
    locked, and a first-insert race (two POSTs for a new entry) loses on the unique
    index inside a savepoint and is retried as an update.
    """
    anime_id = data.get("anime_id") if hasattr(data, "get") else None

    def update(existing):
        serializer = serializer_class(existing, data=data, partial=True, context=context)
        serializer.is_valid(raise_exception=True)
        _save_entry(serializer)
        return serializer

    with transaction.atomic():
        existing = None
        if anime_id is not None and anime_id != "":
            try:
                existing = (
                    UserAnimeList.objects.select_for_update()
                    .filter(user=user, anime_id=int(str(anime_id)))
                    .first()
                )
            except (TypeError, ValueError):
                existing = None  # the serializer reports the bad anime_id
        if existing is not None:
            serializer, created = update(existing), False
        else:
            serializer = serializer_class(data=data, context=context)
            serializer.is_valid(raise_exception=True)
            try:
                with transaction.atomic():
                    serializer.save(user=user)
                created = True
            except IntegrityError as exc:
                existing = (
                    UserAnimeList.objects.select_for_update()
                    .filter(user=user, anime=serializer.validated_data["anime"])
                    .first()
                )
                if existing is None:
                    raise serializers.ValidationError(
                        {"detail": "This list entry has an invalid combination of values."}
                    ) from exc
                serializer, created = update(existing), False

    _after_write(user)
    return serializer, created


def update_user_anime_list_entry(serializer, user):
    if serializer.instance.user_id != user.id:
        raise PermissionDenied("You can only modify your own anime list.")
    serializer.instance.user = user  # same row; spares the signals a lazy SELECT
    _save_entry(serializer)
    _after_write(user)


def delete_user_anime_list_entry(instance, user):
    if instance.user_id != user.id:
        raise PermissionDenied("You can only remove items from your own anime list.")
    instance.user = user
    instance.delete()
    _after_write(user)


# --------------------------------------------------------------------------- summary


def lists_summary_cache_key(user_id: int) -> str:
    # v2: adds ``rated_count``.
    return f"lists_summary:v2:{user_id}"


def list_stats_cache_key(user_id: int) -> str:
    return f"list_stats:v1:{user_id}"


def invalidate_lists_summary(user_id: int | None) -> None:
    if not user_id:
        return
    try:
        cache.delete_many([lists_summary_cache_key(user_id), list_stats_cache_key(user_id)])
    except CACHE_ERRORS:
        logger.warning("Could not drop the list summary cache for %s", user_id, exc_info=True)


def empty_lists_summary() -> dict:
    return {
        "counts": dict.fromkeys(Status.values, 0),
        "total": 0,
        "episodes_watched": 0,
        "minutes": 0,
        "mean_score": None,
        "rated_count": 0,
        "score_histogram": {str(score): 0 for score in range(1, 11)},
        "top_genres": [],
        "updated_at": None,
    }


def _compute_lists_summary(user_id: int) -> dict:
    entries = UserAnimeList.objects.filter(user_id=user_id)
    shared = list_stat_expressions()
    aggregates = entries.aggregate(
        total=shared["anime_count"],
        episodes_total=shared["episodes"],
        minutes=shared["minutes"],
        mean_score=shared["mean"],
        rated_count=shared["rated"],
        last_updated=Max("updated_at"),
        **{f"status_{i}": Count("id", filter=Q(status=s)) for i, s in enumerate(Status.values)},
        **{f"score_{n}": Count("id", filter=Q(score=n)) for n in range(1, 11)},
    )
    genres = (
        entries.filter(anime__genres__isnull=False)
        .values("anime__genres__name", "anime__genres__slug")
        .annotate(count=Count("id"))
        .order_by("-count", "anime__genres__name")[:SUMMARY_TOP_GENRES]
    )
    mean_score = aggregates["mean_score"]
    return {
        "counts": {s: aggregates[f"status_{i}"] for i, s in enumerate(Status.values)},
        "total": aggregates["total"],
        "episodes_watched": aggregates["episodes_total"],
        "minutes": aggregates["minutes"],
        "mean_score": round(mean_score, 1) if mean_score is not None else None,
        "rated_count": aggregates["rated_count"],
        "score_histogram": {str(n): aggregates[f"score_{n}"] for n in range(1, 11)},
        "top_genres": [
            {
                "name": row["anime__genres__name"],
                "slug": row["anime__genres__slug"],
                "count": row["count"],
            }
            for row in genres
        ],
        "updated_at": aggregates["last_updated"].isoformat()
        if aggregates["last_updated"]
        else None,
    }


def get_lists_summary(request_user, username: str | None) -> dict:
    """``GET lists/summary/``: one cached aggregate per user (privacy as the list itself)."""
    target_user = resolve_list_owner(request_user, username)
    if target_user is None:
        return empty_lists_summary()
    return cached_lists_summary(target_user.id)


def list_stats_from_summary(summary: dict) -> dict:
    """The list-derived profile numbers, read off the summary (P1: one calculation)."""
    minutes = int(summary.get("minutes") or 0)
    return {
        "anime_count": int(summary.get("total") or 0),
        "episodes_watched": int(summary.get("episodes_watched") or 0),
        "total_minutes": minutes,
        "days_watched": round(minutes / 1440.0, 1),
        "mean_score": summary.get("mean_score"),
        "rated_count": int(summary.get("rated_count") or 0),
    }


def live_list_stats(user_id: int) -> dict:
    """List stats as of the last write: the cached summary is dropped on every write.

    Reads the cached summary when there is one; otherwise runs only the totals
    aggregate (one query, same expressions), not the genre breakdown.
    """
    try:
        cached = cache.get(lists_summary_cache_key(user_id))
    except CACHE_ERRORS:
        cached = None
    if cached is not None:
        return list_stats_from_summary(cached)
    try:
        stats = cache.get(list_stats_cache_key(user_id))
    except CACHE_ERRORS:
        stats = None
    if stats is not None:
        return stats
    shared = list_stat_expressions()
    totals = UserAnimeList.objects.filter(user_id=user_id).aggregate(
        total=shared["anime_count"],
        episodes_total=shared["episodes"],
        minutes=shared["minutes"],
        mean_score=shared["mean"],
        rated_count=shared["rated"],
    )
    totals["episodes_watched"] = totals.pop("episodes_total")
    mean = totals["mean_score"]
    totals["mean_score"] = round(mean, 1) if mean is not None else None
    stats = list_stats_from_summary(totals)
    try:
        cache.set(list_stats_cache_key(user_id), stats, timeout=LISTS_SUMMARY_CACHE_TIMEOUT)
    except CACHE_ERRORS:
        logger.warning("Could not cache the list stats", exc_info=True)
    return stats


def cached_lists_summary(user_id: int) -> dict:
    key = lists_summary_cache_key(user_id)
    try:
        cached = cache.get(key)
    except CACHE_ERRORS:
        cached = None
    if cached is not None:
        return cached
    summary = _compute_lists_summary(user_id)
    try:
        cache.set(key, summary, timeout=LISTS_SUMMARY_CACHE_TIMEOUT)
    except CACHE_ERRORS:
        logger.warning("Could not cache the list summary", exc_info=True)
    return summary
