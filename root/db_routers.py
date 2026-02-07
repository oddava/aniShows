"""Database router for read replicas support."""

import random


class PrimaryReplicaRouter:
    """
    Route reads to replicas, writes to primary.

    Add to settings.py:
    DATABASE_ROUTERS = ['root.db_routers.PrimaryReplicaRouter']
    """

    def db_for_read(self, model, **hints):
        """Route read operations to replica."""
        # Use round-robin or random selection for replicas
        return random.choice(["replica1", "replica2", "default"])

    def db_for_write(self, model, **hints):
        """Route writes to primary."""
        return "default"

    def allow_relation(self, obj1, obj2, **hints):
        """Allow relations between objects from different databases."""
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """Only run migrations on primary database."""
        return db == "default"
