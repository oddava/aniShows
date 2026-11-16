from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from ...animes.models import Anime
from ...users.models import UserAnimeList
from ..models import Notification
from ..services import episode_notifications, notification_preferences
from ..services.notification_service import NotificationService

User = get_user_model()
TYPES = Notification.NotificationType
STATUS = UserAnimeList.UserAnimeStatus


class EpisodeFanOutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.now = timezone.now()
        self.anime = Anime.objects.create(
            title="Dungeon Meshi",
            slug="dungeon-meshi",
            synopsis="s",
            status=Anime.AnimeStatus.airing,
            last_aired_episode=6,
            last_aired_at=self.now - timedelta(hours=1),
        )
        self.n = 0

    def _entry(self, status=STATUS.watching, episodes_watched=0):
        self.n += 1
        user = User.objects.create_user(f"u{self.n}", f"u{self.n}@example.com", "pw-123456")
        UserAnimeList.objects.create(
            user=user, anime=self.anime, status=status, episodes_watched=episodes_watched
        )
        return user

    def _run(self):
        with self.captureOnCommitCallbacks(execute=True):
            return episode_notifications.check_new_episodes(now=self.now)

    def _rows(self, user):
        return list(Notification.objects.filter(user=user, notification_type=TYPES.NEW_EPISODE))

    def test_watching_gets_it_and_completed_or_dropped_do_not(self):
        watching = self._entry(STATUS.watching)
        completed = self._entry(STATUS.completed)
        dropped = self._entry(STATUS.dropped)
        self._run()
        self.assertEqual(len(self._rows(watching)), 1)
        self.assertEqual(self._rows(completed) + self._rows(dropped), [])

    def test_plan_to_watch_follows_the_d4_setting(self):
        planner = self._entry(STATUS.plan_to_watch)
        with override_settings(PLAN_TO_WATCH_ALERTS="premiere"):
            self._run()
        self.assertEqual(self._rows(planner), [])  # episode 6 is not the premiere
        with override_settings(PLAN_TO_WATCH_ALERTS="all"):
            self._run()
        self.assertEqual(len(self._rows(planner)), 1)

    @override_settings(PLAN_TO_WATCH_ALERTS="premiere")
    def test_plan_to_watch_premiere_only_gets_episode_one(self):
        self.anime.last_aired_episode = 1
        self.anime.save(update_fields=["last_aired_episode"])
        planner = self._entry(STATUS.plan_to_watch)
        self._run()
        self.assertEqual(len(self._rows(planner)), 1)

    def test_users_who_already_watched_it_are_skipped(self):
        caught_up = self._entry(episodes_watched=6)
        behind = self._entry(episodes_watched=5)
        self._run()
        self.assertEqual(self._rows(caught_up), [])
        self.assertEqual(len(self._rows(behind)), 1)

    def test_reruns_are_idempotent(self):
        user = self._entry()
        first = self._run()
        second = self._run()
        self.assertEqual(first["notifications_created"], 1)
        self.assertEqual(second["notifications_created"], 0)
        self.assertEqual(len(self._rows(user)), 1)

    def test_episode_is_derived_from_next_airing_episode_minus_one(self):
        self.anime.next_airing_episode = 8
        self.anime.next_airing_date = self.now + timedelta(days=6)
        self.anime.save(update_fields=["next_airing_episode", "next_airing_date"])
        user = self._entry()
        self._run()
        self.assertEqual(self._rows(user)[0].data["episode_number"], 7)

    def test_unread_row_rolls_forward_and_a_read_row_gets_a_new_one(self):
        unread_user, read_user = self._entry(), self._entry()
        self._run()
        NotificationService.mark_as_read(self._rows(read_user)[0].pk, read_user)

        self.anime.last_aired_episode = 7
        self.anime.save(update_fields=["last_aired_episode"])
        self.now += timedelta(minutes=1)
        self._run()

        rolled = self._rows(unread_user)
        self.assertEqual(len(rolled), 1)
        self.assertEqual(rolled[0].data["episode_number"], 7)
        self.assertTrue(rolled[0].data["grouped"])
        self.assertEqual(
            rolled[0].message, "New episodes of Dungeon Meshi are out, latest is Episode 7"
        )
        rows = self._rows(read_user)
        self.assertEqual(len(rows), 2)
        self.assertEqual(sum(1 for r in rows if not r.is_read), 1)

    def test_query_count_is_the_same_for_1_and_50_recipients(self):
        def count_queries():
            with (
                CaptureQueriesContext(connection) as ctx,
                patch.object(NotificationService, "_send_to_user_group"),
            ):
                episode_notifications.notify_episode(self.anime, 6, self.now)
            return len(ctx.captured_queries)

        self._entry()
        one = count_queries()
        Notification.objects.all().delete()
        for _ in range(49):
            self._entry()
        fifty = count_queries()
        self.assertEqual(Notification.objects.count(), 50)
        self.assertEqual(one, fifty)

    def test_unread_counters_are_refreshed(self):
        user = self._entry()
        NotificationService._set_unread_count_cache(user.pk, 0)
        self._run()
        self.assertEqual(NotificationService.get_unread_count_for_user_id(user.pk), 1)

    def test_in_app_off_writes_no_row(self):
        user = self._entry()
        notification_preferences.update_preferences(user.pk, {"episodes": {"in_app": False}})
        self._run()
        self.assertEqual(self._rows(user), [])

    def test_inactive_users_are_skipped(self):
        user = self._entry()
        user.is_active = False
        user.save(update_fields=["is_active"])
        self._run()
        self.assertEqual(self._rows(user), [])

    def _verified(self, user):
        profile = user.userprofile
        profile.email_verified = True
        profile.save(update_fields=["email_verified"])
        return user

    def test_new_users_get_no_episode_email_by_default(self):
        # D-4: episode emails are opt-in.
        user = self._verified(self._entry())
        with patch("apps.core.services.episode_notifications.enqueue_delivery"):
            episode_notifications.notify_episode(self.anime, 6, self.now)
        (row,) = self._rows(user)
        self.assertTrue(row.is_email_sent)  # nothing pending

    def test_plan_to_watch_is_told_in_the_app_only_by_default(self):
        # D-4: a planner who opted in to email and push still gets only the in-app row.
        watcher = self._verified(self._entry(STATUS.watching))
        planner = self._verified(self._entry(STATUS.plan_to_watch))
        for user in (watcher, planner):
            notification_preferences.update_preferences(
                user.pk, {"episodes": {"email": True, "push": True}}
            )
        with patch("apps.core.services.episode_notifications.enqueue_delivery"):
            episode_notifications.notify_episode(self.anime, 6, self.now)
        (planned,) = self._rows(planner)
        self.assertTrue(planned.is_email_sent and planned.is_push_sent)
        (watched,) = self._rows(watcher)
        self.assertFalse(watched.is_email_sent)

        Notification.objects.all().delete()
        with (
            override_settings(PLAN_TO_WATCH_ALERT_CHANNELS="all"),
            patch("apps.core.services.episode_notifications.enqueue_delivery"),
        ):
            episode_notifications.notify_episode(self.anime, 6, self.now)
        self.assertFalse(self._rows(planner)[0].is_email_sent)

    def test_email_is_pending_only_for_verified_users_who_want_it(self):
        verified, unverified, opted_out = self._entry(), self._entry(), self._entry()
        for user in (verified, opted_out):
            self._verified(user)
        for user in (verified, unverified):
            notification_preferences.update_preferences(user.pk, {"episodes": {"email": True}})
        notification_preferences.update_preferences(opted_out.pk, {"episodes": {"email": False}})
        with patch("apps.core.services.episode_notifications.enqueue_delivery") as enqueue:
            episode_notifications.notify_episode(self.anime, 6, self.now)
        self.assertFalse(self._rows(verified)[0].is_email_sent)
        self.assertTrue(self._rows(unverified)[0].is_email_sent)
        self.assertTrue(self._rows(opted_out)[0].is_email_sent)
        (queued,), _ = enqueue.call_args
        self.assertEqual(list(queued), [self._rows(verified)[0].pk])
