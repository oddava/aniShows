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
        mock_executor.loader.graph.leaf_nodes.return_value = [("users", "0036_userprofile_preferred_timezone")]
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
