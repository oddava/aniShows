"""Producer API semantics: suppression, preferences, idempotency, aggregation, on-commit."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.db.models import QuerySet
from django.test import TestCase, override_settings

from ...animes.models import Anime, Review
from ...forums.models import Category, Thread
from ..models import Notification, PushSubscription
from ..services import notification_preferences
from ..services.notification_service import (
    NOTIFY_MANY_MAX_RECIPIENTS,
    NotificationService,
    notify,
    notify_many,
)

User = get_user_model()
TYPES = Notification.NotificationType
VAPID = {"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv"}
ENQUEUE = "apps.core.services.notification_delivery.enqueue_delivery"


class NotifyApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.recipient = User.objects.create_user("recipient", "r@example.com", "pw-123456")
        self.actor = User.objects.create_user("actor", "a@example.com", "pw-123456")
        self.anime = Anime.objects.create(
            title="Frieren", slug="frieren", anime_type="TV", status="Airing"
        )
        self.review = Review.objects.create(
            user=self.recipient, anime=self.anime, rating=9, text="Great"
        )

    def _like(self, actor):
        return notify(
            self.recipient, TYPES.REVIEW_LIKE, actor=actor, data={"review_id": self.review.pk}
        )

    def test_inactive_recipient_is_suppressed(self):
        self.recipient.is_active = False
        self.recipient.save(update_fields=["is_active"])
        self.assertIsNone(notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor))
        self.assertFalse(Notification.objects.exists())

    def test_in_app_off_writes_no_row(self):
        notification_preferences.update_preferences(
            self.recipient.pk, {"follows": {"in_app": False}}
        )
        self.assertIsNone(notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor))
        self.assertFalse(Notification.objects.exists())

    def test_account_category_is_locked_on(self):
        with self.assertRaises(notification_preferences.PreferenceError):
            notification_preferences.update_preferences(
                self.recipient.pk, {"account": {"in_app": False}}
            )
        # Even a hand-edited row cannot switch it off.
        notification_preferences.NotificationPreference.objects.update_or_create(
            user=self.recipient, defaults={"preferences": {"account": {"in_app": False}}}
        )
        self.assertIsNotNone(notify(self.recipient, TYPES.SYSTEM, data={"message": "hi"}))

    def test_dedupe_returns_none_and_keeps_one_row(self):
        self.assertIsNotNone(notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor))
        self.assertIsNone(notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor))
        self.assertEqual(Notification.objects.count(), 1)

    def test_group_merge_updates_message_and_count(self):
        other = User.objects.create_user("other", "o@example.com", "pw-123456")
        first = self._like(self.actor)
        second = self._like(other)
        self.assertEqual(first.pk, second.pk)
        row = Notification.objects.get()
        self.assertEqual(row.data["liker_count"], 2)
        self.assertEqual(row.message, "other and 1 other liked your review of Frieren")
        self.assertEqual(row.actor_id, other.pk)

    def test_read_aggregate_starts_a_new_row(self):
        first = self._like(self.actor)
        NotificationService.mark_as_read(first.pk, self.recipient)
        other = User.objects.create_user("other", "o@example.com", "pw-123456")
        self.assertNotEqual(self._like(other).pk, first.pk)
        self.assertEqual(Notification.objects.count(), 2)

    def test_race_on_a_missing_aggregate_becomes_a_merge(self):
        """Two first likes at once: the loser's insert conflicts and merges instead."""
        competitor = self._like(self.actor)
        other = User.objects.create_user("other", "o@example.com", "pw-123456")
        real_first = QuerySet.first
        seen = {"notification_selects": 0}

        def first_missing_once(queryset):
            if queryset.model is Notification:
                seen["notification_selects"] += 1
                if seen["notification_selects"] == 1:
                    return None  # the competitor isn't visible yet
            return real_first(queryset)

        with patch.object(QuerySet, "first", first_missing_once):
            merged = self._like(other)

        self.assertEqual(merged.pk, competitor.pk)
        self.assertEqual(Notification.objects.get().data["liker_count"], 2)

    def test_dedupe_conflict_inside_an_outer_atomic_leaves_it_usable(self):
        notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor)
        with transaction.atomic():
            self.assertIsNone(notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor))
            # The outer transaction still works after the savepoint rolled back.
            self.assertEqual(Notification.objects.count(), 1)

    def test_broadcast_fires_once_on_commit(self):
        with patch.object(NotificationService, "_broadcast_notification") as broadcast:
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor)
                broadcast.assert_not_called()
            for callback in callbacks:
                callback()
        broadcast.assert_called_once()

    def test_unread_count_follows_writes(self):
        with self.captureOnCommitCallbacks(execute=True):
            notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor)
        self.assertEqual(NotificationService.get_unread_count(self.recipient), 1)

    def test_notify_many_caps_recipients(self):
        users = [
            User.objects.create_user(f"fan{i}", f"fan{i}@example.com", "pw-123456")
            for i in range(NOTIFY_MANY_MAX_RECIPIENTS + 5)
        ]
        category = Category.objects.create(name="General", slug="general")
        thread = Thread.objects.create(
            category=category, title="Thread", author=self.actor, content="@everyone"
        )
        written = notify_many(
            [u.pk for u in users],
            TYPES.FORUM_MENTION,
            actor=self.actor,
            data={"thread_id": thread.pk},
        )
        self.assertEqual(written, NOTIFY_MANY_MAX_RECIPIENTS)

    def test_push_is_marked_done_when_nothing_can_deliver_it(self):
        notification = notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor)
        self.assertTrue(notification.is_push_sent)
        self.assertTrue(notification.is_email_sent)

    @override_settings(**VAPID)
    def test_delivery_is_enqueued_on_commit_for_a_subscribed_device(self):
        PushSubscription.objects.create(
            user=self.recipient, endpoint="https://push.example.com/x", p256dh="k", auth="a"
        )
        with patch(ENQUEUE) as enqueue, self.captureOnCommitCallbacks(execute=True):
            notification = notify(self.recipient, TYPES.NEW_FOLLOWER, actor=self.actor)
        self.assertFalse(notification.is_push_sent)
        enqueue.assert_called_once_with([notification.pk])

    @override_settings(**VAPID)
    def test_likes_do_not_push_by_default(self):
        PushSubscription.objects.create(
            user=self.recipient, endpoint="https://push.example.com/x", p256dh="k", auth="a"
        )
        with patch(ENQUEUE) as enqueue, self.captureOnCommitCallbacks(execute=True):
            notification = self._like(self.actor)
        self.assertTrue(notification.is_push_sent)
        enqueue.assert_not_called()

    def test_episode_email_is_pending_only_for_verified_addresses(self):
        unverified = notify(
            self.recipient, TYPES.NEW_EPISODE, data={"anime_id": self.anime.pk, "episode_number": 1}
        )
        self.assertTrue(unverified.is_email_sent)

        profile = self.actor.userprofile
        profile.email_verified = True
        profile.save(update_fields=["email_verified"])
        with patch(ENQUEUE):
            verified = notify(
                self.actor.pk,
                TYPES.NEW_EPISODE,
                data={"anime_id": self.anime.pk, "episode_number": 1},
            )
        self.assertFalse(verified.is_email_sent)

    def test_new_episode_rolls_an_unread_row_forward(self):
        data = {"anime_id": self.anime.pk, "episode_number": 6}
        first = notify(self.recipient, TYPES.NEW_EPISODE, data=data)
        rolled = notify(self.recipient, TYPES.NEW_EPISODE, data={**data, "episode_number": 7})
        self.assertEqual(first.pk, rolled.pk)
        rolled.refresh_from_db()
        self.assertEqual(rolled.dedupe_key, f"new_episode:{self.anime.pk}:7")
        self.assertTrue(rolled.data["grouped"])
        self.assertEqual(rolled.message, "New episodes of Frieren are out, latest is Episode 7")
        # A repeat (or an older episode) changes nothing.
        self.assertIsNone(notify(self.recipient, TYPES.NEW_EPISODE, data=data))
        self.assertEqual(Notification.objects.count(), 1)
