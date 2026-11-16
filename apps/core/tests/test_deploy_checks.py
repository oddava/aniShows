"""Unsafe production configuration is refused: system checks and deploy-prod.sh."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from django.test import SimpleTestCase, override_settings

from apps.core import checks

REPO_ROOT = Path(__file__).resolve().parents[3]
DEPLOY_SCRIPT = REPO_ROOT / "deploy-prod.sh"
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
    def _databases(self, host):
        return {"default": {"ENGINE": "django.db.backends.postgresql", "HOST": host}}

    def test_external_host_without_pool_warns(self):
        with override_settings(DATABASES=self._databases("pg.internal"), DB_POOL_MAX_SIZE=0):
            (warning,) = checks.external_database_pool_check(None)
            self.assertEqual(warning.id, "core.W002")

    def test_pool_or_bundled_db_passes(self):
        with override_settings(DATABASES=self._databases("pg.internal"), DB_POOL_MAX_SIZE=5):
            self.assertEqual(checks.external_database_pool_check(None), [])
        with override_settings(DATABASES=self._databases("db"), DB_POOL_MAX_SIZE=0):
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

# A stand-in `docker`: records each call, succeeds for `compose ... config`,
# and stops the script at the first pull (exit 97), i.e. after every refusal.
FAKE_DOCKER = """#!/usr/bin/env bash
echo "$*" >> "$FAKE_DOCKER_LOG"
case " $* " in
  *" pull "*) exit 97 ;;
esac
exit 0
"""


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class DeployScriptRefusalTests(SimpleTestCase):
    def _run(self, env_lines: dict[str, str], shell_env: dict[str, str] | None = None):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            shutil.copy(DEPLOY_SCRIPT, work / "deploy-prod.sh")
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
            result = subprocess.run(
                ["bash", "deploy-prod.sh"],  # noqa: S607
                cwd=work,
                env=env,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            calls = log.read_text(encoding="utf-8") if log.exists() else ""
        return result, calls

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
        self.assertIn("needs TUNNEL_TOKEN", result.stdout)
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
