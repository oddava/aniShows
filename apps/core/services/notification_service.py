"""In-app notifications: the producer API (``notify``), aggregation, unread counters.

Every write goes through ``_emit``: it suppresses self/inactive/opted-out recipients,
enforces idempotency (``dedupe_key``) and aggregation (``group_key``) with partial
unique indexes, runs in its own savepoint and broadcasts/delivers on commit.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING, Any, Dict

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import DatabaseError, IntegrityError, transaction
from django.utils import timezone

from ...shared.errors import CACHE_ERRORS
from ...shared.logger import logger
from ...shared.media_urls import field_media_url
from ...users.services.avatar_service import get_user_avatar_url
from ..models import Notification
from . import notification_preferences as prefs
from . import notification_types
from .notification_email import email_allowed

if TYPE_CHECKING:
    from collections.abc import Iterable


UNREAD_COUNT_CACHE_TTL_SECONDS = 24 * 60 * 60
# notify_many() hard cap per call for every type except new_episode (mention fan-out).
NOTIFY_MANY_MAX_RECIPIENTS = 50
CLEANUP_BATCH_SIZE = 5000

# What writing a notification row can raise: database errors, plus TypeError /
# ValueError when ``data`` is not JSON-serialisable or a field value is invalid.
# Notifications are a side effect of other actions, so these never propagate.
NOTIFICATION_WRITE_ERRORS = (DatabaseError, TypeError, ValueError)
# Merging into an aggregate also reads payloads written earlier: tolerate an
# old row whose ``data`` is not a dict (AttributeError) or lists likers' ids
# but not their names (IndexError).
NOTIFICATION_MERGE_ERRORS = (*NOTIFICATION_WRITE_ERRORS, AttributeError, IndexError)

TYPES = Notification.NotificationType
# Types whose ``actor`` argument is context (the granter), not who caused the event.
ACTORLESS_TYPES = frozenset({TYPES.BADGE_AWARDED, TYPES.SYSTEM})


def _coerce_id(value) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _forum_target_key(instance, is_thread: bool) -> str:
    return f"t:{instance.id}" if is_thread else f"p:{instance.id}"


# ---------------------------------------------------------------------------
# Payload builders (one per type, shared by notify() and the create_* shims)
# ---------------------------------------------------------------------------


def _anime_payload(anime) -> Dict[str, Any]:
    return {
        "anime_id": anime.id,
        "anime_slug": anime.slug,
        "anime_title": anime.title,
        **NotificationService.get_anime_cover_payload(anime),
    }


def _episode_data(anime, episode_number: int, aired_at=None) -> Dict[str, Any]:
    data = {**_anime_payload(anime), "episode_number": episode_number}
    if aired_at is not None:
        data["aired_at"] = aired_at if isinstance(aired_at, str) else aired_at.isoformat()
    return data


def _liker_data(actor) -> Dict[str, Any]:
    return {
        "liker_username": actor.username,
        "liker_usernames": [actor.username],
        "liker_user_ids": [actor.id],
        "liker_count": 1,
    }


def _review_like_data(actor, review) -> Dict[str, Any]:
    return {"review_id": review.id, **_anime_payload(review.anime), **_liker_data(actor)}


def _review_reply_data(review, comment, replier) -> Dict[str, Any]:
    data = {"review_id": review.id, **_anime_payload(review.anime)}
    if comment is not None:
        data["comment_id"] = comment.id
    data.update({"replier_username": replier.username, "replier_id": replier.id})
    return data


def _follower_data(follower) -> Dict[str, Any]:
    return {
        "follower_id": follower.id,
        "follower_username": follower.username,
        "follower_avatar": get_user_avatar_url(follower),
    }


def _forum_reply_data(thread, post) -> Dict[str, Any]:
    return {
        "thread_id": thread.id,
        "post_id": post.id,
        "replier_username": post.author.username,
        "thread_title": thread.title,
    }


def _forum_threaded_reply_data(reply) -> Dict[str, Any]:
    return {
        "thread_id": reply.thread.id,
        "post_id": reply.id,
        "parent_post_id": reply.parent.id,
        "replier_username": reply.author.username,
        "thread_title": reply.thread.title,
        "is_threaded_reply": True,
    }


def _forum_mention_data(author, instance, is_thread: bool) -> Dict[str, Any]:
    thread = instance if is_thread else instance.thread
    data = {
        "thread_id": thread.id,
        "mentioner_username": author.username,
        "thread_title": thread.title,
        "is_thread": is_thread,
    }
    if not is_thread:
        data["post_id"] = instance.id
    return data


def _forum_like_data(author, instance, is_thread: bool) -> Dict[str, Any]:
    thread = instance if is_thread else instance.thread
    data = {
        "thread_id": thread.id,
        **_liker_data(author),
        "thread_title": thread.title,
        "is_thread": is_thread,
    }
    if not is_thread:
        data["post_id"] = instance.id
    return data


def _badge_data(badge, granted_by) -> Dict[str, Any]:
    return {
        "badge_id": badge.id,
        "badge_name": badge.name,
        "badge_slug": badge.slug,
        "granted_by_username": granted_by.username if granted_by else "System",
    }


def _merge_likers(existing: Dict[str, Any], incoming: Dict[str, Any], actor) -> Dict[str, Any]:
    return NotificationService._merge_actor_payload(
        existing_data=existing,
        base_data={k: v for k, v in incoming.items() if not k.startswith("liker_")},
        actor=actor,
        username_key="liker_username",
        usernames_key="liker_usernames",
        user_ids_key="liker_user_ids",
        count_key="liker_count",
    )


# ---------------------------------------------------------------------------
# The single write path
# ---------------------------------------------------------------------------


def _channel_flags(user, category: str, preferences: prefs.Preferences) -> tuple[bool, bool]:
    """``(push_pending, email_pending)`` decided at write time.

    A channel that is unwanted (or cannot deliver) is stored as already sent, so
    the delivery sweeper only ever sees real work.
    """
    from .push_service import PushService

    push = (
        prefs.wants(preferences, category, prefs.PUSH)
        and PushService.is_configured()
        and PushService.has_active_subscriptions(user.pk)
    )
    email = (
        category == notification_types.EPISODES
        and prefs.wants(preferences, category, prefs.EMAIL)
        and email_allowed(user)
    )
    return push, email


def _after_create(notification: Notification, *, deliver: bool) -> None:
    def run():
        unread_count = NotificationService._increment_unread_count(notification.user_id)
        NotificationService._broadcast_notification(notification, unread_count=unread_count)
        if deliver:
            _enqueue_delivery([notification.pk])

    transaction.on_commit(run)


def _after_merge(notification: Notification, *, deliver: bool) -> None:
    def run():
        NotificationService._broadcast_notification_update(notification)
        if deliver:
            _enqueue_delivery([notification.pk])

    transaction.on_commit(run)


def _enqueue_delivery(notification_ids: list[int]) -> None:
    from .notification_delivery import enqueue_delivery

    enqueue_delivery(notification_ids)


def _emit(
    recipient,
    notification_type: str,
    *,
    actor=None,
    data: Dict[str, Any],
    dedupe_key: str | None = None,
    group_key: str | None = None,
    title: str | None = None,
    message: str | None = None,
    priority: str | None = None,
) -> Notification | None:
    """Write (or merge) one notification for ``recipient`` (a user instance)."""
    kind = notification_types.kind_for(notification_type)
    if kind is None:
        logger.warning("notify(): unknown notification type %s", notification_type)
        return None
    if actor is not None and actor.pk == recipient.pk:
        return None
    if not recipient.is_active:
        return None

    preferences = prefs.get_preferences(recipient.pk)
    if not prefs.wants(preferences, kind.category, prefs.IN_APP):
        return None
    push_pending, email_pending = _channel_flags(recipient, kind.category, preferences)
    deliver = push_pending or email_pending

    for attempt in (1, 2):
        try:
            with transaction.atomic():
                if group_key is not None:
                    existing = (
                        Notification.objects.select_for_update()
                        .filter(user_id=recipient.pk, group_key=group_key, is_read=False)
                        .first()
                    )
                    if existing is not None:
                        if not _merge_is_news(kind, existing, data, dedupe_key):
                            return None
                        merged = _merged_data(kind, existing.data, data, actor)
                        existing.data = merged
                        existing.message = message or kind.message(merged)
                        if actor is not None:
                            existing.actor = actor
                        existing.created_at = timezone.now()
                        existing.is_push_sent = not push_pending
                        existing.is_email_sent = not email_pending
                        fields = ["data", "message", "actor", "created_at"]
                        fields += ["is_push_sent", "is_email_sent"]
                        if dedupe_key is not None:
                            existing.dedupe_key = dedupe_key
                            fields.append("dedupe_key")
                        existing.save(update_fields=fields)
                        _after_merge(existing, deliver=deliver)
                        return existing

                notification = Notification.objects.create(
                    user=recipient,
                    actor=actor,
                    notification_type=notification_type,
                    title=title or kind.title,
                    message=message or kind.message(data),
                    data=data,
                    priority=priority or kind.priority,
                    dedupe_key=dedupe_key,
                    group_key=group_key,
                    is_push_sent=not push_pending,
                    is_email_sent=not email_pending,
                )
                _after_create(notification, deliver=deliver)
                return notification
        except IntegrityError:
            # A concurrent writer created the aggregate first: merge into it once.
            # Otherwise the dedupe key already exists: nothing to do.
            if group_key is not None and attempt == 1:
                continue
            return None
        except NOTIFICATION_MERGE_ERRORS:
            logger.exception(
                "Failed to create %s notification for user %s", notification_type, recipient.pk
            )
            return None
    return None


def _merge_is_news(kind, existing: Notification, incoming: Dict[str, Any], dedupe_key) -> bool:
    """False when merging would only repeat what the aggregate already says."""
    if dedupe_key is not None and existing.dedupe_key == dedupe_key:
        return False
    if kind.type == TYPES.NEW_EPISODE:
        old_episode = _coerce_id((existing.data or {}).get("episode_number"))
        new_episode = _coerce_id(incoming.get("episode_number"))
        if old_episode is not None and new_episode is not None and new_episode <= old_episode:
            return False
    return True


def _merged_data(kind, existing_data, incoming: Dict[str, Any], actor) -> Dict[str, Any]:
    existing = existing_data if isinstance(existing_data, dict) else {}
    if kind.aggregates_actors and actor is not None:
        return _merge_likers(existing, incoming, actor)
    if kind.type == TYPES.NEW_EPISODE:
        return {**incoming, "grouped": True}
    return {**existing, **incoming}


class NotificationService:
    """Service for creating and managing user notifications."""

    @staticmethod
    def _serialize_notification(notification: Notification) -> Dict[str, Any]:
        """Serialize a notification for websocket delivery."""
        return {
            "id": notification.id,
            "notification_type": notification.notification_type,
            "category": notification_types.category_for(notification.notification_type),
            "title": notification.title,
            "message": notification.message,
            "data": notification.data,
            "priority": notification.priority,
            "created_at": notification.created_at.isoformat(),
            "is_read": notification.is_read,
            "url": notification_types.url_for(notification),
        }

    @classmethod
    def get_anime_cover_payload(cls, anime) -> Dict[str, str | None]:
        """Return lightweight cover URLs safe to embed in notification payloads."""
        if anime is None:
            return {}

        external_cover = getattr(anime, "cover_image_external_url", None) or None
        cover = field_media_url(getattr(anime, "cover_image", None)) or external_cover
        small = field_media_url(getattr(anime, "cover_image_small", None)) or cover
        medium = field_media_url(getattr(anime, "cover_image_medium", None)) or cover

        return {
            "anime_cover_image_small": small,
            "anime_cover_image_medium": medium,
            "anime_cover_image": cover,
        }

    @staticmethod
    def _actor_summary(primary_username: str, actor_count: int) -> str:
        return notification_types.actor_summary(primary_username, actor_count)

    @staticmethod
    def _coerce_actor_id(value) -> int | None:
        return _coerce_id(value)

    @classmethod
    def _merge_actor_payload(
        cls,
        *,
        existing_data: Dict[str, Any],
        base_data: Dict[str, Any],
        actor,
        username_key: str,
        usernames_key: str,
        user_ids_key: str,
        count_key: str,
    ) -> Dict[str, Any]:
        actor_id = cls._coerce_actor_id(getattr(actor, "id", None))
        actor_username = getattr(actor, "username", "")

        existing_usernames = [
            username
            for username in existing_data.get(usernames_key, [])
            if isinstance(username, str) and username
        ]
        if (
            not existing_usernames
            and isinstance(existing_data.get(username_key), str)
            and existing_data.get(username_key)
        ):
            existing_usernames = [existing_data[username_key]]

        existing_user_ids = [
            user_id
            for value in existing_data.get(user_ids_key, [])
            if (user_id := cls._coerce_actor_id(value)) is not None
        ]

        merged_usernames = [actor_username] + [
            username for username in existing_usernames if username != actor_username
        ]
        merged_user_ids = []
        if actor_id is not None:
            merged_user_ids.append(actor_id)
        merged_user_ids.extend(user_id for user_id in existing_user_ids if user_id != actor_id)

        actor_count = len(merged_user_ids) if merged_user_ids else len(merged_usernames)

        return {
            **existing_data,
            **base_data,
            username_key: merged_usernames[0],
            usernames_key: merged_usernames,
            user_ids_key: merged_user_ids,
            count_key: actor_count,
        }

    @classmethod
    def create_notification(
        cls,
        user,
        notification_type: str,
        title: str,
        message: str,
        data: Dict[str, Any] | None = None,
        priority: str = "medium",
    ) -> Notification | None:
        """Write a notification with caller-supplied copy (no keys).

        Same suppression, preference and delivery rules as ``notify``.
        """
        return _emit(
            user,
            notification_type,
            data=dict(data or {}),
            title=title,
            message=message,
            priority=priority,
        )

    @staticmethod
    def _send_to_user_group(user_id: int, build_event, what: str) -> None:
        """Send ``build_event()`` to the user's WebSocket channel group.

        Called synchronously from Django views/services: ``async_to_sync`` hands
        the event to the channel layer, and the ASGI server delivers it to the
        connected consumers. The event is built only once a channel layer exists.

        Live delivery is best effort: the channel layer can fail in many ways
        (Redis down, a full channel, an unserialisable payload), and none of
        them may break the action that produced the notification.
        """
        try:
            channel_layer = get_channel_layer()
            if channel_layer is None:
                return
            async_to_sync(channel_layer.group_send)(f"notifications_user_{user_id}", build_event())
        except Exception:
            logger.exception("Failed to broadcast %s via WebSocket", what)

    @classmethod
    def _broadcast_notification(cls, notification, unread_count: int | None = None):
        """Push a new notification to the user's WebSocket channel group."""

        def build_event():
            count = unread_count
            if count is None:
                count = cls.get_unread_count_for_user_id(notification.user_id)
            return {
                "type": "notification.new",
                "notification": cls._serialize_notification(notification),
                "unread_count": count,
            }

        cls._send_to_user_group(notification.user_id, build_event, "notification")

    @classmethod
    def _broadcast_notification_update(cls, notification):
        """Push an updated notification payload to active websocket clients."""
        cls._send_to_user_group(
            notification.user_id,
            lambda: {
                "type": "notification.updated",
                "notification": cls._serialize_notification(notification),
            },
            "notification update",
        )

    @classmethod
    def _broadcast_notification_deleted(
        cls,
        user_id: int,
        notification_id: int,
        unread_count: int | None = None,
    ):
        """Push a deletion/retraction event to active websocket clients."""
        cls._send_to_user_group(
            user_id,
            lambda: {
                "type": "notification.deleted",
                "notification_id": notification_id,
                "unread_count": unread_count,
            },
            "notification deletion",
        )

    @classmethod
    def _broadcast_unread_count(cls, user_id: int, count: int):
        """Push unread-count updates to all active WebSocket sessions for a user."""
        cls._send_to_user_group(
            user_id,
            lambda: {"type": "notification.count_update", "count": max(int(count), 0)},
            "unread count",
        )

    @classmethod
    def _unread_count_cache_key(cls, user_id: int) -> str:
        return f"notifications:unread_count:{user_id}"

    @classmethod
    def _unread_count_ttl(cls) -> int:
        ttl = settings.NOTIFICATION_UNREAD_CACHE_TTL
        try:
            return max(int(ttl), 60)
        except (TypeError, ValueError):
            return UNREAD_COUNT_CACHE_TTL_SECONDS

    @classmethod
    def _set_unread_count_cache(cls, user_id: int, count: int) -> None:
        try:
            cache.set(
                cls._unread_count_cache_key(user_id),
                max(int(count), 0),
                timeout=cls._unread_count_ttl(),
            )
        except CACHE_ERRORS:
            logger.debug("Failed to set unread notification count cache for user %s", user_id)

    @classmethod
    def _count_unread_in_db(cls, user_id: int) -> int:
        return Notification.objects.filter(user_id=user_id, is_read=False).count()

    @classmethod
    def _recount_unread(cls, user_id: int) -> int:
        count = cls._count_unread_in_db(user_id)
        cls._set_unread_count_cache(user_id, count)
        return count

    @classmethod
    def _adjust_unread_count(cls, user_id: int, delta: int) -> int:
        """Apply ``delta`` to a cached counter; a missing/invalid one is recounted.

        Recounting on a miss (instead of ``add(0)`` then ``incr``) keeps the badge
        equal to the database after a TTL expiry or an eviction.
        """
        key = cls._unread_count_cache_key(user_id)
        try:
            value = int(cache.incr(key, delta))
        except ValueError:
            # Missing key (or a non-integer value): rebuild from the source of truth.
            return cls._recount_unread(user_id)
        except CACHE_ERRORS:
            return cls._count_unread_in_db(user_id)
        if value < 0:
            return cls._recount_unread(user_id)
        return value

    @classmethod
    def _increment_unread_count(cls, user_id: int, delta: int = 1) -> int:
        return cls._adjust_unread_count(user_id, delta)

    @classmethod
    def _decrement_unread_count(cls, user_id: int, delta: int = 1) -> int:
        return cls._adjust_unread_count(user_id, -delta)

    @classmethod
    def get_unread_count_for_user_id(cls, user_id: int) -> int:
        key = cls._unread_count_cache_key(user_id)
        try:
            cached = cache.get(key)
            if cached is not None:
                return max(int(cached), 0)
        except (TypeError, ValueError):
            pass
        except CACHE_ERRORS:
            logger.debug("Failed to read unread notification count cache for user %s", user_id)

        return cls._recount_unread(user_id)

    @classmethod
    def mark_as_read(cls, notification_id: int, user) -> bool:
        """Mark a notification as read."""
        queryset = Notification.objects.filter(
            id=notification_id,
            user_id=user.id,
            is_read=False,
        )
        updated = queryset.update(
            is_read=True,
            read_at=timezone.now(),
        )
        if updated:
            unread_count = cls._decrement_unread_count(user.id)
            cls._broadcast_unread_count(user.id, unread_count)
            return True
        exists_queryset = Notification.objects.filter(id=notification_id, user_id=user.id)
        return exists_queryset.exists()

    @classmethod
    def mark_all_as_read(cls, user) -> int:
        """Mark all unread notifications as read for a user."""
        queryset = Notification.objects.filter(user=user, is_read=False)
        count = queryset.update(is_read=True, read_at=timezone.now())
        cls._set_unread_count_cache(user.id, 0)
        cls._broadcast_unread_count(user.id, 0)
        logger.info(f"Marked {count} notifications as read for user {user.id}")
        return count

    @classmethod
    def delete_notification(cls, notification_id: int, user) -> bool:
        """Delete a notification and keep unread counters in sync."""
        try:
            with transaction.atomic():
                notification = (
                    Notification.objects.select_for_update()
                    .only("id", "user_id", "is_read")
                    .get(id=notification_id, user_id=user.id)
                )
                was_unread = not notification.is_read
                notification.delete()

                def notify_after_commit():
                    unread_count = None
                    if was_unread:
                        unread_count = cls._decrement_unread_count(user.id)
                        cls._broadcast_unread_count(user.id, unread_count)
                    cls._broadcast_notification_deleted(user.id, notification_id, unread_count)

                transaction.on_commit(notify_after_commit)
                return True
        except Notification.DoesNotExist:
            return False

    @classmethod
    def get_unread_count(cls, user) -> int:
        """Get count of unread notifications for a user."""
        return cls.get_unread_count_for_user_id(user.id)

    @classmethod
    def cleanup_old_notifications(
        cls,
        days: int = 90,
        unread_days: int = 180,
        batch_size: int = CLEANUP_BATCH_SIZE,
    ) -> int:
        """Delete read rows older than ``days`` and unread rows older than ``unread_days``.

        Deletes in id batches (short locks, bounded memory), then drops the cached
        unread counters of every affected user.
        """
        now = timezone.now()
        read_cutoff = now - timedelta(days=days)
        unread_cutoff = now - timedelta(days=max(unread_days, days))
        filters = (
            {"is_read": True, "created_at__lt": read_cutoff},
            {"is_read": False, "created_at__lt": unread_cutoff},
        )
        deleted_total = 0
        affected_users: set[int] = set()
        for filter_kwargs in filters:
            while True:
                rows = list(
                    Notification.objects.filter(**filter_kwargs)
                    .order_by("id")
                    .values_list("id", "user_id")[:batch_size]
                )
                if not rows:
                    break
                deleted, _ = Notification.objects.filter(id__in=[r[0] for r in rows]).delete()
                deleted_total += deleted
                if not filter_kwargs["is_read"]:
                    affected_users.update(r[1] for r in rows)
                if len(rows) < batch_size:
                    break
        # Deleting read rows never changes an unread count; deleting unread ones does.
        invalidate_unread_counts(affected_users)
        logger.info("Cleaned up %s old notifications", deleted_total)
        return deleted_total

    # --- Legacy producer shims (kept for existing call sites; see notify()) ---

    @classmethod
    def create_new_episode_notification(cls, user, anime, episode_number: int, aired_at=None):
        """Create notification for new episode."""
        return _emit(
            user,
            TYPES.NEW_EPISODE,
            data=_episode_data(anime, episode_number, aired_at),
            dedupe_key=f"new_episode:{anime.id}:{episode_number}",
            group_key=f"new_episode:{anime.id}",
        )

    @classmethod
    def create_review_reply_notification(cls, user, review, comment):
        """Create notification for review reply (no producer exists yet)."""
        return _emit(
            user,
            TYPES.REVIEW_REPLY,
            actor=comment.user,
            data=_review_reply_data(review, comment, comment.user),
            dedupe_key=f"review_reply:{comment.id}",
        )

    @classmethod
    def create_new_follower_notification(cls, user, follower):
        """Create notification for new follower."""
        return _emit(
            user,
            TYPES.NEW_FOLLOWER,
            actor=follower,
            data=_follower_data(follower),
            dedupe_key=f"follow:{follower.id}",
        )

    @classmethod
    def create_forum_reply_notification(cls, user, thread, post):
        """Create notification for forum reply."""
        return _emit(
            user,
            TYPES.FORUM_REPLY,
            actor=post.author,
            data=_forum_reply_data(thread, post),
            dedupe_key=f"forum_reply:{post.id}",
        )

    @classmethod
    def create_forum_reply_to_post_notification(cls, user, reply):
        """Create notification for reply to a specific post (threaded reply)."""
        return _emit(
            user,
            TYPES.FORUM_REPLY,
            actor=reply.author,
            data=_forum_threaded_reply_data(reply),
            dedupe_key=f"forum_reply:{reply.id}",
        )

    @classmethod
    def create_forum_mention_notification(cls, user, author, instance, is_thread=False):
        """Create notification for user mention."""
        return _emit(
            user,
            TYPES.FORUM_MENTION,
            actor=author,
            data=_forum_mention_data(author, instance, is_thread),
            dedupe_key=f"forum_mention:{_forum_target_key(instance, is_thread)}",
        )

    @classmethod
    def create_forum_like_notification(cls, user, author, instance, is_thread=False):
        """Create or merge an aggregated forum like notification."""
        return _emit(
            user,
            TYPES.FORUM_LIKE,
            actor=author,
            data=_forum_like_data(author, instance, is_thread),
            group_key=f"forum_like:{_forum_target_key(instance, is_thread)}",
        )

    @classmethod
    def create_review_like_notification(cls, user, author, review):
        """Create or update an aggregated notification for review likes."""
        return _emit(
            user,
            TYPES.REVIEW_LIKE,
            actor=author,
            data=_review_like_data(author, review),
            group_key=f"review_like:{review.id}",
        )

    @classmethod
    def remove_review_like_from_notification(cls, user, author, review):
        """Remove a user from an unread review-like aggregate after an unlike."""
        return _retract_actor(user.pk, TYPES.REVIEW_LIKE, author, f"review_like:{review.id}")

    @classmethod
    def create_badge_awarded_notification(cls, user, badge, granted_by):
        """Create notification for badge award."""
        # No actor: staff may award themselves a badge and should still hear about it.
        return _emit(
            user,
            TYPES.BADGE_AWARDED,
            data=_badge_data(badge, granted_by),
            dedupe_key=f"badge:{badge.id}",
        )


def _retract_actor(user_id: int, notification_type: str, actor, group_key: str):
    """Drop ``actor`` from the unread aggregate; delete it when nobody is left."""
    kind = notification_types.kind_for(notification_type)
    if kind is None or not kind.aggregates_actors:
        return None
    try:
        with transaction.atomic():
            existing = (
                Notification.objects.select_for_update()
                .filter(user_id=user_id, group_key=group_key, is_read=False)
                .first()
            )
            if existing is None:
                return None

            existing_data = existing.data if isinstance(existing.data, dict) else {}
            actor_id = _coerce_id(getattr(actor, "pk", None))
            actor_username = getattr(actor, "username", None)
            usernames = [
                username
                for username in existing_data.get("liker_usernames", [])
                if isinstance(username, str) and username and username != actor_username
            ]
            user_ids = [
                liker_id
                for value in existing_data.get("liker_user_ids", [])
                if (liker_id := _coerce_id(value)) is not None and liker_id != actor_id
            ]
            liker_count = len(user_ids) if user_ids else len(usernames)
            if liker_count <= 0 or not usernames:
                notification_id = existing.id
                existing.delete()

                def notify_after_commit():
                    unread_count = NotificationService._decrement_unread_count(user_id)
                    NotificationService._broadcast_unread_count(user_id, unread_count)
                    NotificationService._broadcast_notification_deleted(
                        user_id, notification_id, unread_count
                    )

                transaction.on_commit(notify_after_commit)
                return None

            existing_data.update(
                {
                    "liker_username": usernames[0],
                    "liker_usernames": usernames,
                    "liker_user_ids": user_ids,
                    "liker_count": liker_count,
                }
            )
            existing.data = existing_data
            existing.message = kind.message(existing_data)
            if existing.actor_id == actor_id:
                existing.actor_id = user_ids[0] if user_ids else None
            existing.save(update_fields=["message", "data", "actor"])
            transaction.on_commit(
                lambda: NotificationService._broadcast_notification_update(existing)
            )
            return existing
    except NOTIFICATION_MERGE_ERRORS:
        logger.exception("Failed to remove actor from %s notification", notification_type)
        return None


# --- Producer API (G4 contract; overview section 5, spec 4 "Frozen: producer API") ---

_NotifyResult = Notification | None


def _resolve_user(user_or_id):
    """A user instance (with its profile) for a user or a user id; None stays None."""
    if user_or_id is None or hasattr(user_or_id, "pk"):
        return user_or_id
    return get_user_model().objects.select_related("userprofile").get(pk=user_or_id)


def _forum_instance(data: dict):
    """Return ``(instance, is_thread)`` for forum ``data`` (``post_id`` wins over ``thread_id``)."""
    from ...forums.models import Post, Thread

    if data.get("post_id"):
        return Post.objects.select_related("thread", "author").get(pk=data["post_id"]), False
    return Thread.objects.select_related("author").get(pk=data["thread_id"]), True


def _prepare(notification_type: str, actor, data: dict) -> tuple[dict, str | None, str | None]:
    """Load the objects named in ``data``; return ``(payload, dedupe_key, group_key)``."""
    if notification_type == TYPES.NEW_FOLLOWER:
        return _follower_data(actor), f"follow:{actor.id}", None
    if notification_type == TYPES.REVIEW_LIKE:
        from ...animes.models import Review

        review = Review.objects.select_related("anime").get(pk=data["review_id"])
        return _review_like_data(actor, review), None, f"review_like:{review.id}"
    if notification_type == TYPES.REVIEW_REPLY:
        from ...animes.models import Review

        review = Review.objects.select_related("anime").get(pk=data["review_id"])
        payload = _review_reply_data(review, None, actor)
        comment_id = _coerce_id(data.get("comment_id"))
        if comment_id is not None:
            payload["comment_id"] = comment_id
            return payload, f"review_reply:{comment_id}", None
        return payload, None, None
    if notification_type == TYPES.FORUM_REPLY:
        from ...forums.models import Post

        post = Post.objects.select_related("thread", "author", "parent").get(pk=data["post_id"])
        payload = (
            _forum_threaded_reply_data(post)
            if data.get("parent_post_id") and post.parent_id
            else _forum_reply_data(post.thread, post)
        )
        return payload, f"forum_reply:{post.id}", None
    if notification_type == TYPES.FORUM_MENTION:
        instance, is_thread = _forum_instance(data)
        key = f"forum_mention:{_forum_target_key(instance, is_thread)}"
        return _forum_mention_data(actor, instance, is_thread), key, None
    if notification_type == TYPES.FORUM_LIKE:
        instance, is_thread = _forum_instance(data)
        key = f"forum_like:{_forum_target_key(instance, is_thread)}"
        return _forum_like_data(actor, instance, is_thread), None, key
    if notification_type == TYPES.BADGE_AWARDED:
        from ...users.models import Badge

        badge = Badge.objects.get(pk=data["badge_id"])
        return _badge_data(badge, actor), f"badge:{badge.id}", None
    if notification_type == TYPES.NEW_EPISODE:
        from ...animes.models import Anime

        anime = Anime.objects.get(pk=data["anime_id"])
        episode = int(data["episode_number"])
        return (
            _episode_data(anime, episode, data.get("aired_at")),
            f"new_episode:{anime.id}:{episode}",
            f"new_episode:{anime.id}",
        )
    if notification_type == TYPES.SYSTEM:
        return dict(data), None, None
    raise ValueError(f"Unknown notification type: {notification_type}")


def notify(
    recipient,
    type: str,
    *,
    actor=None,
    data: dict | None = None,
    dedupe_key: str | None = None,
    group_key: str | None = None,
) -> _NotifyResult:
    """Notify ``recipient`` (a user or user id) of a ``Notification.NotificationType`` event.

    ``data`` names the objects by id (spec 4, "Required data keys"); title, message,
    category, URL and push policy come from ``notification_types``. Keys default to
    the per-type keys of the contract when omitted.

    Returns the notification (new or merged aggregate), or ``None`` when nothing was
    written: the recipient is the actor or inactive, in-app is off for the category,
    the dedupe key exists, an object in ``data`` is gone, or the write failed (logged).
    Never raises. Safe inside a caller's ``atomic()``; broadcasts and delivery run on
    commit.
    """
    try:
        user = _resolve_user(recipient)
        actor_user = _resolve_user(actor)
        # A badge's "actor" is whoever granted it (staff may grant themselves one).
        emit_actor = None if type in ACTORLESS_TYPES else actor_user
        if emit_actor is not None and emit_actor.pk == user.pk:
            return None
        if not user.is_active:
            return None
        payload, default_dedupe, default_group = _prepare(type, actor_user, dict(data or {}))
        return _emit(
            user,
            type,
            actor=emit_actor,
            data=payload,
            dedupe_key=dedupe_key if dedupe_key is not None else default_dedupe,
            group_key=group_key if group_key is not None else default_group,
        )
    except Exception:
        logger.exception("notify() failed for type %s", type)
        return None


def notify_many(
    recipient_ids,
    type: str,
    *,
    actor=None,
    data: dict | None = None,
    dedupe_key: str | None = None,
    group_key: str | None = None,
) -> int:
    """Notify each distinct recipient; return how many notifications were written.

    Capped at ``NOTIFY_MANY_MAX_RECIPIENTS`` for every type except ``new_episode``.
    """
    try:
        recipients = list(dict.fromkeys(recipient_ids))
        if type != TYPES.NEW_EPISODE and len(recipients) > NOTIFY_MANY_MAX_RECIPIENTS:
            logger.warning(
                "notify_many(%s): %s recipients capped at %s",
                type,
                len(recipients),
                NOTIFY_MANY_MAX_RECIPIENTS,
            )
            recipients = recipients[:NOTIFY_MANY_MAX_RECIPIENTS]
        actor_user = _resolve_user(actor)
    except Exception:
        logger.exception("notify_many() failed for type %s", type)
        return 0
    return sum(
        1
        for recipient in recipients
        if notify(
            recipient,
            type,
            actor=actor_user,
            data=data,
            dedupe_key=dedupe_key,
            group_key=group_key,
        )
        is not None
    )


def retract(
    recipient,
    type: str,
    *,
    actor,
    group_key: str,
) -> None:
    """Remove ``actor`` from ``recipient``'s unread aggregate (likes); delete it if empty."""
    try:
        user_id = getattr(recipient, "pk", recipient)
        _retract_actor(int(user_id), type, _resolve_user(actor), group_key)
    except Exception:
        logger.exception("retract() failed for type %s", type)


def invalidate_unread_counts(user_ids: Iterable[int]) -> None:
    """Forget the cached unread counts; the next read recounts from the database."""
    keys = [NotificationService._unread_count_cache_key(user_id) for user_id in set(user_ids)]
    if not keys:
        return
    try:
        cache.delete_many(keys)
    except CACHE_ERRORS:
        logger.debug("Failed to invalidate unread notification counts for %s users", len(keys))
