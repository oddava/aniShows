"""Episode notification emails: gating, escaped HTML, one-click unsubscribe tokens."""

from __future__ import annotations

from urllib.parse import quote, urlencode

from django.conf import settings
from django.core import signing
from django.utils.html import format_html

from ..models import Notification
from .notification_types import EPISODES

UNSUBSCRIBE_SALT = "core.notifications.email-unsubscribe"
EMAIL_CATEGORIES = frozenset({EPISODES})

# Brand: violet accents on a near-black header (same palette as the app).
_HEADER_BG = "#110919"
_LINK = "#8b5cf6"
_BUTTON = "#7c3aed"


def make_unsubscribe_token(user_id: int, category: str = EPISODES) -> str:
    """A signed, non-expiring token that turns ``category`` email off for ``user_id``."""
    return signing.dumps({"u": user_id, "c": category}, salt=UNSUBSCRIBE_SALT)


def read_unsubscribe_token(token: str) -> tuple[int, str]:
    """Return ``(user_id, category)``; raises ``signing.BadSignature`` when invalid."""
    payload = signing.loads(token, salt=UNSUBSCRIBE_SALT)
    if not isinstance(payload, dict):
        raise signing.BadSignature("Malformed unsubscribe token.")
    user_id, category = payload.get("u"), payload.get("c")
    if (
        not isinstance(user_id, int)
        or isinstance(user_id, bool)
        or category not in EMAIL_CATEGORIES
    ):
        raise signing.BadSignature("Malformed unsubscribe token.")
    return user_id, category


def email_allowed(user) -> bool:
    """Only active users with a verified address ever get notification email."""
    if not user.is_active or not user.email:
        return False
    profile = getattr(user, "userprofile", None)
    return bool(profile and profile.email_verified)


def _frontend(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def build_episode_email(notification: Notification) -> dict:
    """``{subject, message, html_message, headers}`` for ``send_email_task``."""
    data = notification.data if isinstance(notification.data, dict) else {}
    slug = data.get("anime_slug") if isinstance(data.get("anime_slug"), str) else ""
    anime_url = _frontend(f"/anime/{quote(slug)}") if slug else _frontend("/notifications")
    token = make_unsubscribe_token(notification.user_id, EPISODES)
    unsubscribe_page = _frontend(f"/notifications/unsubscribe?{urlencode({'token': token})}")
    manage_url = _frontend("/settings?tab=notifications")
    # One-click (RFC 8058): mail clients POST to this URL; the API is same-origin.
    one_click = _frontend(f"/api/v1/notifications/email-unsubscribe/?{urlencode({'token': token})}")

    text = (
        f"{notification.message}\n\n"
        f"Watch now: {anime_url}\n\n"
        "You're receiving this because this anime is in your list.\n"
        f"Manage notifications: {manage_url}\n"
        f"Unsubscribe from episode emails: {unsubscribe_page}\n"
    )
    html = format_html(
        '<html><body style="margin:0;padding:0;background:#f4f4f5;'
        'font-family:Arial,Helvetica,sans-serif;">'
        '<div style="max-width:600px;margin:0 auto;">'
        '<div style="background:{header};color:#ffffff;padding:20px;text-align:center;">'
        '<h1 style="margin:0;font-size:22px;">AniShows</h1></div>'
        '<div style="padding:24px;background:#ffffff;">'
        '<h2 style="color:#18181b;margin:0 0 12px;">{title}</h2>'
        '<p style="color:#3f3f46;font-size:16px;line-height:1.5;">{message}</p>'
        '<div style="text-align:center;margin:28px 0;">'
        '<a href="{anime_url}" style="background:{button};color:#ffffff;padding:12px 28px;'
        'text-decoration:none;border-radius:8px;display:inline-block;">Watch now</a>'
        "</div></div>"
        '<div style="padding:16px;text-align:center;font-size:12px;color:#71717a;">'
        "<p>You're receiving this because this anime is in your list.</p>"
        '<p><a href="{manage_url}" style="color:{link};">Manage notifications</a>'
        " &middot; "
        '<a href="{unsubscribe_url}" style="color:{link};">Unsubscribe from episode emails</a>'
        "</p></div></div></body></html>",
        header=_HEADER_BG,
        title=notification.title,
        message=notification.message,
        anime_url=anime_url,
        button=_BUTTON,
        manage_url=manage_url,
        link=_LINK,
        unsubscribe_url=unsubscribe_page,
    )
    return {
        "subject": notification.title,
        "message": text,
        "html_message": str(html),
        "headers": {
            "List-Unsubscribe": f"<{one_click}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    }


def send_notification_email(notification: Notification) -> bool:
    """Queue the email for a notification; True when one was queued."""
    from ...users.services.email_service import send_email_task

    if notification.notification_type != Notification.NotificationType.NEW_EPISODE:
        return False
    if not email_allowed(notification.user):
        return False
    send_email_task.delay(
        recipient_list=[notification.user.email], **build_episode_email(notification)
    )
    return True
