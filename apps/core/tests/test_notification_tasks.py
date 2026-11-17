from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from ...animes.models import Anime
from ...users.models import UserAnimeList
from ..models import Notification, PushSubscription
from ..services.push_service import PushResult
from ..tasks.notifications import (
    check_new_episodes,
    cleanup_old_notifications_task,
    deliver_notifications,
    send_pending_notifications,
)

User = get_user_model()
TYPES = Notification.NotificationType
VAPID = {"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv"}
SEND = "apps.core.services.notification_delivery.PushService.send_notification"
EMAIL = "apps.users.services.email_service.send_email_task.delay"


def _aged(notification, minutes):
    Notification.objects.filter(pk=notification.pk).update(
        created_at=timezone.now() - timedelta(minutes=minutes)
    )


@override_settings(**VAPID)
class TestSendPendingNotifications(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="notif_task_user", email="notif-task@example.com", password="password123"
        )
        PushSubscription.objects.create(
            user=self.user, endpoint="https://push.example.com/a", p256dh="k", auth="a"
        )

    def _pending(self, **kwargs):
        notification = Notification.objects.create(
            user=self.user,
            notification_type=kwargs.pop("notification_type", TYPES.NEW_FOLLOWER),
            title=kwargs.pop("title", "New Follower"),
            message="Someone followed you",
            is_push_sent=False,
            is_email_sent=kwargs.pop("is_email_sent", True),
            **kwargs,
        )
        _aged(notification, 5)
        return notification

    @patch(EMAIL)
    @patch(SEND, return_value=PushResult.SENT)
    def test_push_notifications_are_not_resent_on_subsequent_runs(self, mock_send, mock_email):
        notification = self._pending()

        send_pending_notifications()
        notification.refresh_from_db()
        self.assertTrue(notification.is_push_sent)
        self.assertEqual(mock_send.call_count, 1)

        send_pending_notifications()
        self.assertEqual(mock_send.call_count, 1)
        mock_email.assert_not_called()

    @patch(SEND)
    def test_sends_before_a_crash_are_not_repeated_by_the_retry(self, mock_send):
        """Each channel is claimed before its send, so a crash never re-sends."""
        first, second = self._pending(title="one"), self._pending(title="two")
        mock_send.side_effect = [PushResult.SENT, SystemExit("worker lost")]
        with self.assertRaises(SystemExit):
            send_pending_notifications()

        mock_send.side_effect = None
        mock_send.return_value = PushResult.SENT
        send_pending_notifications()

        sent = [call.args[0].pk for call in mock_send.call_args_list]
        # Delivered once each; the row in flight during the crash is lost, never doubled.
        self.assertLessEqual(max(sent.count(first.pk), sent.count(second.pk)), 1)

    @patch(SEND, return_value=PushResult.RETRY)
    def test_transient_failure_keeps_the_row_pending(self, _mock_send):
        notification = self._pending()
        send_pending_notifications()
        notification.refresh_from_db()
        self.assertFalse(notification.is_push_sent)

    @patch(SEND, return_value=PushResult.SENT)
    def test_sweeper_skips_fresh_rows_and_expires_old_ones(self, mock_send):
        fresh = Notification.objects.create(
            user=self.user,
            notification_type=TYPES.NEW_FOLLOWER,
            title="t",
            message="m",
            is_push_sent=False,
            is_email_sent=True,
        )
        old = self._pending()
        _aged(old, 25 * 60)

        result = send_pending_notifications()

        mock_send.assert_not_called()
        self.assertEqual(result["expired"], 1)
        fresh.refresh_from_db()
        old.refresh_from_db()
        self.assertFalse(fresh.is_push_sent)
        self.assertTrue(old.is_push_sent)

    @patch(SEND, return_value=PushResult.SENT)
    def test_task_and_sweeper_racing_produce_one_send(self, mock_send):
        notification = self._pending()
        deliver_notifications([notification.pk])
        send_pending_notifications()
        deliver_notifications([notification.pk])
        self.assertEqual(mock_send.call_count, 1)

    @patch(SEND)
    def test_push_turned_off_after_notify_is_not_sent(self, mock_send):
        from ..services import notification_preferences

        notification = self._pending()
        notification_preferences.update_preferences(self.user.pk, {"follows": {"push": False}})
        deliver_notifications([notification.pk])
        mock_send.assert_not_called()
        notification.refresh_from_db()
        self.assertTrue(notification.is_push_sent)

    @patch(
        "apps.core.services.notification_tasks_service.NotificationTaskService.send_pending_notifications"
    )
    def test_overlapping_run_is_skipped(self, mock_send):
        cache.add("notifications:send-pending:lock", "other-worker", timeout=60)

        result = send_pending_notifications()

        self.assertEqual(result["status"], "skipped")
        mock_send.assert_not_called()

    def test_cleanup_task_uses_the_batched_service(self):
        with patch(
            "apps.core.services.notification_tasks_service.NotificationService.cleanup_old_notifications",
            return_value=3,
        ) as cleanup:
            result = cleanup_old_notifications_task(days=90)
        cleanup.assert_called_once_with(days=90, unread_days=180, batch_size=5000)
        self.assertEqual(result["deleted"], 3)


class TestCheckNewEpisodes(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="watching_user", email="watching@example.com", password="password123"
        )

    def _create_anime(self, **overrides):
        data = {
            "title": overrides.pop("title", "Recent Airing Anime"),
            "slug": overrides.pop("slug", "recent-airing-anime"),
            "synopsis": overrides.pop("synopsis", "Synopsis"),
            "status": overrides.pop("status", Anime.AnimeStatus.airing),
        }
        data.update(overrides)
        return Anime.objects.create(**data)

    def _watch(self, anime):
        UserAnimeList.objects.create(
            user=self.user, anime=anime, status=UserAnimeList.UserAnimeStatus.watching
        )

    def test_creates_notification_from_confirmed_last_aired_episode_for_watching_user(self):
        anime = self._create_anime(
            last_aired_episode=7,
            last_aired_at=timezone.now() - timedelta(hours=2),
            next_airing_episode=8,
            next_airing_date=timezone.now() + timedelta(days=7),
        )
        self._watch(anime)

        result = check_new_episodes()

        self.assertEqual(result["notifications_created"], 1)
        notification = Notification.objects.get(user=self.user, notification_type=TYPES.NEW_EPISODE)
        self.assertEqual(notification.data["anime_id"], anime.id)
        self.assertEqual(notification.data["episode_number"], 7)
        self.assertIn("aired_at", notification.data)

    def test_falls_back_to_current_past_airing_snapshot_before_schedule_advances(self):
        anime = self._create_anime(
            next_airing_episode=1, next_airing_date=timezone.now() - timedelta(hours=1)
        )
        self._watch(anime)

        result = check_new_episodes()

        self.assertEqual(result["notifications_created"], 1)
        notification = Notification.objects.get(user=self.user, notification_type=TYPES.NEW_EPISODE)
        self.assertEqual(notification.data["episode_number"], 1)

    def test_does_not_duplicate_new_episode_notification_for_same_user_and_episode(self):
        anime = self._create_anime(
            last_aired_episode=5, last_aired_at=timezone.now() - timedelta(hours=3)
        )
        self._watch(anime)
        # A row as migration 0010 leaves it (keys backfilled).
        Notification.objects.create(
            user=self.user,
            notification_type=TYPES.NEW_EPISODE,
            title="New Episode",
            message="Episode 5 aired.",
            data={"anime_id": anime.id, "episode_number": 5},
            dedupe_key=f"new_episode:{anime.id}:5",
            group_key=f"new_episode:{anime.id}",
        )

        result = check_new_episodes()

        self.assertEqual(result["notifications_created"], 0)
        self.assertEqual(
            Notification.objects.filter(
                user=self.user, notification_type=TYPES.NEW_EPISODE
            ).count(),
            1,
        )
