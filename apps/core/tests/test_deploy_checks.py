"""Unsafe production configuration is refused: system checks and deploy-prod.sh."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from apps.core import checks

REPO_ROOT = Path(__file__).resolve().parents[3]
DEPLOY_SCRIPT = REPO_ROOT / "deploy-prod.sh"
DEPLOY_LIB = REPO_ROOT / "scripts" / "deploy"
GOOD_KEY = "k" * 20 + "0123456789abcdefghijklmnopqrstuvwxyzABCDEF"


class SecretKeyCheckTests(SimpleTestCase):
    def test_placeholders_are_errors(self):
        for key in (
            "change_me_in_production",
            "collectstatic-placeholder",
            "django-insecure-abc",
            "<generate: 64+ random characters>",
            "CHANGE_ME",
        ):
            with self.subTest(key=key), override_settings(SECRET_KEY=key):
                (error,) = checks.secret_key_placeholder_check(None)
                self.assertEqual(error.id, "core.E010")

    def test_a_real_key_passes(self):
        with override_settings(SECRET_KEY=GOOD_KEY):
            self.assertEqual(checks.secret_key_placeholder_check(None), [])


class AllowedHostsCheckTests(SimpleTestCase):
    def test_local_only_hosts_warn(self):
        for hosts in (["localhost", "127.0.0.1", "web"], [""], []):
            with self.subTest(hosts=hosts), override_settings(ALLOWED_HOSTS=hosts):
                (warning,) = checks.allowed_hosts_local_only_check(None)
                self.assertEqual(warning.id, "core.W011")

    def test_a_public_host_passes(self):
        with override_settings(ALLOWED_HOSTS=["anishows.com", "localhost"]):
            self.assertEqual(checks.allowed_hosts_local_only_check(None), [])


class ExternalDatabasePoolCheckTests(SimpleTestCase):
    @staticmethod
    def _settings(host, pool):
        # A stand-in settings object: overriding DATABASES itself is unsafe in tests.
        return SimpleNamespace(DATABASES={"default": {"HOST": host}}, DB_POOL_MAX_SIZE=pool)

    def test_external_host_without_pool_warns(self):
        with patch.object(checks, "settings", self._settings("pg.internal", 0)):
            (warning,) = checks.external_database_pool_check(None)
        self.assertEqual(warning.id, "core.W002")

    def test_pool_or_bundled_db_passes(self):
        for host, pool in (("pg.internal", 5), ("db", 0), ("", 0)):
            with (
                self.subTest(host=host),
                patch.object(checks, "settings", self._settings(host, pool)),
            ):
                self.assertEqual(checks.external_database_pool_check(None), [])


class ProductionCheckDeployTests(SimpleTestCase):
    """`manage.py check --deploy` on production settings, in a fresh interpreter."""

    def _check(self, secret_key: str) -> subprocess.CompletedProcess:
        env = {
            **os.environ,
            "DJANGO_SETTINGS_MODULE": "root.settings.production",
            "DJANGO_SECRET_KEY": secret_key,
            "CORS_ALLOWED_ORIGINS": "https://example.com",
            "CSRF_TRUSTED_ORIGINS": "https://example.com",
            "ALLOWED_HOSTS": "example.com",
        }
        env.pop("SENTRY_DSN", None)
        return subprocess.run(  # noqa: S603 - fixed interpreter and arguments
            [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "ERROR"],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_placeholder_secret_fails_the_check(self):
        result = self._check("change_me_in_production")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("core.E010", result.stderr + result.stdout)

    def test_real_secret_passes(self):
        result = self._check(GOOD_KEY)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("core.E010", result.stderr + result.stdout)


SAFE_ENV = {
    "DJANGO_SECRET_KEY": GOOD_KEY,
    "DB_PASSWORD": "db-pass-0123456789",
    "REDIS_PASSWORD": "redis-pass-0123456789",
    "AWS_SECRET_ACCESS_KEY": "minio-pass-0123456789",
    "METRICS_PASSWORD": "metrics-pass-0123456789",
    "ALLOWED_HOSTS": "anishows.com,www.anishows.com",
    "DOMAIN_NAME": "anishows.com",
    "CADDY_MODE": "tunnel",
    "TUNNEL_TOKEN": "token-for-the-test",
    "ANALYTICS_ENABLED": "0",
}

# A stand-in `docker`: records each call (and, for compose, the CADDY_* values
# it was given). FAKE_STOP_AT_PULL=1 stops the script at the first pull
# (exit 97), i.e. right after every refusal. Without it the run goes on: one
# running web container (whose image is "sha256:previous"), every container
# healthy, a non-empty migration plan; FAKE_FAIL_MIGRATE=1 fails `migrate`.
# The rolling restart then finds no new container and fails: a failure after
# the migration step.
FAKE_DOCKER = r"""#!/usr/bin/env bash
echo "$*" >> "$FAKE_DOCKER_LOG"
if [ "${1:-}" = compose ]; then
  echo "env: mode=${CADDY_MODE:-} site=${CADDY_SITE_ADDRESS:-} trusted=${CADDY_TRUSTED_PROXIES:-} hsts=${CADDY_HSTS_HEADER:-} profiles=${COMPOSE_PROFILES:-}" >> "$FAKE_DOCKER_LOG"
fi
args=" $* "
case "$args" in
  *" pull "*) [ "${FAKE_STOP_AT_PULL:-0}" = 1 ] && exit 97 ;;
esac
case "$args" in
  *"{{.Image}}"*) echo "sha256:previous" ;;
  *" inspect --format "*) echo healthy ;;
  *" ps -q "*) echo "c0ffee000001" ;;
  *"migrate --plan"*) printf 'Planned operations:\nusers.0038_accounts_example\n' ;;
  *"migrate --noinput"*) [ "${FAKE_FAIL_MIGRATE:-0}" = 1 ] && exit 1 ;;
esac
exit 0
"""


def _run_in_temp_repo(
    script: str,
    env_lines: dict[str, str],
    shell_env: dict[str, str] | None = None,
    args: tuple[str, ...] = (),
):
    """Run a copy of a deploy script (with scripts/deploy) in a temp dir with a fake docker."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copy(DEPLOY_SCRIPT, work / "deploy-prod.sh")
        shutil.copytree(DEPLOY_LIB, work / "scripts" / "deploy")
        (work / "docker-compose.prod.yml").write_text("services: {}\n", encoding="utf-8")
        (work / ".env").write_text(
            "\n".join(f"{key}={value}" for key, value in env_lines.items()) + "\n",
            encoding="utf-8",
        )
        bin_dir = work / "bin"
        bin_dir.mkdir()
        docker = bin_dir / "docker"
        docker.write_text(FAKE_DOCKER, encoding="utf-8")
        docker.chmod(0o755)
        log = work / "docker.log"
        env = {
            "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
            "HOME": tmp,
            "FAKE_DOCKER_LOG": str(log),
            **(shell_env or {}),
        }
        result = subprocess.run(  # noqa: S603 - our own script in a temp copy
            ["bash", script, *args],  # noqa: S607
            cwd=work,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        calls = log.read_text(encoding="utf-8") if log.exists() else ""
    return result, calls


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class DeployScriptRefusalTests(SimpleTestCase):
    def _run(self, env_lines: dict[str, str], shell_env: dict[str, str] | None = None):
        return _run_in_temp_repo(
            "deploy-prod.sh", env_lines, {"FAKE_STOP_AT_PULL": "1", **(shell_env or {})}
        )

    def test_safe_config_passes_every_refusal(self):
        result, calls = self._run(SAFE_ENV)
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertNotIn("Refusing", result.stdout)
        self.assertIn("compose -f docker-compose.prod.yml config -q", calls)
        # Tunnel mode: no public-ports override, the tunnel profile is on.
        self.assertNotIn("public-ports.yml", calls)
        self.assertIn("profiles: bundled-db,tunnel", result.stdout)

    def test_each_placeholder_is_refused(self):
        cases = {
            "DJANGO_SECRET_KEY": "change_me_in_production",
            "METRICS_PASSWORD": "change_me",
            "ALLOWED_HOSTS": "localhost,127.0.0.1,web",
            "DB_PASSWORD": "<generate>",
        }
        for var, value in cases.items():
            with self.subTest(var=var):
                result, calls = self._run({**SAFE_ENV, var: value})
                self.assertEqual(result.returncode, 1)
                self.assertIn("Refusing to deploy", result.stdout)
                self.assertIn(var, result.stdout)
                self.assertNotIn("config -q", calls, "nothing runs before the refusal")

    def test_missing_allowed_hosts_and_short_secret_are_refused(self):
        env = {key: value for key, value in SAFE_ENV.items() if key != "ALLOWED_HOSTS"}
        env["DJANGO_SECRET_KEY"] = "too-short"
        result, _ = self._run(env)
        self.assertEqual(result.returncode, 1)
        self.assertIn("ALLOWED_HOSTS (unset or only local names)", result.stdout)
        self.assertIn("DJANGO_SECRET_KEY (placeholder or shorter than 50", result.stdout)

    def test_hosts_must_include_the_domain(self):
        result, _ = self._run({**SAFE_ENV, "ALLOWED_HOSTS": "other.example"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("does not list DOMAIN_NAME's host anishows.com", result.stdout)

    def test_override_lets_one_run_through_with_a_warning(self):
        result, calls = self._run(
            {**SAFE_ENV, "DJANGO_SECRET_KEY": "change_me_in_production"},
            shell_env={"ALLOW_INSECURE_DEFAULTS": "1"},
        )
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertIn("ALLOW_INSECURE_DEFAULTS=1", result.stdout)
        self.assertIn("config -q", calls)

    def test_tunnel_mode_needs_a_token_or_an_external_tunnel(self):
        env = {key: value for key, value in SAFE_ENV.items() if key != "TUNNEL_TOKEN"}
        result, _ = self._run(env)
        self.assertEqual(result.returncode, 1)
        self.assertIn("needs a real TUNNEL_TOKEN", result.stdout)
        result, _ = self._run({**env, "TUNNEL_EXTERNAL": "1"})
        self.assertEqual(result.returncode, 97, result.stdout)
        self.assertRegex(result.stdout, r"(?m)profiles: bundled-db$")

    def test_public_mode_and_external_db(self):
        result, calls = self._run(
            {**SAFE_ENV, "CADDY_MODE": "public", "DB_HOST": "pg.internal", "DB_SSLMODE": "require"}
        )
        self.assertEqual(result.returncode, 97, result.stdout)
        self.assertIn("-f infra/compose/public-ports.yml", calls)
        self.assertIn("profiles: none", result.stdout)

    def test_env_values_with_spaces_and_comments_parse(self):
        result, _ = self._run(
            {
                **SAFE_ENV,
                "ADMIN_ALLOW_CIDRS": '"203.0.113.0/24 2001:db8::/48"',
                "SCALE_WEB": "2   # comment",
            }
        )
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertNotIn("malformed", result.stdout)


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class DeployScriptFailureRecipeTests(SimpleTestCase):
    """What the operator reads when a deploy fails after the schema changed."""

    def _run(self, **shell_env):
        return _run_in_temp_repo(
            "deploy-prod.sh",
            SAFE_ENV,
            {"SKIP_ANILIST_SMOKE": "1", "SKIP_PULL": "1", **shell_env},
        )

    def test_failure_after_migrate_prints_a_working_rollback(self):
        result, calls = self._run()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        out = result.stdout
        self.assertIn("pre-migrate", calls, "a non-empty plan takes a backup first")
        self.assertIn("-e BACKUP_REMOTE=", calls, "the pre-migrate dump stays local")
        self.assertIn("Rollback recipe", out)
        # The previous image is local: the recipe must not try to pull it.
        self.assertIn("docker tag sha256:previous ghcr.io/oddava/anishows-backend:rollback", out)
        self.assertIn("BACKEND_TAG=rollback SKIP_PULL=1", out)
        self.assertIn("python manage.py migrate <app> <previous_migration>", out)
        self.assertIn("restore.sh", out)

    def test_a_partial_migrate_still_lists_the_schema_steps(self):
        result, _ = self._run(FAKE_FAIL_MIGRATE="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Rollback recipe", result.stdout)
        self.assertIn("undo the migrations", result.stdout)
        self.assertIn("restore.sh", result.stdout)

    def test_no_recipe_when_nothing_changed(self):
        result, _ = _run_in_temp_repo(
            "deploy-prod.sh", {**SAFE_ENV, "DJANGO_SECRET_KEY": "x"}, {"FAKE_STOP_AT_PULL": "1"}
        )
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("Rollback recipe", result.stdout)

    def test_placeholder_tunnel_token_is_refused_before_anything_runs(self):
        result, calls = _run_in_temp_repo(
            "deploy-prod.sh", {**SAFE_ENV, "TUNNEL_TOKEN": "<from the Cloudflare dashboard>"}
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("needs a real TUNNEL_TOKEN", result.stdout)
        self.assertEqual(calls, "")


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class ComposeWrapperTests(SimpleTestCase):
    """scripts/deploy/compose.sh gives manual commands the deploy's mode."""

    def _env_line(self, env_lines: dict[str, str]) -> str:
        result, calls = _run_in_temp_repo("scripts/deploy/compose.sh", env_lines, args=("ps",))
        self.assertEqual(result.returncode, 0, result.stderr)
        (line,) = [entry for entry in calls.splitlines() if entry.startswith("env: ")]
        return line

    def test_tunnel_mode_without_the_deploy_script(self):
        line = self._env_line(SAFE_ENV)
        self.assertIn("mode=tunnel site=:80 ", line)
        self.assertIn("trusted=10.250.250.240/29 127.0.0.1/8 ::1/128 ", line)
        self.assertIn("hsts=max-age=31536000; includeSubDomains; preload ", line)
        self.assertTrue(line.endswith("profiles=bundled-db,tunnel"), line)

    def test_external_cloudflared_trusts_private_ranges(self):
        line = self._env_line({**SAFE_ENV, "TUNNEL_EXTERNAL": "1"})
        self.assertIn("trusted=private_ranges ", line)
        self.assertTrue(line.endswith("profiles=bundled-db"), line)

    def test_public_mode_keeps_every_listed_host(self):
        line = self._env_line(
            {
                **SAFE_ENV,
                "CADDY_MODE": "public",
                "DOMAIN_NAME": "'anishows.com, www.anishows.com'",
                "SECURE_HSTS_PRELOAD": "False",
            }
        )
        self.assertIn("mode=public site=anishows.com, www.anishows.com ", line)
        self.assertIn("trusted=127.0.0.1/8 ::1/128 ", line)
        self.assertIn("hsts=max-age=31536000; includeSubDomains profiles", line)

    def test_dollar_in_an_unquoted_value_is_refused(self):
        result, _ = _run_in_temp_repo(
            "scripts/deploy/compose.sh", {**SAFE_ENV, "DB_PASSWORD": "ab$cd"}, args=("ps",)
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DB_PASSWORD contains '$'", result.stderr)
        result, _ = _run_in_temp_repo(
            "scripts/deploy/compose.sh", {**SAFE_ENV, "DB_PASSWORD": "'ab$cd'"}, args=("ps",)
        )
        self.assertEqual(result.returncode, 0, result.stderr)
