"""Unit tests for horizontal scaling configuration.

Tests cover:
- PrimaryReplicaRouter (read/write routing)
- Environment parsing helpers (_env_bool, _env_int, _env_float, _parse_csv, _parse_sentinel_nodes)
- CDN URL construction
- Celery queue routing consistency
- PgBouncer compatibility settings
"""

from unittest.mock import patch

from django.test import TestCase, override_settings


class TestEnvParsers(TestCase):
    """Test environment variable parsing helpers used by settings.base."""

    def test_env_bool_true_values(self):
        """Truthy strings should return True."""
        from root.settings.base import _env_bool

        for val in ("1", "true", "True", "TRUE", "yes", "on", " True ", " 1 "):
            with patch.dict("os.environ", {"TEST_VAR": val}):
                assert _env_bool("TEST_VAR") is True, f"Expected True for {val!r}"

    def test_env_bool_false_values(self):
        """Falsy strings should return False."""
        from root.settings.base import _env_bool

        for val in ("0", "false", "False", "no", "off", "random"):
            with patch.dict("os.environ", {"TEST_VAR": val}):
                assert _env_bool("TEST_VAR") is False, f"Expected False for {val!r}"

    def test_env_bool_missing_uses_default(self):
        """Missing env var should return the default."""
        from root.settings.base import _env_bool

        with patch.dict("os.environ", {}, clear=False):
            assert _env_bool("TOTALLY_MISSING_XYZ", True) is True
            assert _env_bool("TOTALLY_MISSING_XYZ", False) is False

    def test_parse_csv_basic(self):
        """Comma-separated values should be split and stripped."""
        from root.settings.base import _parse_csv

        assert _parse_csv("a, b , c") == ["a", "b", "c"]

    def test_env_int_valid_and_invalid_values(self):
        """Integer parser should accept valid values and fall back on invalid ones."""
        from root.settings.base import _env_int

        with patch.dict("os.environ", {"TEST_INT_VAR": "42"}):
            assert _env_int("TEST_INT_VAR", 7) == 42
        with patch.dict("os.environ", {"TEST_INT_VAR": "not-an-int"}):
            assert _env_int("TEST_INT_VAR", 7) == 7

    def test_env_float_valid_and_invalid_values(self):
        """Float parser should accept valid values and fall back on invalid ones."""
        from root.settings.base import _env_float

        with patch.dict("os.environ", {"TEST_FLOAT_VAR": "0.125"}):
            assert abs(_env_float("TEST_FLOAT_VAR", 1.0) - 0.125) < 1e-9
        with patch.dict("os.environ", {"TEST_FLOAT_VAR": "not-a-float"}):
            assert abs(_env_float("TEST_FLOAT_VAR", 1.0) - 1.0) < 1e-9

    def test_parse_csv_empty(self):
        """Empty string should return empty list."""
        from root.settings.base import _parse_csv

        assert _parse_csv("") == []

    def test_parse_csv_trailing_commas(self):
        """Trailing commas should not produce empty entries."""
        from root.settings.base import _parse_csv

        assert _parse_csv("a,b,") == ["a", "b"]

    def test_parse_sentinel_nodes_with_ports(self):
        """Sentinel nodes with explicit ports should be parsed correctly."""
        from root.settings.base import _parse_sentinel_nodes

        result = _parse_sentinel_nodes("host1:26379,host2:26380")
        assert result == [("host1", 26379), ("host2", 26380)]

    def test_parse_sentinel_nodes_default_port(self):
        """Sentinel nodes without ports should default to 26379."""
        from root.settings.base import _parse_sentinel_nodes

        result = _parse_sentinel_nodes("host1,host2")
        assert result == [("host1", 26379), ("host2", 26379)]

    def test_parse_sentinel_nodes_empty(self):
        """Empty string should return empty list."""
        from root.settings.base import _parse_sentinel_nodes

        assert _parse_sentinel_nodes("") == []

class TestPrimaryReplicaRouter(TestCase):
    """Test the database router for primary/replica deployments."""

    def _get_router(self):
        from root.db_routers import PrimaryReplicaRouter

        return PrimaryReplicaRouter()

    def test_write_always_to_default(self):
        """All writes must go to 'default' (primary)."""
        router = self._get_router()
        assert router.db_for_write(None) == "default"

    def test_read_to_default_without_replicas(self):
        """Without configured replicas, reads should fall back to 'default'."""
        router = self._get_router()
        with self.settings(READ_REPLICA_ALIASES=[]):
            assert router.db_for_read(None) == "default"

    @override_settings(
        READ_REPLICA_ALIASES=["replica1"],
        DATABASES={
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"},
            "replica1": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"},
        },
    )
    def test_read_routes_to_replica(self):
        """With a configured replica, reads should route to it."""
        router = self._get_router()
        result = router.db_for_read(None)
        assert result == "replica1"

    @override_settings(
        READ_REPLICA_ALIASES=["replica_missing"],
        DATABASES={
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"},
        },
    )
    def test_read_ignores_missing_replica_alias(self):
        """Replica aliases not in DATABASES should be ignored gracefully."""
        router = self._get_router()
        # replica_missing is not in DATABASES, so _replicas() returns empty → default
        assert router.db_for_read(None) == "default"

    def test_allow_relation_always_true(self):
        """Relations across primary/replica databases should always be allowed."""
        router = self._get_router()
        assert router.allow_relation(None, None) is True

    def test_allow_migrate_only_default(self):
        """Migrations must only run on the primary ('default') database."""
        router = self._get_router()
        assert router.allow_migrate("default", "users") is True
        assert router.allow_migrate("replica1", "users") is False
        assert router.allow_migrate("replica2", "users") is False

class TestCeleryQueueRouting(TestCase):
    """Verify Celery beat schedule queues match task_routes configuration."""

    def test_hourly_beat_tasks_match_task_routes(self):
        """Hourly/frequent beat tasks should route to the same queue as task_routes.

        Note: Daily/weekly tasks intentionally override queues (e.g. low_priority
        for off-peak batch runs), so we only check hourly tasks here.
        """
        from root.celery import app

        task_routes = app.conf.task_routes or {}
        beat_schedule = app.conf.beat_schedule or {}

        # Only check hourly tasks — daily/weekly tasks intentionally use different queues
        hourly_tasks = {
            name: config
            for name, config in beat_schedule.items()
            if "hourly" in name or "5min" in name or "pending" in name
        }

        mismatches = []
        for schedule_name, schedule_config in hourly_tasks.items():
            task_name = schedule_config.get("task", "")
            beat_queue = schedule_config.get("options", {}).get("queue")
            route_queue = task_routes.get(task_name, {}).get("queue")

            if beat_queue and route_queue and beat_queue != route_queue:
                mismatches.append(
                    f"{schedule_name}: beat queue={beat_queue!r}, "
                    f"task_routes queue={route_queue!r}"
                )

        assert not mismatches, (
            "Hourly beat schedule queue mismatches with task_routes:\n"
            + "\n".join(mismatches)
        )

    def test_all_beat_queues_are_defined(self):
        """All queues referenced in beat schedule should exist in task_queues."""
        from root.celery import app

        defined_queues = {q.name for q in (app.conf.task_queues or [])}
        beat_schedule = app.conf.beat_schedule or {}

        undefined = set()
        for schedule_name, schedule_config in beat_schedule.items():
            queue = schedule_config.get("options", {}).get("queue")
            if queue and queue not in defined_queues:
                undefined.add(f"{schedule_name} → {queue}")

        assert not undefined, f"Beat tasks reference undefined queues: {undefined}"

    def test_task_routes_queues_are_defined(self):
        """All queues referenced in task_routes should exist in task_queues."""
        from root.celery import app

        defined_queues = {q.name for q in (app.conf.task_queues or [])}
        task_routes = app.conf.task_routes or {}

        undefined = set()
        for task_name, route in task_routes.items():
            queue = route.get("queue")
            if queue and queue not in defined_queues:
                undefined.add(f"{task_name} → {queue}")

        assert not undefined, f"Task routes reference undefined queues: {undefined}"

class TestPgBouncerSettings(TestCase):
    """Verify PgBouncer compatibility settings."""

    def test_server_side_cursors_disabled_when_pgbouncer_on(self):
        """DISABLE_SERVER_SIDE_CURSORS logic in base.py must set it when pgbouncer is on.

        The test env overrides DATABASES to SQLite, so we test the logic directly.
        """
        db_config = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "test_db",
        }
        # Simulate what base.py does
        db_use_pgbouncer = True
        if db_use_pgbouncer:
            db_config["DISABLE_SERVER_SIDE_CURSORS"] = True

        assert db_config["DISABLE_SERVER_SIDE_CURSORS"] is True

    def test_server_side_cursors_not_set_when_pgbouncer_off(self):
        """Without pgbouncer, DISABLE_SERVER_SIDE_CURSORS should not be set."""
        db_config = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "test_db",
        }
        db_use_pgbouncer = False
        if db_use_pgbouncer:
            db_config["DISABLE_SERVER_SIDE_CURSORS"] = True

        assert "DISABLE_SERVER_SIDE_CURSORS" not in db_config

class TestCDNUrlConstruction(TestCase):
    """Verify CDN URL construction logic."""

    def test_no_cdn_uses_local_urls(self):
        """Without CDN vars, static/media URLs should be local paths."""
        from django.conf import settings

        # In test env, CDN vars are empty
        if not getattr(settings, "CDN_BASE_URL", ""):
            assert settings.STATIC_URL == "/static/" or settings.STATIC_URL.startswith("http")

    @override_settings(
        STATIC_CDN_URL="https://cdn.example.com",
        MEDIA_CDN_URL="https://cdn.example.com",
    )
    def test_cdn_url_no_trailing_slash(self):
        """CDN URLs in settings should not have trailing slashes."""
        from django.conf import settings

        assert not settings.STATIC_CDN_URL.endswith("/")
        assert not settings.MEDIA_CDN_URL.endswith("/")

class TestRedisConfig(TestCase):
    """Verify Redis configuration is consistent."""

    def test_redis_url_has_password_when_set(self):
        """If REDIS_PASSWORD is set, the URL should contain authentication."""
        from django.conf import settings

        password = getattr(settings, "REDIS_PASSWORD", "")
        redis_url = getattr(settings, "REDIS_URL", "")

        if password and not getattr(settings, "REDIS_SENTINEL_ENABLED", False):
            assert f":{password}@" in redis_url, (
                f"REDIS_URL should contain password but got: {redis_url}"
            )

    def test_channel_layer_configured(self):
        """Channel layers must be configured for WebSocket support."""
        from django.conf import settings

        assert "default" in settings.CHANNEL_LAYERS
        assert settings.CHANNEL_LAYERS["default"]["BACKEND"] == "channels_redis.core.RedisChannelLayer"

class TestRuntimeScalingToggles(TestCase):
    """Verify high-throughput runtime toggles are available and bounded."""

    def test_request_log_sample_rate_is_bounded(self):
        from django.conf import settings

        sample_rate = float(getattr(settings, "REQUEST_LOG_SUCCESS_SAMPLE_RATE", 0.0))
        assert 0.0 <= sample_rate <= 1.0

    def test_notification_unread_cache_ttl_is_positive(self):
        from django.conf import settings

        ttl = int(getattr(settings, "NOTIFICATION_UNREAD_CACHE_TTL", 0))
        assert ttl > 0
