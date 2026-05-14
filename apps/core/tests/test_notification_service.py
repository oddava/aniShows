from unittest.mock import Mock, patch

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ...animes.models import Anime, Review
from ...forums.models import Category, Post, Thread
from ...users.models import UserProfile
from ...users.views.notifications import NotificationViewSet
from ..models import Notification
from ..services.notification_service import NotificationService

User = get_user_model()


class TestNotificationUnreadCountCache(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="notif_user",
            email="notif@example.com",
            password="password123",
        )

    def test_get_unread_count_populates_cache(self):
        count = NotificationService.get_unread_count_for_user_id(self.user.id)
        self.assertEqual(count, 0)

        cache_key = NotificationService._unread_count_cache_key(self.user.id)
        self.assertEqual(int(cache.get(cache_key)), 0)

    def test_mark_as_read_updates_cached_counter(self):
        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test",
            message="Message",
        )

        self.assertEqual(NotificationService.get_unread_count(self.user), 1)
        self.assertTrue(NotificationService.mark_as_read(notification.id, self.user))
        self.assertEqual(NotificationService.get_unread_count(self.user), 0)

    def test_mark_all_as_read_resets_cache(self):
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test 1",
            message="Message 1",
        )
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test 2",
            message="Message 2",
        )

        self.assertEqual(NotificationService.get_unread_count(self.user), 2)
        self.assertEqual(NotificationService.mark_all_as_read(self.user), 2)
        self.assertEqual(NotificationService.get_unread_count(self.user), 0)

    @patch("apps.core.services.notification_service.async_to_sync")
    @patch("apps.core.services.notification_service.get_channel_layer")
    def test_mark_as_read_broadcasts_unread_count_update(self, mock_get_channel_layer, mock_async_to_sync):
        notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test",
            message="Message",
        )
        mock_layer = Mock()
        mock_get_channel_layer.return_value = mock_layer
        mock_sender = Mock()
        mock_async_to_sync.return_value = mock_sender

        self.assertTrue(NotificationService.mark_as_read(notification.id, self.user))

        mock_sender.assert_called_with(
            f"notifications_user_{self.user.id}",
            {"type": "notification.count_update", "count": 0},
        )

    def test_new_follower_notification_uses_google_avatar_fallback(self):
        follower = User.objects.create_user(
            username="notJony",
            email="notjony@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=follower, defaults={"email_verified": True})
        google_avatar = "https://lh3.googleusercontent.com/a/notjony-notif=s96-c"
        SocialAccount.objects.create(
            user=follower,
            provider="google",
            uid="google-notjony-notif",
            extra_data={"picture": google_avatar},
        )

        notification = NotificationService.create_new_follower_notification(self.user, follower)

        self.assertIsNotNone(notification)
        self.assertEqual(notification.data["follower_avatar"], google_avatar)

    @patch("apps.core.services.notification_service.async_to_sync")
    @patch("apps.core.services.notification_service.get_channel_layer")
    def test_mark_all_as_read_broadcasts_unread_count_update(self, mock_get_channel_layer, mock_async_to_sync):
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="Test 1",
            message="Message 1",
        )
        mock_layer = Mock()
        mock_get_channel_layer.return_value = mock_layer
        mock_sender = Mock()
        mock_async_to_sync.return_value = mock_sender

        NotificationService.mark_all_as_read(self.user)

        mock_sender.assert_called_with(
            f"notifications_user_{self.user.id}",
            {"type": "notification.count_update", "count": 0},
        )


class TestForumLikeNotificationAggregation(TestCase):
    def setUp(self):
        self.recipient = User.objects.create_user(
            username="recipient_user",
            email="recipient@example.com",
            password="password123",
        )
        self.alice = User.objects.create_user(
            username="alice_user",
            email="alice@example.com",
            password="password123",
        )
        self.bob = User.objects.create_user(
            username="bob_user",
            email="bob@example.com",
            password="password123",
        )
        self.category = Category.objects.create(name="General", slug="general")
        self.thread = Thread.objects.create(
            category=self.category,
            title="Welcome to AniShows!",
            author=self.recipient,
            content="Thread content",
        )
        self.post = Post.objects.create(
            thread=self.thread,
            author=self.recipient,
            content="Post content",
        )

    @patch.object(NotificationService, "_broadcast_notification_update")
    @patch.object(NotificationService, "_broadcast_notification")
    def test_forum_like_notifications_aggregate_for_same_thread(
        self, mock_broadcast_new, mock_broadcast_update
    ):
        with self.captureOnCommitCallbacks(execute=True):
            first = NotificationService.create_forum_like_notification(
                user=self.recipient,
                author=self.alice,
                instance=self.thread,
                is_thread=True,
            )
        with self.captureOnCommitCallbacks(execute=True):
            second = NotificationService.create_forum_like_notification(
                user=self.recipient,
                author=self.bob,
                instance=self.thread,
                is_thread=True,
            )

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual(first.id, second.id)
        self.assertEqual(
            Notification.objects.filter(
                user=self.recipient,
                notification_type=Notification.NotificationType.FORUM_LIKE,
                is_read=False,
            ).count(),
            1,
        )

        merged = Notification.objects.get(pk=first.id)
        self.assertEqual(merged.data["liker_count"], 2)
        self.assertEqual(merged.data["liker_username"], "bob_user")
        self.assertEqual(merged.data["liker_usernames"], ["bob_user", "alice_user"])
        self.assertEqual(
            merged.message,
            "bob_user and 1 other liked your thread: Welcome to AniShows!",
        )
        mock_broadcast_new.assert_called_once()
        mock_broadcast_update.assert_called_once()

    def test_forum_like_notifications_do_not_aggregate_across_different_posts(self):
        another_post = Post.objects.create(
            thread=self.thread,
            author=self.recipient,
            content="Another post",
        )
        NotificationService.create_forum_like_notification(
            user=self.recipient,
            author=self.alice,
            instance=self.post,
            is_thread=False,
        )
        NotificationService.create_forum_like_notification(
            user=self.recipient,
            author=self.bob,
            instance=another_post,
            is_thread=False,
        )

        self.assertEqual(
            Notification.objects.filter(
                user=self.recipient,
                notification_type=Notification.NotificationType.FORUM_LIKE,
                is_read=False,
            ).count(),
            2,
        )


class TestReviewLikeNotificationAggregation(TestCase):
    def setUp(self):
        self.recipient = User.objects.create_user(
            username="review_owner",
            email="review-owner@example.com",
            password="password123",
        )
        self.alice = User.objects.create_user(
            username="alice_user",
            email="alice-review@example.com",
            password="password123",
        )
        self.bob = User.objects.create_user(
            username="bob_user",
            email="bob-review@example.com",
            password="password123",
        )
        self.anime = Anime.objects.create(
            title="Notification Cover Anime",
            slug="notification-cover-anime",
            synopsis="Anime for notification tests",
            anime_type="TV",
            status="Airing",
            cover_image_external_url="https://img.example.com/cover.jpg",
        )
        self.review = Review.objects.create(
            user=self.recipient,
            anime=self.anime,
            rating=9,
            text="A review worth liking.",
        )

    @patch.object(NotificationService, "_broadcast_notification_update")
    @patch.object(NotificationService, "_broadcast_notification")
    def test_review_like_notifications_aggregate_for_same_review(
        self, mock_broadcast_new, mock_broadcast_update
    ):
        with self.captureOnCommitCallbacks(execute=True):
            first = NotificationService.create_review_like_notification(
                user=self.recipient,
                author=self.alice,
                review=self.review,
            )
        with self.captureOnCommitCallbacks(execute=True):
            second = NotificationService.create_review_like_notification(
                user=self.recipient,
                author=self.bob,
                review=self.review,
            )

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual(first.id, second.id)

        merged = Notification.objects.get(pk=first.id)
        self.assertEqual(merged.notification_type, Notification.NotificationType.REVIEW_LIKE)
        self.assertEqual(merged.data["liker_count"], 2)
        self.assertEqual(merged.data["liker_username"], "bob_user")
        self.assertEqual(merged.data["liker_usernames"], ["bob_user", "alice_user"])
        self.assertEqual(merged.data["anime_cover_image_small"], "https://img.example.com/cover.jpg")
        self.assertEqual(
            merged.message,
            "bob_user and 1 other liked your review of Notification Cover Anime",
        )
        mock_broadcast_new.assert_called_once()
        mock_broadcast_update.assert_called_once()

    def test_review_like_notification_is_retracted_when_last_liker_unlikes(self):
        notification = NotificationService.create_review_like_notification(
            user=self.recipient,
            author=self.alice,
            review=self.review,
        )

        self.assertIsNotNone(notification)
        NotificationService.remove_review_like_from_notification(
            user=self.recipient,
            author=self.alice,
            review=self.review,
        )

        self.assertFalse(Notification.objects.filter(pk=notification.id).exists())

    def test_notification_list_cover_enrichment_uses_existing_anime_payload(self):
        notification = Notification.objects.create(
            user=self.recipient,
            notification_type=Notification.NotificationType.NEW_EPISODE,
            title="New Episode",
            message="Episode 1 aired.",
            data={
                "anime_id": self.anime.id,
                "anime_slug": self.anime.slug,
                "anime_title": self.anime.title,
                "episode_number": 1,
            },
        )

        enriched = NotificationViewSet._attach_anime_cover_payloads([notification])[0]

        self.assertEqual(
            enriched._notification_cover_payload["anime_cover_image_small"],
            "https://img.example.com/cover.jpg",
        )
