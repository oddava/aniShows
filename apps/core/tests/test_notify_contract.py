"""The producer API stub (G4 contract) writes what today's create_* methods write."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ...animes.models import Anime, Review
from ...forums.models import Category, Post, Thread
from ...users.models import Badge
from ..models import Notification
from ..services.notification_service import (
    NotificationService,
    invalidate_unread_counts,
    notify,
    notify_many,
    retract,
)

User = get_user_model()
TYPES = Notification.NotificationType


def _row(notification):
    return (
        notification.user_id,
        notification.notification_type,
        notification.title,
        notification.message,
        notification.data,
        notification.priority,
    )


class NotifyContractTests(TestCase):
    def setUp(self):
        cache.clear()
        self.recipient = User.objects.create_user("recipient", "r@example.com", "pw-123456")
        self.actor = User.objects.create_user("actor", "a@example.com", "pw-123456")
        category = Category.objects.create(name="General", slug="general")
        self.thread = Thread.objects.create(
            category=category, title="Thread", author=self.recipient, content="Body"
        )
        self.post = Post.objects.create(thread=self.thread, author=self.actor, content="Reply")

    def _same_as(self, via_notify, via_create):
        self.assertIsNotNone(via_notify)
        self.assertEqual(_row(via_notify), _row(via_create))

    def test_new_follower_matches_create(self):
        # Fresh instances: get_user_avatar_url memoizes on the user object.
        expected = NotificationService.create_new_follower_notification(
            user=self.recipient, follower=User.objects.get(pk=self.actor.pk)
        )
        self._same_as(notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor.pk), expected)

    def test_forum_reply_matches_create(self):
        expected = NotificationService.create_forum_reply_notification(
            user=self.recipient, thread=self.thread, post=self.post
        )
        got = notify(
            self.recipient.pk,
            TYPES.FORUM_REPLY,
            actor=self.actor,
            data={"thread_id": self.thread.pk, "post_id": self.post.pk},
        )
        self._same_as(got, expected)

    def test_forum_mention_on_thread_matches_create(self):
        expected = NotificationService.create_forum_mention_notification(
            user=self.recipient, author=self.actor, instance=self.thread, is_thread=True
        )
        got = notify(
            self.recipient,
            TYPES.FORUM_MENTION,
            actor=self.actor,
            data={"thread_id": self.thread.pk},
        )
        self._same_as(got, expected)

    def test_badge_awarded_matches_create(self):
        badge = Badge.objects.create(name="Early Bird", description="First in")
        expected = NotificationService.create_badge_awarded_notification(
            user=self.recipient, badge=badge, granted_by=self.actor
        )
        got = notify(
            self.recipient, TYPES.BADGE_AWARDED, actor=self.actor, data={"badge_id": badge.pk}
        )
        self._same_as(got, expected)

    def test_self_notification_is_suppressed(self):
        self.assertIsNone(notify(self.actor, TYPES.NEW_FOLLOWER, actor=self.actor))
        self.assertFalse(Notification.objects.exists())

    def test_missing_object_returns_none_instead_of_raising(self):
        self.assertIsNone(
            notify(self.recipient, TYPES.FORUM_REPLY, actor=self.actor, data={"post_id": 999999})
        )

    def test_type_without_producer_returns_none(self):
        self.assertIsNone(notify(self.recipient, TYPES.SYSTEM, data={}))

    def test_keys_are_accepted(self):
        got = notify(
            self.recipient,
            TYPES.NEW_FOLLOWER,
            actor=self.actor,
            dedupe_key=f"follow:{self.actor.pk}",
            group_key="ignored-until-g4",
        )
        self.assertIsNotNone(got)

    def test_notify_many_counts_written_rows(self):
        other = User.objects.create_user("other", "o@example.com", "pw-123456")
        written = notify_many(
            [self.recipient.pk, other.pk, self.actor.pk], TYPES.NEW_FOLLOWER, actor=self.actor
        )
        # The actor is never notified of their own action.
        self.assertEqual(written, 2)

    def test_retract_review_like_delegates(self):
        anime = Anime.objects.create(
            title="Retract Anime", slug="retract-anime", anime_type="TV", status="Airing"
        )
        review = Review.objects.create(user=self.recipient, anime=anime, rating=8, text="Good")
        with patch.object(NotificationService, "remove_review_like_from_notification") as remove:
            retract(
                self.recipient,
                TYPES.REVIEW_LIKE,
                actor=self.actor,
                group_key=f"review_like:{review.pk}",
            )
        remove.assert_called_once_with(user=self.recipient, author=self.actor, review=review)

    def test_invalidate_unread_counts_forces_a_recount(self):
        NotificationService._set_unread_count_cache(self.recipient.pk, 42)
        invalidate_unread_counts([self.recipient.pk])
        self.assertEqual(NotificationService.get_unread_count_for_user_id(self.recipient.pk), 0)
