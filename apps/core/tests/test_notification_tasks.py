from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from ...animes.models import Anime
from ...users.models import UserAnimeList
from ..models import Notification
from ..tasks.notifications import check_new_episodes, send_pending_notifications

User = get_user_model()


class TestSendPendingNotifications(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="notif_task_user",
            email="notif-task@example.com",
            password="password123",
        )

    @patch("apps.users.services.email_service.send_email_task.delay")
    @patch("apps.core.services.celery_tasks.PushService.has_active_subscriptions")
    @patch("apps.core.services.celery_tasks.PushService.send_to_user")
    def test_push_notifications_are_not_resent_on_subsequent_runs(
        self, mock_send_push, mock_has_active_subscriptions, mock_send_email
    ):
        mock_has_active_subscriptions.return_value = True
        mock_send_push.return_value = 1
        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_FOLLOWER,
            title="New Follower",
            message="Someone followed you",
            is_email_sent=False,
            is_push_sent=False,
        )

        send_pending_notifications()
        notification.refresh_from_db()
        self.assertTrue(notification.is_push_sent)
        self.assertTrue(notification.is_email_sent)
        self.assertEqual(mock_send_push.call_count, 1)
        self.assertEqual(mock_send_email.call_count, 0)

        # Running the task again should not re-send.
        send_pending_notifications()
        self.assertEqual(mock_send_push.call_count, 1)
        self.assertEqual(mock_send_email.call_count, 0)

    @patch("apps.users.services.email_service.send_email_task.delay")
    @patch("apps.core.services.celery_tasks.PushService.send_to_user")
    def test_push_notifications_without_active_subscriptions_are_finalized(
        self, mock_send_push, mock_send_email
    ):
        profile = self.user.userprofile
        profile.email_new_episodes = False
        profile.push_new_episodes = True
        profile.save(update_fields=["email_new_episodes", "push_new_episodes"])

        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
            title="New Episode",
            message="Episode 3 aired.",
            is_email_sent=False,
            is_push_sent=False,
        )

        send_pending_notifications()
        notification.refresh_from_db()

        self.assertTrue(notification.is_email_sent)
        self.assertTrue(notification.is_push_sent)
        mock_send_push.assert_not_called()
        mock_send_email.assert_not_called()

    @patch("apps.users.services.email_service.send_email_task.delay")
    def test_new_episode_notifications_dispatch_email_via_email_service_task(self, mock_send_email):
        profile = self.user.userprofile
        profile.email_new_episodes = True
        profile.push_new_episodes = False
        profile.save(update_fields=["email_new_episodes", "push_new_episodes"])

        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
            title="Episode 7 aired",
            message="A new episode is available.",
            data={"anime_slug": "episode-anime"},
            is_email_sent=False,
            is_push_sent=False,
        )

        send_pending_notifications()
        notification.refresh_from_db()

        self.assertTrue(notification.is_email_sent)
        self.assertTrue(notification.is_push_sent)
        mock_send_email.assert_called_once()


class TestCheckNewEpisodes(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="watching_user",
            email="watching@example.com",
            password="password123",
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

    def test_creates_notification_from_confirmed_last_aired_episode_for_watching_user(self):
        anime = self._create_anime(
            last_aired_episode=7,
            last_aired_at=timezone.now() - timedelta(hours=2),
            next_airing_episode=8,
            next_airing_date=timezone.now() + timedelta(days=7),
        )
        UserAnimeList.objects.create(
            user=self.user,
            anime=anime,
            status=UserAnimeList.UserAnimeStatus.watching,
        )

        created = check_new_episodes()

        self.assertEqual(created, 1)
        notification = Notification.objects.get(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
        )
        self.assertEqual(notification.data["anime_id"], anime.id)
        self.assertEqual(notification.data["episode_number"], 7)
        self.assertIn("aired_at", notification.data)

    def test_falls_back_to_current_past_airing_snapshot_before_schedule_advances(self):
        anime = self._create_anime(
            next_airing_episode=1,
            next_airing_date=timezone.now() - timedelta(hours=1),
        )
        UserAnimeList.objects.create(
            user=self.user,
            anime=anime,
            status=UserAnimeList.UserAnimeStatus.watching,
        )

        created = check_new_episodes()

        self.assertEqual(created, 1)
        notification = Notification.objects.get(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
        )
        self.assertEqual(notification.data["episode_number"], 1)

    def test_does_not_duplicate_new_episode_notification_for_same_user_and_episode(self):
        anime = self._create_anime(
            last_aired_episode=5,
            last_aired_at=timezone.now() - timedelta(hours=3),
        )
        UserAnimeList.objects.create(
            user=self.user,
            anime=anime,
            status=UserAnimeList.UserAnimeStatus.watching,
        )
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.NEW_EPISODE,
            title="New Episode",
            message="Episode 5 aired.",
            data={"anime_id": anime.id, "episode_number": 5},
        )

        created = check_new_episodes()

        self.assertEqual(created, 0)
        self.assertEqual(
            Notification.objects.filter(
                user=self.user,
                notification_type=Notification.NotificationType.NEW_EPISODE,
            ).count(),
            1,
        )
