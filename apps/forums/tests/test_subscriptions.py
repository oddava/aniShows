"""Thread subscriptions and the subscriber fan-out (spec 5 P1-3). Celery runs eagerly in tests."""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from ...core.models import Notification
from ..models import ThreadSubscription
from .conftest import make_reply

POSTS_URL = reverse("forums:post-list")


def _subscription_url(thread):
    return reverse("forums:thread-subscription", args=[thread.id])


def _replies_to(user):
    return Notification.objects.filter(
        user=user, notification_type=Notification.NotificationType.FORUM_REPLY
    )


@pytest.fixture
def post_reply(api_for, django_capture_on_commit_callbacks):
    def _post(user, thread, parent=None, content="reply"):
        payload = {"thread": thread.id, "content": content}
        if parent is not None:
            payload["parent"] = parent.id
        with django_capture_on_commit_callbacks(execute=True):
            response = api_for(user).post(POSTS_URL, payload, format="json")
        assert response.status_code == 201, response.data
        return response.data

    return _post


@pytest.mark.django_db
def test_author_is_subscribed_on_create(make_user, api_for, forum_category):
    author = make_user()

    created = api_for(author).post(
        reverse("forums:thread-list"),
        {"category": forum_category.id, "title": "T", "content": "c"},
        format="json",
    )

    assert created.status_code == 201
    assert created.data["is_subscribed"] is True
    thread_url = reverse("forums:thread-detail", args=[created.data["id"]])
    assert api_for(author).get(thread_url).data["is_subscribed"] is True
    assert APIClient().get(thread_url).data["is_subscribed"] is False


@pytest.mark.django_db
def test_subscribe_and_unsubscribe_endpoint(make_user, make_thread, api_for):
    thread = make_thread(make_user())
    reader = make_user()
    client = api_for(reader)

    assert client.post(_subscription_url(thread)).data == {"is_subscribed": True}
    assert client.post(_subscription_url(thread)).data == {"is_subscribed": True}
    assert ThreadSubscription.objects.filter(user=reader, thread=thread).count() == 1
    assert client.delete(_subscription_url(thread)).data == {"is_subscribed": False}
    assert not ThreadSubscription.objects.filter(user=reader, thread=thread).exists()
    assert APIClient().post(_subscription_url(thread)).status_code == 401


@pytest.mark.django_db
def test_replier_is_subscribed_only_on_their_first_post(
    make_user, make_thread, api_for, post_reply
):
    thread = make_thread(make_user())
    replier = make_user()

    post_reply(replier, thread)
    assert ThreadSubscription.objects.filter(user=replier, thread=thread).exists()
    api_for(replier).delete(_subscription_url(thread))
    post_reply(replier, thread)

    assert not ThreadSubscription.objects.filter(user=replier, thread=thread).exists()


@pytest.mark.django_db
def test_each_subscriber_is_notified_once_and_never_the_replier(make_user, make_thread, post_reply):
    author, follower, parent_author, replier = (make_user() for _ in range(4))
    thread = make_thread(author)
    ThreadSubscription.objects.create(user=author, thread=thread)
    ThreadSubscription.objects.create(user=follower, thread=thread)
    parent = make_reply(thread, parent_author)
    ThreadSubscription.objects.create(user=parent_author, thread=thread)

    post_reply(replier, thread, parent=parent)

    # parent_author: one direct "parent" reply, not a second subscription one.
    assert [n.data.get("parent_post_id") for n in _replies_to(parent_author)] == [parent.id]
    assert _replies_to(author).count() == 1
    assert _replies_to(follower).count() == 1
    assert not _replies_to(replier).exists()


@pytest.mark.django_db
def test_top_level_reply_does_not_double_notify_the_thread_author(
    make_user, make_thread, post_reply
):
    author, replier = make_user(), make_user()
    thread = make_thread(author)
    ThreadSubscription.objects.create(user=author, thread=thread)

    post_reply(replier, thread)

    assert _replies_to(author).count() == 1


@pytest.mark.django_db
def test_mentioned_subscriber_gets_only_the_mention(make_user, make_thread, post_reply):
    thread = make_thread(make_user())
    mentioned = make_user("mentioned")
    ThreadSubscription.objects.create(user=mentioned, thread=thread)

    post_reply(make_user(), thread, content="hey @mentioned")

    assert not _replies_to(mentioned).exists()
    assert Notification.objects.filter(
        user=mentioned, notification_type=Notification.NotificationType.FORUM_MENTION
    ).exists()


@pytest.mark.django_db
def test_unsubscribe_stops_notifications(make_user, make_thread, api_for, post_reply):
    thread = make_thread(make_user())
    follower = make_user()
    api_for(follower).post(_subscription_url(thread))
    api_for(follower).delete(_subscription_url(thread))

    post_reply(make_user(), thread)

    assert not _replies_to(follower).exists()


@pytest.mark.django_db
def test_fan_out_is_capped(make_user, make_thread, post_reply, settings):
    settings.FORUM_SUBSCRIPTION_FANOUT_CAP = 2
    thread = make_thread(make_user())
    followers = [make_user() for _ in range(3)]
    for follower in followers:
        ThreadSubscription.objects.create(user=follower, thread=thread)

    post_reply(make_user(), thread)

    notified = Notification.objects.filter(
        user__in=followers, notification_type=Notification.NotificationType.FORUM_REPLY
    )
    assert notified.count() == 2


@pytest.mark.django_db
def test_locked_thread_does_not_notify_subscribers(make_user, make_thread, post_reply):
    thread = make_thread(make_user(), is_locked=True)
    follower = make_user()
    ThreadSubscription.objects.create(user=follower, thread=thread)

    post_reply(make_user("mod", is_staff=True), thread)

    assert not _replies_to(follower).exists()
