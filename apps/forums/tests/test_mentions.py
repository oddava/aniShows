"""Mention notifications: cap, active users, no self-mentions, edit diff (spec 5 P0-10)."""

import pytest
from django.urls import reverse

from ...core.models import Notification
from ..services.mentions import extract_mentions
from .conftest import make_reply

MENTION = Notification.NotificationType.FORUM_MENTION


def _mentions():
    return Notification.objects.filter(notification_type=MENTION)


@pytest.mark.django_db
def test_fifteen_mentions_notify_ten(
    make_user, api_for, forum_category, django_capture_on_commit_callbacks
):
    names = [make_user(f"fan{i}").username for i in range(15)]
    author = make_user()

    with django_capture_on_commit_callbacks(execute=True):
        response = api_for(author).post(
            reverse("forums:thread-list"),
            {
                "category": forum_category.id,
                "title": "Hi",
                "content": " ".join(f"@{name}" for name in names),
            },
            format="json",
        )

    assert response.status_code == 201
    assert _mentions().count() == 10
    assert set(_mentions().values_list("user__username", flat=True)) == set(names[:10])


@pytest.mark.django_db
def test_self_inactive_and_email_mentions_are_ignored(
    make_user, make_thread, api_for, django_capture_on_commit_callbacks
):
    author = make_user("writer")
    make_user("ghost", is_active=False)
    make_user("friend")
    thread = make_thread(author)

    with django_capture_on_commit_callbacks(execute=True):
        api_for(author).post(
            reverse("forums:post-list"),
            {"thread": thread.id, "content": "@writer @ghost mail me@friend.com @FRIEND @friend"},
            format="json",
        )

    assert list(_mentions().values_list("user__username", "data__is_thread")) == [("friend", False)]


@pytest.mark.django_db
def test_edit_notifies_only_newly_added_mentions(
    make_user, make_thread, api_for, django_capture_on_commit_callbacks
):
    author = make_user()
    make_user("old")
    make_user("new")
    post = make_reply(make_thread(author), author, content="hi @old")

    with django_capture_on_commit_callbacks(execute=True):
        response = api_for(author).patch(
            reverse("forums:post-detail", args=[post.id]),
            {"content": "hi @old and @new"},
            format="json",
        )

    assert response.status_code == 200
    assert list(_mentions().values_list("user__username", flat=True)) == ["new"]


def test_extract_mentions_is_distinct_and_ordered():
    assert extract_mentions("@b @a @B x@c a.@d (@e)") == ["b", "a", "e"]
