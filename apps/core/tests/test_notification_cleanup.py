import importlib
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from ..models import Notification
from ..services.notification_service import NotificationService

User = get_user_model()
migration_0010 = importlib.import_module(
    "apps.core.migrations.0010_notifications_dedupe_actor_push"
)


class CleanupTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("old", "old@example.com", "pw-123456")

    def _row(self, days, is_read):
        row = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="t",
            message="m",
            is_read=is_read,
        )
        Notification.objects.filter(pk=row.pk).update(
            created_at=timezone.now() - timedelta(days=days)
        )
        return row

    def test_old_read_and_very_old_unread_rows_go_in_batches(self):
        keep = [self._row(10, True), self._row(100, False)]
        for _ in range(3):
            self._row(91, True)
        self._row(181, False)
        NotificationService._set_unread_count_cache(self.user.pk, 99)

        deleted = NotificationService.cleanup_old_notifications(
            days=90, unread_days=180, batch_size=2
        )

        self.assertEqual(deleted, 4)
        self.assertEqual(
            sorted(Notification.objects.values_list("pk", flat=True)), sorted(r.pk for r in keep)
        )
        # The stale counter was dropped and recounts from the database.
        self.assertEqual(NotificationService.get_unread_count_for_user_id(self.user.pk), 1)


class MigrationBackfillKeyTests(TestCase):
    def test_legacy_rows_map_to_contract_keys(self):
        keys = migration_0010._keys_for
        self.assertEqual(
            keys("new_episode", {"anime_id": 3, "episode_number": 7}),
            ("new_episode:3:7", "new_episode:3", None),
        )
        self.assertEqual(keys("new_follower", {"follower_id": 5}), ("follow:5", None, 5))
        self.assertEqual(
            keys("review_like", {"review_id": 9, "liker_user_ids": [4, 2]}),
            (None, "review_like:9", 4),
        )
        self.assertEqual(
            keys("forum_like", {"thread_id": 1, "post_id": 8, "is_thread": False}),
            (None, "forum_like:p:8", None),
        )
        self.assertEqual(
            keys("forum_like", {"thread_id": 1, "is_thread": True}), (None, "forum_like:t:1", None)
        )
        self.assertEqual(keys("forum_reply", {"replier_id": 6}), (None, None, 6))
        self.assertEqual(keys("system", "not-a-dict"), (None, None, None))

    def test_backfill_keeps_the_earliest_dedupe_and_newest_unread_group(self):
        from django.apps import apps

        user = User.objects.create_user("legacy", "l@example.com", "pw-123456")
        follower = User.objects.create_user("fan", "f@example.com", "pw-123456")

        def make(notification_type, data, is_read=False):
            return Notification.objects.create(
                user=user,
                notification_type=notification_type,
                title="t",
                message="m",
                data=data,
                is_read=is_read,
            )

        # Another user's rows land in a different chunk and keep their own keys.
        Notification.objects.create(
            user=follower,
            notification_type="new_episode",
            title="t",
            message="m",
            data={"anime_id": 1, "episode_number": 2},
        )
        ep_a = make("new_episode", {"anime_id": 1, "episode_number": 2})
        ep_b = make("new_episode", {"anime_id": 1, "episode_number": 2})
        like_old = make("review_like", {"review_id": 4, "liker_user_ids": [follower.pk]})
        like_new = make("review_like", {"review_id": 4, "liker_user_ids": [999999]})
        follow = make("new_follower", {"follower_id": follower.pk})

        # One user per chunk: keys are per user, so chunking must not change the result.
        with patch.object(migration_0010, "USERS_PER_CHUNK", 1):
            migration_0010.backfill_notification_keys(apps, _NoopSchemaEditor())

        rows = {n.pk: n for n in Notification.objects.all()}
        self.assertEqual(rows[ep_a.pk].dedupe_key, "new_episode:1:2")
        self.assertIsNone(rows[ep_b.pk].dedupe_key)
        self.assertEqual(rows[ep_b.pk].group_key, "new_episode:1")
        self.assertIsNone(rows[ep_a.pk].group_key)
        self.assertIsNone(rows[like_old.pk].group_key)
        self.assertEqual(rows[like_new.pk].group_key, "review_like:4")
        self.assertEqual(rows[like_old.pk].actor_id, follower.pk)
        self.assertIsNone(rows[like_new.pk].actor_id)  # unknown user ids are not linked
        self.assertEqual(rows[follow.pk].actor_id, follower.pk)
        self.assertEqual(Notification.objects.get(user=follower).dedupe_key, "new_episode:1:2")


class _NoopSchemaEditor:
    class connection:  # noqa: N801 - mimics schema_editor.connection
        vendor = "sqlite"

    def execute(self, sql):  # pragma: no cover - only called on PostgreSQL
        raise AssertionError(sql)
