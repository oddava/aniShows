"""New-episode fan-out: one unread row per (user, anime), rolled forward per episode.

Query count per aired anime is constant in the number of recipients: candidates,
preferences, at most four roll-forward UPDATEs plus bulk INSERTs (one per 500 rows),
one re-select and one unread recount. Reruns are no-ops because both partial
unique indexes (``dedupe_key`` and unread ``group_key``) reject repeats.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone

from ...animes.models import Anime
from ...shared.logger import logger
from ..models import Notification, PushSubscription
from . import notification_preferences as prefs
from . import notification_types
from .notification_delivery import enqueue_delivery
from .notification_service import NotificationService, episode_data
from .push_service import PushService

NEW_EPISODE_LOOKBACK_HOURS = 24
BULK_BATCH_SIZE = 500
BROADCAST_CHUNK_SIZE = 500

TYPE = Notification.NotificationType.NEW_EPISODE
KIND = notification_types.TYPES[TYPE]

_ANIME_FIELDS = (
    "id",
    "slug",
    "title",
    "cover_image",
    "cover_image_external_url",
    "last_aired_episode",
    "last_aired_at",
    "next_airing_episode",
    "next_airing_date",
)


def recent_episode_events(window_start, now) -> dict[int, dict[str, Any]]:
    """``{anime_id: {anime, episode_number, aired_at}}`` for episodes aired in the window.

    The episode is the newest one known to have aired: the recorded ``last_aired_*``,
    an airing show whose stored ``next_airing_date`` has passed, and, when the schedule
    already moved on, ``next_airing_episode - 1``.
    """
    events: dict[int, dict[str, Any]] = {}

    def offer(anime, episode, aired_at):
        if episode is None or episode < 1:
            return
        current = events.get(anime.id)
        if current is None or episode > current["episode_number"]:
            events[anime.id] = {"anime": anime, "episode_number": episode, "aired_at": aired_at}

    confirmed = Anime.objects.filter(
        last_aired_at__gte=window_start,
        last_aired_at__lte=now,
        last_aired_episode__isnull=False,
    ).only(*_ANIME_FIELDS)
    for anime in confirmed:
        offer(anime, anime.last_aired_episode, anime.last_aired_at)
        if anime.next_airing_episode and anime.next_airing_date and anime.next_airing_date > now:
            offer(anime, anime.next_airing_episode - 1, anime.last_aired_at)

    pending = Anime.objects.filter(
        status=Anime.AnimeStatus.airing,
        next_airing_date__gte=window_start,
        next_airing_date__lte=now,
        next_airing_episode__isnull=False,
    ).only(*_ANIME_FIELDS)
    for anime in pending:
        offer(anime, anime.next_airing_episode, anime.next_airing_date)

    return events


def _candidates(anime_id: int, episode: int):
    """``(user_id, email_ok, has_push)`` for list entries that should hear about ``episode``."""
    from ...users.models import UserAnimeList

    statuses = UserAnimeList.UserAnimeStatus
    status_filter = Q(status=statuses.watching)
    plan_to_watch = getattr(settings, "PLAN_TO_WATCH_ALERTS", "all")
    if plan_to_watch == "all" or (plan_to_watch == "premiere" and episode == 1):
        status_filter |= Q(status=statuses.plan_to_watch)

    return (
        UserAnimeList.objects.filter(status_filter, anime_id=anime_id, user__is_active=True)
        .filter(episodes_watched__lt=episode)
        .annotate(
            has_push=Exists(
                PushSubscription.objects.filter(user_id=OuterRef("user_id"), is_active=True)
            )
        )
        .values_list(
            "user_id",
            "user__email",
            "user__userprofile__email_verified",
            "has_push",
        )
    )


def notify_episode(anime, episode: int, aired_at) -> dict[str, int]:
    """Create or roll forward the episode row of every interested user; returns counters."""
    # Rows this call writes are recognised by ``created_at >= stamp`` (inserts get
    # their own, later, auto_now_add timestamp); earlier runs' rows are older.
    stamp = timezone.now()
    rows = list(_candidates(anime.id, episode))
    if not rows:
        return {"recipients": 0, "created_or_updated": 0}

    user_ids = [row[0] for row in rows]
    preferences = prefs.preferences_for(user_ids)
    push_configured = PushService.is_configured()
    buckets: dict[tuple[bool, bool], list[int]] = defaultdict(list)
    for user_id, email, email_verified, has_push in rows:
        user_prefs = preferences[user_id]
        if not prefs.wants(user_prefs, notification_types.EPISODES, prefs.IN_APP):
            continue
        push = (
            push_configured
            and has_push
            and prefs.wants(user_prefs, notification_types.EPISODES, prefs.PUSH)
        )
        email_ok = bool(email and email_verified)
        mail = email_ok and prefs.wants(user_prefs, notification_types.EPISODES, prefs.EMAIL)
        buckets[(push, mail)].append(user_id)
    if not buckets:
        return {"recipients": 0, "created_or_updated": 0}

    dedupe_key = f"new_episode:{anime.id}:{episode}"
    group_key = f"new_episode:{anime.id}"
    data = episode_data(anime, episode, aired_at)
    grouped = {**data, "grouped": True}
    already_have_it = Notification.objects.filter(
        dedupe_key=dedupe_key, user_id=OuterRef("user_id")
    )

    for (push, mail), bucket in buckets.items():
        # 1. Roll an older unread row forward (one unread episode row per anime).
        Notification.objects.filter(
            user_id__in=bucket,
            notification_type=TYPE,
            group_key=group_key,
            is_read=False,
            data__episode_number__lt=episode,
        ).exclude(Exists(already_have_it)).update(
            dedupe_key=dedupe_key,
            data=grouped,
            title=KIND.title,
            message=KIND.message(grouped),
            created_at=stamp,
            is_push_sent=not push,
            is_email_sent=not mail,
        )
        # 2. Everyone else gets a new row; a conflict on either partial unique index
        #    (already notified, or an unread row for a later episode) is a no-op.
        Notification.objects.bulk_create(
            [
                Notification(
                    user_id=user_id,
                    notification_type=TYPE,
                    title=KIND.title,
                    message=KIND.message(data),
                    data=data,
                    priority=KIND.priority,
                    dedupe_key=dedupe_key,
                    group_key=group_key,
                    is_push_sent=not push,
                    is_email_sent=not mail,
                )
                for user_id in bucket
            ],
            ignore_conflicts=True,
            batch_size=BULK_BATCH_SIZE,
        )

    affected = list(
        Notification.objects.filter(
            notification_type=TYPE, dedupe_key=dedupe_key, created_at__gte=stamp
        )
    )
    if not affected:
        return {"recipients": sum(len(b) for b in buckets.values()), "created_or_updated": 0}

    _refresh_unread_counts([n.user_id for n in affected])
    for notification in affected:
        if (notification.data or {}).get("grouped"):
            NotificationService._broadcast_notification_update(notification)
        else:
            NotificationService._broadcast_notification(
                notification,
                unread_count=NotificationService.get_unread_count_for_user_id(notification.user_id),
            )
    enqueue_delivery(n.pk for n in affected if not (n.is_push_sent and n.is_email_sent))
    return {
        "recipients": sum(len(b) for b in buckets.values()),
        "created_or_updated": len(affected),
    }


def _refresh_unread_counts(user_ids: list[int]) -> None:
    """Recount unread rows for these users in one query and refresh their cached counters."""
    counts = dict(
        Notification.objects.filter(user_id__in=user_ids, is_read=False)
        .values("user_id")
        .annotate(n=Count("id"))
        .values_list("user_id", "n")
    )
    for user_id in user_ids:
        NotificationService._set_unread_count_cache(user_id, counts.get(user_id, 0))


def check_new_episodes(now=None) -> dict:
    now = now or timezone.now()
    events = recent_episode_events(now - timedelta(hours=NEW_EPISODE_LOOKBACK_HOURS), now)
    if not events:
        logger.info("No recently aired episodes found")
        return {"notifications_created": 0, "anime_candidates": 0, "user_entries": 0}

    created = recipients = 0
    for event in events.values():
        try:
            outcome = notify_episode(event["anime"], event["episode_number"], event["aired_at"])
        except Exception:
            logger.exception("New-episode fan-out failed", extra={"anime_id": event["anime"].id})
            continue
        created += outcome["created_or_updated"]
        recipients += outcome["recipients"]

    result = {
        "notifications_created": created,
        "anime_candidates": len(events),
        "user_entries": recipients,
    }
    logger.info("Checked new episode notifications", extra=result)
    return result
