"""What each notification type is: category, copy, target URL and push policy.

Producers pass ids in ``data``; everything a user reads (title, message, link) is
built here from the stored ``data``, so producers never write copy.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from ..models import Notification

TYPES_ENUM = Notification.NotificationType

EPISODES = "episodes"
REPLIES = "replies"
LIKES = "likes"
FOLLOWS = "follows"
ACCOUNT = "account"
CATEGORY_KEYS = (EPISODES, REPLIES, LIKES, FOLLOWS, ACCOUNT)

URGENCY_LOW = "low"
URGENCY_NORMAL = "normal"

Data = Mapping[str, Any]


@dataclass(frozen=True)
class PushPolicy:
    ttl: int
    urgency: str
    topic: Callable[[Data, str | None], str | None] = lambda data, group_key: None


def _episode_topic(data: Data, group_key: str | None) -> str | None:
    anime_id = data.get("anime_id")
    return f"ep{anime_id}" if isinstance(anime_id, int) else None


def _group_topic(data: Data, group_key: str | None) -> str | None:
    # Topic: at most 32 chars of the URL-safe base64 alphabet; hex digits qualify.
    return hashlib.sha256(group_key.encode()).hexdigest()[:32] if group_key else None


PUSH_POLICIES: dict[str, PushPolicy] = {
    EPISODES: PushPolicy(ttl=86400, urgency=URGENCY_NORMAL, topic=_episode_topic),
    REPLIES: PushPolicy(ttl=86400, urgency=URGENCY_NORMAL),
    FOLLOWS: PushPolicy(ttl=86400, urgency=URGENCY_LOW),
    LIKES: PushPolicy(ttl=21600, urgency=URGENCY_LOW, topic=_group_topic),
    ACCOUNT: PushPolicy(ttl=604800, urgency=URGENCY_NORMAL),
}


def actor_summary(primary_username: str, actor_count: int) -> str:
    if actor_count <= 1:
        return primary_username
    if actor_count == 2:
        return f"{primary_username} and 1 other"
    return f"{primary_username} and {actor_count - 1} others"


def _text(data: Data, key: str, default: str = "") -> str:
    value = data.get(key)
    return value if isinstance(value, str) else default


def _count(data: Data, key: str) -> int:
    value = data.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else 1


def _episode_message(data: Data) -> str:
    title = _text(data, "anime_title")
    episode = data.get("episode_number")
    if data.get("grouped"):
        return f"New episodes of {title} are out, latest is Episode {episode}"
    return f"Episode {episode} of {title} aired."


def _review_like_message(data: Data) -> str:
    summary = actor_summary(_text(data, "liker_username"), _count(data, "liker_count"))
    return f"{summary} liked your review of {_text(data, 'anime_title')}"


def _forum_reply_message(data: Data) -> str:
    replier = _text(data, "replier_username")
    if data.get("is_threaded_reply"):
        return f"{replier} replied to your post in {_text(data, 'thread_title')}"
    return f"{replier} replied to your thread {_text(data, 'thread_title')}"


def _forum_mention_message(data: Data) -> str:
    item_type = "thread" if data.get("is_thread") else "post"
    return (
        f"{_text(data, 'mentioner_username')} mentioned you in a {item_type} "
        f"in {_text(data, 'thread_title')}"
    )


def _forum_like_message(data: Data) -> str:
    summary = actor_summary(_text(data, "liker_username"), _count(data, "liker_count"))
    title = _text(data, "thread_title")
    if data.get("is_thread"):
        return f"{summary} liked your thread: {title}"
    return f"{summary} liked your post in {title}"


def _anime_url(data: Data) -> str | None:
    slug = _text(data, "anime_slug")
    return f"/anime/{slug}" if slug else None


def _thread_url(data: Data) -> str | None:
    thread_id = data.get("thread_id")
    if isinstance(thread_id, int) and not isinstance(thread_id, bool):
        return f"/forums/thread/{thread_id}"
    return None


def _follower_url(data: Data) -> str | None:
    username = _text(data, "follower_username")
    return f"/u/{username}" if username else None


def same_origin_path(value: Any) -> str | None:
    """``value`` if it is a same-origin absolute path (``/x``, never ``//host``), else None."""
    if isinstance(value, str) and value.startswith("/") and not value.startswith("//"):
        if "\\" not in value and not any(ch.isspace() for ch in value):
            return value
    return None


@dataclass(frozen=True)
class NotificationKind:
    type: str
    category: str
    title: str
    priority: str
    message: Callable[[Data], str]
    url: Callable[[Data], str | None]
    # Aggregates (group_key) keep one unread row and merge each new actor into it.
    aggregates_actors: bool = False

    @property
    def push(self) -> PushPolicy:
        return PUSH_POLICIES[self.category]


TYPES: dict[str, NotificationKind] = {
    kind.type: kind
    for kind in (
        NotificationKind(
            TYPES_ENUM.NEW_EPISODE,
            EPISODES,
            "New Episode",
            "medium",
            _episode_message,
            _anime_url,
        ),
        NotificationKind(
            TYPES_ENUM.REVIEW_REPLY,
            REPLIES,
            "Review Reply",
            "medium",
            lambda d: (
                f"{_text(d, 'replier_username')} replied to your review of "
                f"{_text(d, 'anime_title')}"
            ),
            _anime_url,
        ),
        NotificationKind(
            TYPES_ENUM.REVIEW_LIKE,
            LIKES,
            "Review Like",
            "low",
            _review_like_message,
            _anime_url,
            aggregates_actors=True,
        ),
        NotificationKind(
            TYPES_ENUM.NEW_FOLLOWER,
            FOLLOWS,
            "New Follower",
            "medium",
            lambda d: f"{_text(d, 'follower_username')} started following you",
            _follower_url,
        ),
        NotificationKind(
            TYPES_ENUM.FORUM_REPLY,
            REPLIES,
            "Forum Reply",
            "medium",
            _forum_reply_message,
            _thread_url,
        ),
        NotificationKind(
            TYPES_ENUM.FORUM_MENTION,
            REPLIES,
            "Mentioned",
            "medium",
            _forum_mention_message,
            _thread_url,
        ),
        NotificationKind(
            TYPES_ENUM.FORUM_LIKE,
            LIKES,
            "New Like",
            "low",
            _forum_like_message,
            _thread_url,
            aggregates_actors=True,
        ),
        NotificationKind(
            TYPES_ENUM.BADGE_AWARDED,
            ACCOUNT,
            "Badge Awarded",
            "high",
            lambda d: f"You've been awarded the {_text(d, 'badge_name')} badge!",
            lambda d: "/profile",
        ),
        NotificationKind(
            TYPES_ENUM.SYSTEM,
            ACCOUNT,
            "System",
            "medium",
            lambda d: _text(d, "message"),
            lambda d: same_origin_path(d.get("url")),
        ),
    )
}

TYPES_BY_CATEGORY: dict[str, tuple[str, ...]] = {
    category: tuple(t for t, kind in TYPES.items() if kind.category == category)
    for category in CATEGORY_KEYS
}


def kind_for(notification_type: str) -> NotificationKind | None:
    return TYPES.get(notification_type)


def category_for(notification_type: str) -> str:
    kind = TYPES.get(notification_type)
    return kind.category if kind else ACCOUNT


def url_for(notification: Notification) -> str | None:
    """The same-origin path a notification opens (shared by the API and push)."""
    kind = TYPES.get(notification.notification_type)
    data = notification.data if isinstance(notification.data, dict) else {}
    if kind is None:
        return None
    return same_origin_path(kind.url(data))


def topic_for(notification: Notification) -> str | None:
    kind = TYPES.get(notification.notification_type)
    if kind is None:
        return None
    data = notification.data if isinstance(notification.data, dict) else {}
    return kind.push.topic(data, notification.group_key)
