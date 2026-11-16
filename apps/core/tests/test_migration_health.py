from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.core.services.migration_health import has_pending_migrations


class MigrationHealthTests(SimpleTestCase):
    @patch("apps.core.services.migration_health.MigrationExecutor")
    @patch("apps.core.services.migration_health.connections")
    def test_returns_false_when_no_migrations_are_pending(
        self,
        mock_connections,
        mock_executor_cls,
    ):
        mock_connections.__getitem__.return_value = Mock()
        mock_executor = mock_executor_cls.return_value
        mock_executor.loader.graph.leaf_nodes.return_value = [
            ("users", "0036_userprofile_preferred_timezone")
        ]
        mock_executor.migration_plan.return_value = []

        self.assertFalse(has_pending_migrations())

    @patch("apps.core.services.migration_health.MigrationExecutor")
    @patch("apps.core.services.migration_health.connections")
    def test_returns_true_when_migrations_are_pending(
        self,
        mock_connections,
        mock_executor_cls,
    ):
        mock_connections.__getitem__.return_value = Mock()
        mock_executor = mock_executor_cls.return_value
        mock_executor.loader.graph.leaf_nodes.return_value = [
            ("anime", "0046_add_shadow_duplicate_lookup_indexes")
        ]
        mock_executor.migration_plan.return_value = [Mock()]

        self.assertTrue(has_pending_migrations())


class MigrationHealthCacheTests(SimpleTestCase):
    def setUp(self):
        from apps.core.services.migration_health import clear_cached_migration_state

        clear_cached_migration_state()
        self.addCleanup(clear_cached_migration_state)

    @patch("apps.core.services.migration_health.MigrationExecutor")
    @patch("apps.core.services.migration_health.connections")
    def test_max_age_reuses_the_answer_in_process(self, mock_connections, mock_executor_cls):
        mock_connections.__getitem__.return_value = Mock()
        mock_executor_cls.return_value.migration_plan.return_value = [Mock()]

        self.assertTrue(has_pending_migrations(max_age=60))
        self.assertTrue(has_pending_migrations(max_age=60))
        self.assertEqual(mock_executor_cls.call_count, 1)

    @patch("apps.core.services.migration_health.MigrationExecutor")
    @patch("apps.core.services.migration_health.connections")
    def test_default_is_uncached(self, mock_connections, mock_executor_cls):
        mock_connections.__getitem__.return_value = Mock()
        mock_executor_cls.return_value.migration_plan.return_value = []

        has_pending_migrations()
        has_pending_migrations()
        self.assertEqual(mock_executor_cls.call_count, 2)
