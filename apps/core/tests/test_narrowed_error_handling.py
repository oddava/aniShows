"""The ``except`` clauses narrowed in Phase 2 still catch what they used to.

Test settings disable existing loggers, so these tests mock the module logger.
"""

from unittest import mock

from celery.exceptions import Retry
from django.contrib.auth import get_user_model
from django.db import DatabaseError, OperationalError, ProgrammingError
from django.test import RequestFactory, SimpleTestCase, TestCase
from django_redis.exceptions import ConnectionInterrupted
from kombu.exceptions import OperationalError as KombuOperationalError
from redis.exceptions import ConnectionError as RedisConnectionError

from ...shared.celery import retry_on_error
from ...shared.media_urls import field_media_url
from .. import celery_signals, db_safety
from ..models import CeleryTaskResult, Notification
from ..services import celery_monitoring
from ..services.metadata_service import MetadataService
from ..services.notification_service import NotificationService
from ..services.social_links_service import SocialLinksService
from ..views.monitoring import MetricsView

User = get_user_model()


class _Field:
    def __init__(self, url=None, error=None, truthy=True):
        self._url = url
        self._error = error
        self._truthy = truthy

    def __bool__(self):
        return self._truthy

    @property
    def url(self):
        if self._error:
            raise self._error
        return self._url


class FieldMediaUrlTests(SimpleTestCase):
    def test_returns_normalised_url(self):
        field = _Field(url="http://minio/anishows-media/media/covers/a.jpg")
        self.assertEqual(field_media_url(field), "/media/covers/a.jpg")

    def test_empty_field_has_no_url(self):
        self.assertIsNone(field_media_url(_Field(url="/media/", truthy=False)))
        self.assertIsNone(field_media_url(None))

    def test_any_storage_failure_means_no_url(self):
        for error in (ValueError("no file"), OSError("disk"), RuntimeError("s3 signing")):
            with self.subTest(error=type(error).__name__), mock.patch(
                "apps.shared.media_urls.logger"
            ) as logger:
                self.assertIsNone(field_media_url(_Field(error=error)))
                logger.debug.assert_called_once()
                self.assertTrue(logger.debug.call_args.kwargs["exc_info"])


class RetryOnErrorTests(SimpleTestCase):
    def test_success_passes_through(self):
        task = mock.Mock()
        with retry_on_error(task, "boom"):
            result = 42
        self.assertEqual(result, 42)
        task.retry.assert_not_called()

    def test_failure_is_logged_and_retried(self):
        task = mock.Mock()
        task.retry.return_value = Retry()
        error = DatabaseError("db down")

        with (
            mock.patch("apps.shared.celery.app_logger") as logger,
            self.assertRaises(Retry),
            retry_on_error(task, "Cleanup failed", extra={"days": 3}, countdown=30),
        ):
            raise error

        logger.exception.assert_called_once_with("Cleanup failed", extra={"days": 3})
        task.retry.assert_called_once_with(exc=error, countdown=30)


class NotificationErrorHandlingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="narrow_user", email="narrow@example.com", password="password123"
        )

    def test_broadcast_failure_is_logged_not_raised(self):
        layer = mock.Mock()
        layer.group_send = mock.AsyncMock(side_effect=RedisConnectionError("redis down"))
        with mock.patch(
            "apps.core.services.notification_service.get_channel_layer", return_value=layer
        ), mock.patch("apps.core.services.notification_service.logger") as logger:
            NotificationService._broadcast_unread_count(self.user.id, 3)

        logger.exception.assert_called_once_with(
            "Failed to broadcast %s via WebSocket", "unread count"
        )

    def test_event_is_not_built_without_a_channel_layer(self):
        build_event = mock.Mock()
        with mock.patch(
            "apps.core.services.notification_service.get_channel_layer", return_value=None
        ):
            NotificationService._send_to_user_group(self.user.id, build_event, "notification")
        build_event.assert_not_called()

    def test_create_notification_returns_none_on_database_error(self):
        with mock.patch.object(
            Notification.objects, "create", side_effect=DatabaseError("db down")
        ), mock.patch("apps.core.services.notification_service.logger") as logger:
            result = NotificationService.create_notification(
                user=self.user,
                notification_type=Notification.NotificationType.SYSTEM,
                title="t",
                message="m",
            )

        self.assertIsNone(result)
        logger.exception.assert_called_once()

    def test_unread_counter_falls_back_to_database_when_redis_is_down(self):
        Notification.objects.create(
            user=self.user,
            notification_type=Notification.NotificationType.SYSTEM,
            title="t",
            message="m",
        )
        with mock.patch("apps.core.services.notification_service.cache") as cache:
            cache.add.side_effect = ConnectionInterrupted(connection=None)
            self.assertEqual(NotificationService._increment_unread_count(self.user.id), 1)
            cache.get.side_effect = ConnectionInterrupted(connection=None)
            self.assertEqual(NotificationService.get_unread_count_for_user_id(self.user.id), 1)


class CelerySignalTrackingTests(TestCase):
    def test_untracked_task_failure_is_logged(self):
        with mock.patch("apps.core.celery_signals.logger") as logger:
            celery_signals.on_task_failure(
                task_id="missing-task", exception=ValueError("x"), traceback=None
            )
        logger.exception.assert_called_once_with(
            "Error in task_failure signal for task %s", "missing-task"
        )

    def test_database_error_is_logged(self):
        with mock.patch.object(
            CeleryTaskResult.objects, "using", side_effect=OperationalError("db down")
        ), mock.patch("apps.core.celery_signals.logger") as logger:
            celery_signals.on_task_failure(
                task_id="t-1", exception=ValueError("x"), traceback=None
            )
        logger.exception.assert_called_once()

    def test_missing_table_only_warns(self):
        error = ProgrammingError('relation "core_celerytaskresult" does not exist')
        with mock.patch.object(CeleryTaskResult.objects, "using", side_effect=error), mock.patch(
            "apps.core.celery_signals.warn_missing_table_once"
        ) as warn, mock.patch("apps.core.celery_signals.logger") as logger:
            celery_signals.on_task_failure(
                task_id="t-2", exception=ValueError("x"), traceback=None
            )
        warn.assert_called_once()
        logger.exception.assert_not_called()


class CacheBackendFallbackTests(SimpleTestCase):
    def test_queue_size_is_unknown_without_a_redis_cache(self):
        # LocMemCache has no Redis client (AttributeError).
        self.assertIsNone(celery_monitoring.get_queue_size("default"))

    def test_queue_size_is_unknown_when_redis_fails(self):
        client = mock.Mock()
        client.llen.side_effect = RedisConnectionError("down")
        with mock.patch.object(celery_monitoring, "_get_redis_client", return_value=client):
            self.assertIsNone(celery_monitoring.get_queue_size("default"))

    def test_table_names_are_empty_when_database_is_unreachable(self):
        db_safety._table_names.cache_clear()
        self.addCleanup(db_safety._table_names.cache_clear)
        with mock.patch.object(
            db_safety.connection.introspection,
            "table_names",
            side_effect=OperationalError("down"),
        ):
            self.assertEqual(db_safety._table_names(), set())


class MetadataCachingFailureTests(SimpleTestCase):
    def test_cache_failure_returns_fallback_metadata(self):
        service = MetadataService()
        scraped = {"title": "Example"}
        with mock.patch.object(service, "_scrape_metadata", return_value=scraped), mock.patch(
            "apps.core.services.metadata_service.cache"
        ) as cache, mock.patch("apps.core.services.metadata_service.logger") as logger:
            cache.get.return_value = None
            cache.set.side_effect = ConnectionInterrupted(connection=None)
            result = service.fetch_metadata("https://example.com")

        self.assertEqual(result, service._fallback_metadata("https://example.com"))
        logger.exception.assert_called_once()


class SocialLinkSideEffectTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="links_user", email="links@example.com", password="password123"
        )

    def test_metadata_enqueue_failure_does_not_break_the_commit(self):
        with (
            mock.patch(
                "apps.core.tasks.fetch_multiple_link_metadata.delay",
                side_effect=KombuOperationalError("broker down"),
            ),
            mock.patch("apps.core.services.social_links_service.logger") as logger,
            self.captureOnCommitCallbacks(execute=True),
        ):
            SocialLinksService.schedule_metadata_fetch(["https://example.com"], self.user.id)
        logger.warning.assert_called_once()

    def test_change_log_failure_is_logged_not_raised(self):
        with mock.patch(
            "apps.core.services.social_links_service.SocialLinkChangeLog.objects.create",
            side_effect=DatabaseError("db down"),
        ), mock.patch("apps.core.services.social_links_service.logger") as logger:
            SocialLinksService().log_changes(
                self.user, [], [{"url": "https://example.com"}], "127.0.0.1"
            )
        logger.exception.assert_called_once_with("Error logging social link changes")


class MetricsAuthHeaderTests(SimpleTestCase):
    def test_malformed_basic_auth_is_rejected(self):
        view = MetricsView()
        factory = RequestFactory()
        with mock.patch.dict(
            "os.environ", {"METRICS_USERNAME": "metrics", "METRICS_PASSWORD": "secret"}
        ):
            for header in ("Basic !!!not-base64", "Basic bm8tY29sb24=", "Basic //79"):
                with self.subTest(header=header):
                    request = factory.get("/metrics", HTTP_AUTHORIZATION=header)
                    self.assertFalse(view._verify_auth(request))
