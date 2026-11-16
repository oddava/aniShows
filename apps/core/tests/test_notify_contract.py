"""The producer API (G4 contract): notify() writes what the create_* shims write.

Each case builds the row once through notify() and once through the matching shim
for a second recipient, so the per-user keys never collide.
"""

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
        notification.notification_type,
        notification.title,
        notification.message,
        notification.data,
        notification.priority,
        notification.dedupe_key,
        notification.group_key,
        notification.actor_id,
    )


class NotifyContractTests(TestCase):
    def setUp(self):
        cache.clear()
        self.recipient = User.objects.create_user("recipient", "r@example.com", "pw-123456")
        self.twin = User.objects.create_user("twin", "t@example.com", "pw-123456")
        self.actor = User.objects.create_user("actor", "a@example.com", "pw-123456")
        category = Category.objects.create(name="General", slug="general")
        self.thread = Thread.objects.create(
            category=category, title="Thread", author=self.recipient, content="Body"
        )
        self.post = Post.objects.create(thread=self.thread, author=self.actor, content="Reply")

    def _same_as(self, via_notify, via_shim):
        self.assertIsNotNone(via_notify)
        self.assertIsNotNone(via_shim)
        self.assertEqual(_row(via_notify), _row(via_shim))

    def test_new_follower_matches_shim(self):
        got = notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor.pk)
        expected = NotificationService.create_new_follower_notification(
            user=self.twin, follower=User.objects.get(pk=self.actor.pk)
        )
        self._same_as(got, expected)
        self.assertEqual(got.dedupe_key, f"follow:{self.actor.pk}")

    def test_forum_reply_matches_shim(self):
        got = notify(
            self.recipient.pk,
            TYPES.FORUM_REPLY,
            actor=self.actor,
            data={"thread_id": self.thread.pk, "post_id": self.post.pk},
        )
        expected = NotificationService.create_forum_reply_notification(
            user=self.twin, thread=self.thread, post=self.post
        )
        self._same_as(got, expected)
        self.assertEqual(got.message, "actor replied to your thread Thread")

    def test_forum_mention_on_thread_matches_shim(self):
        got = notify(
            self.recipient,
            TYPES.FORUM_MENTION,
            actor=self.actor,
            data={"thread_id": self.thread.pk},
        )
        expected = NotificationService.create_forum_mention_notification(
            user=self.twin, author=self.actor, instance=self.thread, is_thread=True
        )
        self._same_as(got, expected)
        self.assertEqual(got.dedupe_key, f"forum_mention:t:{self.thread.pk}")

    def test_badge_awarded_matches_shim(self):
        badge = Badge.objects.create(name="Early Bird", description="First in")
        got = notify(
            self.recipient, TYPES.BADGE_AWARDED, actor=self.actor, data={"badge_id": badge.pk}
        )
        expected = NotificationService.create_badge_awarded_notification(
            user=self.twin, badge=badge, granted_by=self.actor
        )
        self._same_as(got, expected)

    def test_staff_can_award_themselves_a_badge(self):
        badge = Badge.objects.create(name="Self", description="d")
        got = notify(self.actor, TYPES.BADGE_AWARDED, actor=self.actor, data={"badge_id": badge.pk})
        self.assertIsNotNone(got)

    def test_self_notification_is_suppressed(self):
        self.assertIsNone(notify(self.actor, TYPES.NEW_FOLLOWER, actor=self.actor))
        self.assertFalse(Notification.objects.exists())

    def test_missing_object_returns_none_instead_of_raising(self):
        self.assertIsNone(
            notify(self.recipient, TYPES.FORUM_REPLY, actor=self.actor, data={"post_id": 999999})
        )

    def test_unknown_type_returns_none(self):
        self.assertIsNone(notify(self.recipient, "not-a-type", data={}))

    def test_system_notification_takes_its_copy_from_data(self):
        got = notify(self.recipient, TYPES.SYSTEM, data={"message": "Maintenance tonight"})
        self.assertEqual(got.message, "Maintenance tonight")

    def test_explicit_keys_win_over_the_defaults(self):
        got = notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor, dedupe_key="custom")
        self.assertEqual(got.dedupe_key, "custom")

    def test_notify_many_counts_written_rows(self):
        other = User.objects.create_user("other", "o@example.com", "pw-123456")
        written = notify_many(
            [self.recipient.pk, other.pk, self.actor.pk, other.pk],
            TYPES.NEW_FOLLOWER,
            actor=self.actor,
        )
        # The actor is never notified of their own action; duplicates count once.
        self.assertEqual(written, 2)

    def test_retract_removes_the_actor_from_the_review_like_aggregate(self):
        anime = Anime.objects.create(
            title="Retract Anime", slug="retract-anime", anime_type="TV", status="Airing"
        )
        review = Review.objects.create(user=self.recipient, anime=anime, rating=8, text="Good")
        notify(self.recipient, TYPES.REVIEW_LIKE, actor=self.actor, data={"review_id": review.pk})
        self.assertEqual(Notification.objects.count(), 1)

        retract(
            self.recipient,
            TYPES.REVIEW_LIKE,
            actor=self.actor,
            group_key=f"review_like:{review.pk}",
        )
        self.assertFalse(Notification.objects.exists())

    def test_invalidate_unread_counts_forces_a_recount(self):
        NotificationService._set_unread_count_cache(self.recipient.pk, 42)
        invalidate_unread_counts([self.recipient.pk])
        self.assertEqual(NotificationService.get_unread_count_for_user_id(self.recipient.pk), 0)
