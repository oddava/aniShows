"""Health endpoints: the payload contract and a cheap readiness probe (G7 P1-2)."""

from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings

from apps.core.services import migration_health

LIVENESS_KEYS = {"status", "maintenance_mode", "service_available", "version", "checks"}


class HealthPayloadContractTests(TestCase):
    def setUp(self):
        cache.clear()
        migration_health.clear_cached_migration_state()
        self.addCleanup(migration_health.clear_cached_migration_state)

    def test_liveness_payload_is_unchanged(self):
        response = self.client.get("/api/v1/health/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload), LIVENESS_KEYS)
        self.assertEqual(payload["checks"], {"app": True})
        self.assertEqual(payload["status"], "healthy")

    def test_readiness_payload_keys(self):
        response = self.client.get("/api/v1/health/ready/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload), LIVENESS_KEYS)
        self.assertEqual(set(payload["checks"]), {"database", "cache", "migrations"})
        self.assertTrue(all(payload["checks"].values()))


class ReadinessMigrationCacheTests(TestCase):
    def setUp(self):
        cache.clear()
        migration_health.clear_cached_migration_state()
        self.addCleanup(migration_health.clear_cached_migration_state)

    def test_100_hits_build_the_migration_graph_once_per_process(self):
        with patch.object(migration_health, "_compute", return_value=False) as compute:
            for _ in range(100):
                self.assertEqual(self.client.get("/api/v1/health/ready/").status_code, 200)
        self.assertEqual(compute.call_count, 1)

    def test_the_answer_expires(self):
        with (
            patch.object(migration_health, "_compute", return_value=False) as compute,
            patch.object(migration_health.time, "monotonic", side_effect=[0.0, 61.0]),
        ):
            migration_health.has_pending_migrations(max_age=60)
            migration_health.has_pending_migrations(max_age=60)
        self.assertEqual(compute.call_count, 2)

    def test_pending_migrations_still_fail_readiness(self):
        with patch.object(migration_health, "_compute", return_value=True):
            response = self.client.get("/api/v1/health/ready/")
        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["checks"]["migrations"])

    @override_settings(GIT_SHA="abc123")
    def test_workers_of_one_release_share_the_answer(self):
        with patch.object(migration_health, "_compute", return_value=False) as compute:
            migration_health.has_pending_migrations(max_age=60)
            migration_health.clear_cached_migration_state()  # another worker process
            migration_health.has_pending_migrations(max_age=60)
        self.assertEqual(compute.call_count, 1)
        self.assertIs(cache.get("health:pending-migrations:abc123:default"), False)

    @override_settings(GIT_SHA="")
    def test_no_shared_answer_without_a_release_id(self):
        with patch.object(migration_health, "_compute", return_value=False) as compute:
            migration_health.has_pending_migrations(max_age=60)
            migration_health.clear_cached_migration_state()
            migration_health.has_pending_migrations(max_age=60)
        self.assertEqual(compute.call_count, 2)

    @override_settings(GIT_SHA="abc123")
    def test_a_broken_cache_does_not_break_readiness(self):
        with (
            patch.object(migration_health, "_compute", return_value=False),
            patch.object(migration_health.cache, "get", side_effect=RuntimeError("down")),
            patch.object(migration_health.cache, "set", side_effect=RuntimeError("down")),
        ):
            self.assertFalse(migration_health.has_pending_migrations(max_age=60))

    def test_without_max_age_it_always_computes(self):
        with patch.object(migration_health, "_compute", return_value=False) as compute:
            migration_health.has_pending_migrations()
            migration_health.has_pending_migrations()
        self.assertEqual(compute.call_count, 2)
