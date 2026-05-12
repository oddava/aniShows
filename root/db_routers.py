"""Database router for primary/replica deployments."""

import random

from django.conf import settings


class PrimaryReplicaRouter:
    """Route reads to replicas and writes to primary."""

    @staticmethod
    def _replicas() -> list[str]:
        """Return configured replica aliases that exist in ``DATABASES``."""
        configured = getattr(settings, "READ_REPLICA_ALIASES", [])
        if not configured:
            return []

        return [alias for alias in configured if alias in settings.DATABASES]

    def db_for_read(self, model, **hints):
        """Route read operations to a random replica when available."""
        replicas = self._replicas()
        if not replicas:
            return "default"
        return random.choice(replicas)

    def db_for_write(self, model, **hints):
        """Route writes to primary."""
        return "default"

    def allow_relation(self, obj1, obj2, **hints):
        """Allow relations across primary/replica databases."""
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """Only run migrations on primary database."""
        return db == "default"
