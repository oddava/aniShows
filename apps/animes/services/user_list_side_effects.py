from dataclasses import dataclass
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone as tz

from ...shared.errors import CACHE_ERRORS, ENQUEUE_ERRORS
from ...shared.logger import logger
from ...users.models import UserActivity, UserAnimeList
from ...users.services.cache import invalidate_user_caches
from ...users.services.list_service import invalidate_lists_summary
from ...users.services.stats_service import create_or_update_user_stats
from ...users.services.user_queryset import user_exists

User = get_user_model()


def update_user_stats_and_cache(user):
    if not user:
        return

    try:
        invalidate_user_caches(user.id, user.username, trigger_stats_update=False)

        from ...users.tasks import schedule_user_stats_refresh

        schedule_user_stats_refresh(
            user_id=user.id,
            countdown=2,
        )
        logger.debug("Invalidated cache and queued stats update for user %s", user.username)
    except ENQUEUE_ERRORS:
        # Cache or broker unavailable: refresh the stats inline instead.
        try:
            create_or_update_user_stats(user)
            invalidate_user_caches(user.id, user.username)
        except (DatabaseError, *CACHE_ERRORS):
            logger.warning("Inline stats refresh failed for user %s", user.username, exc_info=True)
        logger.exception("Failed to update stats for user %s", user.username)


def invalidate_heatmap_cache(user_id):
    from ...users.services.cache import get_user_heatmap_cache_key

    cache_key = get_user_heatmap_cache_key(user_id)
    cache.delete(cache_key)
    logger.debug("Invalidated heatmap cache for user %s", user_id)


SITE_STATUS_KEYS = ("watching", "completed", "on_hold", "dropped", "plan_to_watch")
SITE_STATUS_CACHE_TIMEOUT = 600
# A +1 within this window of the last +1 on the same anime extends that activity row.
PROGRESS_COALESCE_WINDOW = timedelta(minutes=30)
# A list write within this window of the last row for the same anime replaces that row.
LIST_ACTIVITY_MERGE_WINDOW = timedelta(minutes=10)


def site_status_cache_key(anime_id) -> str:
    return f"site_status:v1:{anime_id}"


def site_status_counts(anime_id) -> dict[str, int]:
    """How many aniShows users have ``anime_id`` in each list status (G3 contract for G2).

    One aggregate on ``UserAnimeList(anime_id, status)``, cached 10 minutes and dropped
    by every list change. ``Anime.status_distribution`` is left to the catalog provider
    (AniList's global counts, D-3); list writes never touch the Anime row.
    """
    empty = dict.fromkeys(SITE_STATUS_KEYS, 0)
    if not anime_id:
        return empty
    key = site_status_cache_key(anime_id)
    try:
        cached = cache.get(key)
    except CACHE_ERRORS:
        cached = None
    if cached is not None:
        return cached

    status = UserAnimeList.UserAnimeStatus
    aggregate = UserAnimeList.objects.filter(anime_id=anime_id).aggregate(
        watching=Count("id", filter=Q(status=status.watching)),
        completed=Count("id", filter=Q(status=status.completed)),
        on_hold=Count("id", filter=Q(status=status.on_hold)),
        dropped=Count("id", filter=Q(status=status.dropped)),
        plan_to_watch=Count("id", filter=Q(status=status.plan_to_watch)),
    )
    counts = {name: int(aggregate.get(name) or 0) for name in SITE_STATUS_KEYS}
    try:
        cache.set(key, counts, timeout=SITE_STATUS_CACHE_TIMEOUT)
    except CACHE_ERRORS:
        logger.warning("Could not cache site status counts for anime %s", anime_id, exc_info=True)
    return counts


def invalidate_site_status_counts(anime_ids) -> None:
    keys = [site_status_cache_key(anime_id) for anime_id in anime_ids if anime_id]
    if not keys:
        return
    try:
        cache.delete_many(keys)
    except CACHE_ERRORS:
        logger.warning("Could not drop site status counts", exc_info=True)


def _coalesce_progress(latest, kwargs, now) -> bool:
    """Fold a +1 into the user's last PROGRESS row for the same anime (spec 3 P1-7).

    True when the activity was absorbed (updated or, when it nets to zero, removed),
    so binge clicks leave one feed row; the heatmap sum of episode diffs is unchanged.
    """
    if (
        latest is None
        or latest.activity_type != UserActivity.ActivityType.PROGRESS
        or latest.created_at < now - PROGRESS_COALESCE_WINDOW
        or latest.created_at.date() != now.date()
    ):
        return False
    new_episodes = kwargs.get("new_episodes")
    if new_episodes == latest.old_episodes:
        latest.delete()
    else:
        latest.new_episodes = new_episodes
        latest.save(update_fields=["new_episodes"])
    return True


@dataclass(frozen=True, slots=True)
class _EntryState:
    """What the activity log knows about an entry at one moment."""

    status: str
    episodes: int | None


@dataclass(frozen=True, slots=True)
class _ListEvent:
    """One list write: the entry before and after (``None`` = not on the list)."""

    before: _EntryState | None
    after: _EntryState | None
    # The write moved ``is_rewatching`` or ``total_rewatches``: its own event, never merged.
    touches_rewatch: bool = False
    # The write took back a rewatch that had just started (flag off, nothing counted).
    reverts_rewatch: bool = False


def _transition_fields(before: _EntryState | None, after: _EntryState | None):
    """The activity row that describes ``before -> after`` (``None`` when nothing to show).

    The one place the row type is chosen, for a single write and for a merged run of
    writes alike. Status and removal rows carry the episode counts too, so a later write
    can tell what state they started from; only PROGRESS and COMPLETED rows feed the
    heatmap.
    """
    at = UserActivity.ActivityType
    completed = UserAnimeList.UserAnimeStatus.completed
    if before is None and after is None:
        return None
    if before is None:
        assert after is not None
        return {
            "activity_type": at.COMPLETED if after.status == completed else at.ADDED,
            "new_status": after.status,
            "new_episodes": after.episodes,
        }
    if after is None:
        return {
            "activity_type": at.REMOVED,
            "old_status": before.status,
            "old_episodes": before.episodes,
        }
    changes = {
        "old_status": before.status,
        "new_status": after.status,
        "old_episodes": before.episodes,
        "new_episodes": after.episodes,
    }
    if after.status == completed and before.status != completed:
        return {"activity_type": at.COMPLETED, **changes}
    if after.status != before.status:
        return {"activity_type": at.STATUS_CHANGE, **changes}
    if after.episodes != before.episodes:
        return {
            "activity_type": at.PROGRESS,
            "old_episodes": before.episodes,
            "new_episodes": after.episodes,
        }
    return None


def _heatmap_episodes(activity_type, old_episodes, new_episodes) -> int:
    """Episodes a row adds to the heatmap (mirrors ``activity_service.get_heatmap_data``)."""
    at = UserActivity.ActivityType
    if activity_type not in (at.PROGRESS, at.COMPLETED):
        return 0
    if new_episodes is None:
        return 1
    return max(new_episodes - (old_episodes or 0), 0)


def _row_span(row, event: _ListEvent):
    """``(before, after)`` the stored ``row`` recorded, or ``None`` when it cannot be told.

    PROGRESS rows keep no status (their status did not change), so it is read from the
    state the new write started from. Rows written before status rows kept episode
    counts give ``None``: they are left alone.
    """
    at = UserActivity.ActivityType
    kind = row.activity_type
    if kind == at.ADDED:
        return None, _EntryState(row.new_status, row.new_episodes)
    if kind == at.COMPLETED and row.old_status is None and row.old_episodes is None:
        return None, _EntryState(row.new_status, row.new_episodes)
    if kind in (at.COMPLETED, at.STATUS_CHANGE):
        if row.old_episodes is None or row.new_episodes is None:
            return None
        return (
            _EntryState(row.old_status, row.old_episodes),
            _EntryState(row.new_status, row.new_episodes),
        )
    if kind == at.REMOVED:
        if row.old_episodes is None:
            return None
        return _EntryState(row.old_status, row.old_episodes), None
    if kind == at.PROGRESS:
        if event.before is None:
            return None
        status = event.before.status
        return _EntryState(status, row.old_episodes), _EntryState(status, row.new_episodes)
    return None


def _merge_list_activity(latest, kwargs, event: _ListEvent, now) -> bool:
    """Fold a list write into the user's last row for the anime when that row is recent.

    The feed says what happened, not every click: within ``LIST_ACTIVITY_MERGE_WINDOW``
    of the previous row for the same user and anime, that row is replaced by one that
    describes the net change (Added then Completed is one "Completed"), and a write that
    puts the entry back where that row started (an Undo, an add then a remove) leaves no
    row at all. True when the write was absorbed.

    The heatmap counts episodes from PROGRESS and COMPLETED rows, so a replacement is
    made only when it counts the same episodes as the two rows it stands for; otherwise
    both rows stay. A net no-op drops the episodes too: they were taken back. Runs of
    +1s keep their own rule (``_coalesce_progress``), and rewatch starts and finishes
    stay rows of their own.
    """
    at = UserActivity.ActivityType
    if (
        latest is None
        or latest.created_at < now - LIST_ACTIVITY_MERGE_WINDOW
        or tz.localdate(latest.created_at) != tz.localdate(now)
    ):
        return False

    if latest.activity_type == at.REWATCHING:
        # Only the Undo of a rewatch start folds in: back to where it started.
        started_from = _EntryState(latest.old_status, latest.old_episodes)
        if event.reverts_rewatch and event.after == started_from:
            latest.delete()
            return True
        return False
    if event.touches_rewatch:
        return False
    if latest.activity_type == at.PROGRESS and kwargs["activity_type"] == at.PROGRESS:
        return False

    span = _row_span(latest, event)
    if span is None:
        return False
    start, middle = span
    if middle != event.before:
        return False  # something unlogged happened in between: keep both rows
    if start == event.after:
        latest.delete()
        return True

    merged = _transition_fields(start, event.after)
    if merged is None:
        return False
    counted = _heatmap_episodes(
        merged["activity_type"], merged.get("old_episodes"), merged.get("new_episodes")
    )
    separate = _heatmap_episodes(
        latest.activity_type, latest.old_episodes, latest.new_episodes
    ) + _heatmap_episodes(
        kwargs["activity_type"], kwargs.get("old_episodes"), kwargs.get("new_episodes")
    )
    if counted != separate:
        return False

    keeps_score = merged["activity_type"] in (at.ADDED, at.COMPLETED)
    latest.activity_type = merged["activity_type"]
    latest.old_status = merged.get("old_status")
    latest.new_status = merged.get("new_status")
    latest.old_episodes = merged.get("old_episodes")
    latest.new_episodes = merged.get("new_episodes")
    latest.old_score = None
    latest.new_score = kwargs.get("new_score") if keeps_score else None
    latest.notes = kwargs.get("notes", "")
    latest.created_at = now
    latest.save()
    return True


def _absorb_into_latest(kwargs, event: _ListEvent | None) -> bool:
    """Fold the write into the user's last row for the anime (one locked read for both rules)."""
    now = tz.now()
    with transaction.atomic():
        latest = (
            UserActivity.objects.select_for_update()
            .filter(user=kwargs["user"], anime=kwargs["anime"])
            .order_by("-created_at", "-id")
            .first()
        )
        if latest is None:
            return False
        if event is not None and _merge_list_activity(latest, kwargs, event, now):
            return True
        return kwargs["activity_type"] == UserActivity.ActivityType.PROGRESS and (
            _coalesce_progress(latest, kwargs, now)
        )


def _create_activity_deduped(event: _ListEvent | None = None, **kwargs):
    user = kwargs.get("user")
    if not user_exists(user):
        return

    cutoff = tz.now() - timedelta(seconds=2)
    dedupe_fields = {
        "old_status": kwargs.get("old_status"),
        "new_status": kwargs.get("new_status"),
        "old_episodes": kwargs.get("old_episodes"),
        "new_episodes": kwargs.get("new_episodes"),
        "old_score": kwargs.get("old_score"),
        "new_score": kwargs.get("new_score"),
        "notes": kwargs.get("notes", ""),
    }

    if UserActivity.objects.filter(
        user=user,
        anime=kwargs["anime"],
        activity_type=kwargs["activity_type"],
        created_at__gte=cutoff,
        **dedupe_fields,
    ).exists():
        logger.debug(
            "Skipping duplicate activity %s for user %s",
            kwargs["activity_type"],
            kwargs["user"].username,
        )
        return

    try:
        if _absorb_into_latest(kwargs, event):
            return
        UserActivity.objects.create(**kwargs)
    except IntegrityError:
        logger.debug("Skipping activity creation for deleted user", exc_info=True)


def _entry_state(instance) -> _EntryState:
    return _EntryState(instance.status, instance.episodes_watched)


def build_list_event(instance, *, created: bool) -> _ListEvent:
    if created:
        return _ListEvent(before=None, after=_entry_state(instance))
    old_status = getattr(instance, "_old_status", None)
    old_episodes = getattr(instance, "_old_episodes", None)
    old_is_rewatching = bool(getattr(instance, "_old_is_rewatching", None))
    old_total_rewatches = getattr(instance, "_old_total_rewatches", None)
    before = _EntryState(old_status, old_episodes) if old_status is not None else None
    count_changed = (
        old_total_rewatches is not None and old_total_rewatches != instance.total_rewatches
    )
    return _ListEvent(
        before=before,
        after=_entry_state(instance),
        touches_rewatch=old_is_rewatching != bool(instance.is_rewatching) or count_changed,
        reverts_rewatch=old_is_rewatching and not instance.is_rewatching and not count_changed,
    )


def build_user_activity_kwargs(instance, *, created: bool):
    base = {"user": instance.user, "anime": instance.anime, "notes": instance.notes or ""}
    score = instance.score if instance.score else None

    if created:
        return {**base, **_transition_fields(None, _entry_state(instance)), "new_score": score}

    old_status = getattr(instance, "_old_status", None)
    old_episodes = getattr(instance, "_old_episodes", None)
    old_is_rewatching = getattr(instance, "_old_is_rewatching", None)

    if instance.is_rewatching and not old_is_rewatching:
        return {
            **base,
            "activity_type": UserActivity.ActivityType.REWATCHING,
            "old_status": old_status,
            "new_status": instance.status,
            "old_episodes": old_episodes,
            "new_episodes": instance.episodes_watched,
        }
    if not old_status or old_episodes is None:
        return None
    fields = _transition_fields(_EntryState(old_status, old_episodes), _entry_state(instance))
    if fields is None:
        return None
    if fields["activity_type"] == UserActivity.ActivityType.COMPLETED:
        fields["new_score"] = score
    return {**base, **fields}


def log_user_activity(instance, *, created: bool):
    if not instance or not instance.user or getattr(instance, "_skip_activity", False):
        return

    activity_kwargs = build_user_activity_kwargs(instance, created=created)
    if not activity_kwargs:
        return
    event = build_list_event(instance, created=created)

    transaction.on_commit(
        lambda kw=activity_kwargs, ev=event: _create_activity_deduped(event=ev, **kw)
    )
    transaction.on_commit(lambda: invalidate_heatmap_cache(instance.user.id))


def log_user_activity_on_delete(instance):
    if not instance or not instance.user or getattr(instance, "_skip_activity", False):
        return
    if not user_exists(instance.user):
        return

    before = _entry_state(instance)
    activity_kwargs = {
        "user": instance.user,
        "anime": instance.anime,
        **_transition_fields(before, None),
        "notes": instance.notes or "",
    }
    event = _ListEvent(before=before, after=None)
    transaction.on_commit(
        lambda kw=activity_kwargs, ev=event: _create_activity_deduped(event=ev, **kw)
    )
    transaction.on_commit(lambda: invalidate_heatmap_cache(instance.user.id))


def schedule_recommendations_debounced(user_id, *, task, countdown=300):
    cache_key = f"reco_pending:{user_id}"
    # ``add`` is atomic: of two concurrent list changes only one schedules the task.
    if not cache.add(cache_key, True, timeout=countdown + 30):
        logger.debug(
            "Skipping duplicate recommendation task for user %s (already scheduled within %ss window)",
            user_id,
            countdown,
        )
        return

    task.apply_async(
        kwargs={"user_id": user_id},
        countdown=countdown,
    )
    logger.debug("Scheduled recommendation generation for user %s in %ss", user_id, countdown)


def handle_user_anime_list_change(instance, *, schedule_recommendations):
    if not instance or not instance.user or getattr(instance, "_skip_activity", False):
        return
    if not user_exists(instance.user):
        return

    logger.info(
        "User %s updated anime list. Updating stats and triggering recommendations.",
        instance.user.username,
    )
    update_user_stats_and_cache(instance.user)
    schedule_recommendations(instance.user.id, countdown=300)
    user_id, anime_id = instance.user.id, instance.anime_id

    def drop_derived_caches():
        # One key each, no namespace bump: the public collections stay cached.
        invalidate_site_status_counts([anime_id])
        invalidate_lists_summary(user_id)

    transaction.on_commit(drop_derived_caches)


def handle_user_favorite_change(instance, *, schedule_recommendations):
    if not instance or not instance.user:
        return
    if not user_exists(instance.user):
        return

    logger.info(
        "User %s updated favorites. Updating stats and triggering recommendations.",
        instance.user.username,
    )
    update_user_stats_and_cache(instance.user)
    schedule_recommendations(instance.user.id, countdown=120)


def handle_review_change(instance):
    if not instance or not instance.user:
        return
    if not user_exists(instance.user):
        return

    logger.info("User %s updated reviews. Updating stats.", instance.user.username)
    update_user_stats_and_cache(instance.user)
