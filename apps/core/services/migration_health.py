from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor


def has_pending_migrations(using: str = DEFAULT_DB_ALIAS) -> bool:
    connection = connections[using]
    executor = MigrationExecutor(connection)
    return bool(executor.migration_plan(executor.loader.graph.leaf_nodes()))
