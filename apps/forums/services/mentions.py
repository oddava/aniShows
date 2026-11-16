"""``@username`` mentions in forum threads and posts (spec 5 P0-10)."""

import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models.functions import Lower

from ...core.services.notification_service import notify
from ..models import Post, Thread

User = get_user_model()

# ``@name`` not preceded by a word character, ``-`` or ``.`` (so not inside
# ``a@b.com`` or ``x.com/@u``-style text). The frontend mirrors this pattern.
MENTION_PATTERN = re.compile(r"(?<![A-Za-z0-9_.\-])@([A-Za-z0-9_]+)")


def extract_mentions(text: str) -> list[str]:
    """Distinct lower-cased usernames mentioned in ``text``, in order of first use."""
    return list(dict.fromkeys(name.lower() for name in MENTION_PATTERN.findall(text or "")))


def resolve_mentioned_users(text: str, *, author, previous_text: str | None = None) -> list:
    """Active users to notify for the mentions in ``text``.

    The author is never included, at most ``FORUM_MAX_MENTIONS_PER_POST`` names are
    looked up, and when ``previous_text`` is given (an edit) only names it did not
    already mention count.
    """
    already_mentioned = set(extract_mentions(previous_text)) if previous_text is not None else set()
    author_name = author.username.lower()
    names = [
        name
        for name in extract_mentions(text)
        if name != author_name and name not in already_mentioned
    ][: settings.FORUM_MAX_MENTIONS_PER_POST]
    if not names:
        return []
    return list(
        User.objects.annotate(_username_lower=Lower("username")).filter(
            _username_lower__in=names, is_active=True
        )
    )


def notify_mentions(author, instance: Thread | Post, *, previous_text: str | None = None) -> None:
    """Send one ``forum_mention`` notification per newly mentioned user."""
    users = resolve_mentioned_users(instance.content, author=author, previous_text=previous_text)
    if not users:
        return
    if isinstance(instance, Thread):
        data = {"thread_id": instance.id}
        dedupe_key = f"forum_mention:t:{instance.id}"
    else:
        data = {"thread_id": instance.thread_id, "post_id": instance.id}
        dedupe_key = f"forum_mention:p:{instance.id}"
    for user in users:
        notify(user, "forum_mention", actor=author, data=data, dedupe_key=dedupe_key)
