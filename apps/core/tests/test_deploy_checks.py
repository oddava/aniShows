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
    "AWS_SECRET_ACCESS_KEY": "rustfs-pass-0123456789",
    "METRICS_PASSWORD": "metrics-pass-0123456789",
    "ALLOWED_HOSTS": "anishows.com,www.anishows.com",
    "DOMAIN_NAME": "anishows.com",
    "CADDY_MODE": "tunnel",
    "TUNNEL_TOKEN": "token-for-the-test",
    "ANALYTICS_ENABLED": "0",
    "TRUSTED_PROXY_CIDRS": "10.250.250.0/25",
}

# The default mode: behind the host's existing reverse proxy.
PROXY_ENV = {
    **{key: value for key, value in SAFE_ENV.items() if key not in ("CADDY_MODE", "TUNNEL_TOKEN")},
    "CADDY_TRUSTED_PROXIES": '"10.250.250.1/32 127.0.0.1/8 ::1/128"',
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
  echo "env: mode=${CADDY_MODE:-} site=${CADDY_SITE_ADDRESS:-} trusted=${CADDY_TRUSTED_PROXIES:-} admin=${ADMIN_ALLOW_CIDRS:-} ipheaders=${CADDY_CLIENT_IP_HEADERS:-} hsts=${CADDY_HSTS_HEADER:-} profiles=${COMPOSE_PROFILES:-}" >> "$FAKE_DOCKER_LOG"
  echo "tags: backend=${BACKEND_TAG:-} frontend=${FRONTEND_TAG:-}" >> "$FAKE_DOCKER_LOG"
  echo "umami: origin=${UMAMI_PUBLIC_ORIGIN:-}" >> "$FAKE_DOCKER_LOG"
fi
args=" $* "
case "$args" in
  *" pull "*) [ "${FAKE_STOP_AT_PULL:-0}" = 1 ] && exit 97 ;;
esac
case "$args" in
  *" network inspect "*) [ -n "${FAKE_SUBNET:-}" ] && echo "${FAKE_SUBNET} " ;;
  *"{{.Image}}"*) echo "sha256:previous" ;;
  *" image inspect --format {{.Id}} "*)
    case "$args" in
      *"anishows-backend:sha-new "*) echo "sha256:current-backend" ;;
      *"anishows-frontend:sha-new "*) echo "sha256:current-frontend" ;;
      *"anishows-backend:sha-old "*) echo "sha256:previous" ;;
      *) exit 1 ;;
    esac ;;
  *" images --no-trunc -q "*) printf 'sha256:current-backend\nsha256:current-frontend\nsha256:previous\nsha256:old-one\nsha256:old-two\n' ;;
  *" inspect --format "*) echo healthy ;;
  *" ps -aq "*) echo "c0ffee000001" ;;
  *" ps -q "*) echo "c0ffee000001" ;;
  *"manage.py s3_check"*) [ "${FAKE_FAIL_S3_CHECK:-0}" = 1 ] && exit 1 ;;
  *"migrate --plan"*)
    if [ "${FAKE_EMPTY_PLAN:-0}" = 1 ]; then printf 'Planned operations:\n  No planned migration operations.\n';
    else printf 'Planned operations:\n%s\n' "${FAKE_PLAN:-users.0038_accounts_example}"; fi ;;
  *"migrate --noinput"*) [ "${FAKE_FAIL_MIGRATE:-0}" = 1 ] && exit 1 ;;
esac
exit 0
"""


def _run_in_temp_repo(
    script: str,
    env_lines: dict[str, str],
    shell_env: dict[str, str] | None = None,
    args: tuple[str, ...] = (),
    state: str | None = None,
    deploy_lock: Path | None = None,
):
    """Run a copy of a deploy script (with scripts/deploy) in a temp dir with a fake docker."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        if state is not None or deploy_lock is not None:
            (work / "backups-data").mkdir()
        if state is not None:
            (work / "backups-data" / "deployed.env").write_text(state, encoding="utf-8")
        if deploy_lock is not None:
            (work / "backups-data" / ".deploy.lock").symlink_to(deploy_lock)
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
        # An external cloudflared: its address must be given explicitly.
        result, _ = self._run({**env, "TUNNEL_EXTERNAL": "1"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("TUNNEL_EXTERNAL=1 needs CADDY_TRUSTED_PROXIES", result.stdout)
        result, _ = self._run(
            {
                **env,
                "TUNNEL_EXTERNAL": "1",
                "CADDY_TRUSTED_PROXIES": '"172.30.0.7/32 127.0.0.1/8 ::1/128"',
            }
        )
        self.assertEqual(result.returncode, 97, result.stdout)
        self.assertRegex(result.stdout, r"(?m)profiles: bundled-db$")

    def test_public_mode_and_external_db(self):
        result, calls = self._run(
            {
                **SAFE_ENV,
                "CADDY_MODE": "public",
                "CADDY_ACME_EMAIL": "ops@anishows.com",
                "DB_HOST": "pg.internal",
                "DB_SSLMODE": "require",
            }
        )
        self.assertEqual(result.returncode, 97, result.stdout)
        self.assertIn("-f infra/compose/public-ports.yml", calls)
        self.assertIn("profiles: none", result.stdout)

    def test_public_mode_refuses_a_placeholder_acme_email(self):
        for email in (None, "admin@anishows.local", "<ops-email>"):
            env = {**SAFE_ENV, "CADDY_MODE": "public"}
            if email:
                env["CADDY_ACME_EMAIL"] = email
            with self.subTest(email=email):
                result, calls = self._run(env)
                self.assertEqual(result.returncode, 1)
                self.assertIn("needs a real CADDY_ACME_EMAIL", result.stdout)
                self.assertEqual(calls, "")

    def test_proxy_mode_is_the_default(self):
        result, calls = self._run(PROXY_ENV)
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertIn("Mode: proxy", result.stdout)
        self.assertIn("-f infra/compose/proxy-port.yml", calls)
        self.assertNotIn("public-ports.yml", calls)
        self.assertRegex(result.stdout, r"(?m)profiles: bundled-db$")
        self.assertIn(
            "mode=proxy site=:80 trusted=10.250.250.1/32 127.0.0.1/8 ::1/128 "
            "admin=100::/64 ipheaders=X-Forwarded-For ",
            calls,
        )
        # Empty ADMIN_ALLOW_CIDRS closes the operator routes, and says so.
        self.assertIn("ADMIN_ALLOW_CIDRS is empty", result.stdout)

    def test_proxy_mode_without_a_published_port(self):
        result, calls = self._run(
            {
                **PROXY_ENV,
                "CADDY_PROXY_PUBLISH": "0",
                "COMPOSE_EXTRA_FILES": "docker-compose.prod.yml",
            }
        )
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertNotIn("proxy-port.yml", calls)

    def test_edge_refusals(self):
        """No permissive defaults: each case refuses before anything runs."""
        without = {k: v for k, v in PROXY_ENV.items() if k != "CADDY_TRUSTED_PROXIES"}
        cases = {
            "proxy mode without CADDY_TRUSTED_PROXIES": (
                without,
                "CADDY_MODE=proxy needs CADDY_TRUSTED_PROXIES",
            ),
            "the template's placeholder": (
                {**without, "CADDY_TRUSTED_PROXIES": '"<the proxy> 127.0.0.1/8 ::1/128"'},
                "CADDY_MODE=proxy needs CADDY_TRUSTED_PROXIES",
            ),
            "a wide CADDY_TRUSTED_PROXIES": (
                {**PROXY_ENV, "CADDY_TRUSTED_PROXIES": "private_ranges"},
                "CADDY_TRUSTED_PROXIES lists private_ranges",
            ),
            "TRUSTED_PROXY_CIDRS unset": (
                {k: v for k, v in PROXY_ENV.items() if k != "TRUSTED_PROXY_CIDRS"},
                "TRUSTED_PROXY_CIDRS is unset",
            ),
            "TRUSTED_PROXY_CIDRS placeholder": (
                {**PROXY_ENV, "TRUSTED_PROXY_CIDRS": '"<APP_SUBNET, e.g. 10.250.250.0/25>"'},
                "TRUSTED_PROXY_CIDRS is unset",
            ),
            "TRUSTED_PROXY_CIDRS wide": (
                {**PROXY_ENV, "TRUSTED_PROXY_CIDRS": "10.250.250.0/25,0.0.0.0/0"},
                "TRUSTED_PROXY_CIDRS lists 0.0.0.0/0",
            ),
            "TRUSTED_PROXY_CIDRS wide in tunnel mode too": (
                {**SAFE_ENV, "TRUSTED_PROXY_CIDRS": "::/0"},
                "TRUSTED_PROXY_CIDRS lists ::/0",
            ),
            "ADMIN_ALLOW_CIDRS open to everyone": (
                {**PROXY_ENV, "ADMIN_ALLOW_CIDRS": '"0.0.0.0/0 ::/0"'},
                "ADMIN_ALLOW_CIDRS lists 0.0.0.0/0",
            ),
            "the old private-ranges default for Django": (
                {**PROXY_ENV, "TRUSTED_PROXY_CIDRS": "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"},
                "TRUSTED_PROXY_CIDRS lists 10.0.0.0/8",
            ),
            "a Django trust range outside APP_SUBNET": (
                {**PROXY_ENV, "TRUSTED_PROXY_CIDRS": "172.18.0.0/24"},
                "TRUSTED_PROXY_CIDRS lists 172.18.0.0/24, outside Caddy's network",
            ),
            "a Caddy trust range wider than /16": (
                {**PROXY_ENV, "CADDY_TRUSTED_PROXIES": '"172.16.0.0/12 127.0.0.1/8 ::1/128"'},
                "CADDY_TRUSTED_PROXIES lists 172.16.0.0/12",
            ),
            "ADMIN_ALLOW_CIDRS nearly everyone": (
                {**PROXY_ENV, "ADMIN_ALLOW_CIDRS": '"203.0.113.10/32 0.0.0.0/1"'},
                "ADMIN_ALLOW_CIDRS lists 0.0.0.0/1",
            ),
        }
        for name, (env, message) in cases.items():
            with self.subTest(name):
                result, calls = self._run(env)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("the edge is not configured", result.stdout)
                self.assertIn(message, result.stdout)
                self.assertEqual(calls, "", "nothing runs before the refusal")

    def test_a_whole_docker_network_in_caddys_trust_list_warns(self):
        result, _ = self._run(
            {**PROXY_ENV, "CADDY_TRUSTED_PROXIES": '"172.18.0.0/16 127.0.0.1/8 ::1/128"'}
        )
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertIn("every container on that network can set the client IP", result.stdout)

    def test_a_subset_of_app_subnet_is_fine(self):
        result, _ = self._run({**PROXY_ENV, "TRUSTED_PROXY_CIDRS": "10.250.250.0/28"})
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)

    def test_an_app_network_with_another_subnet_is_refused_before_changes(self):
        result, calls = self._run(PROXY_ENV, shell_env={"FAKE_SUBNET": "172.19.0.0/16"})
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("has subnet 172.19.0.0/16, not APP_SUBNET 10.250.250.0/25", result.stdout)
        self.assertNotIn(" pull ", calls)
        result, _ = self._run(PROXY_ENV, shell_env={"FAKE_SUBNET": "10.250.250.0/25"})
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        # A daemon with IPv6 on adds a v6 subnet: only the IPv4 one is compared.
        result, _ = self._run(PROXY_ENV, shell_env={"FAKE_SUBNET": "fd00:1::/64 10.250.250.0/25"})
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)

    def test_insecure_defaults_override_does_not_open_the_edge(self):
        result, calls = self._run(
            {**PROXY_ENV, "ADMIN_ALLOW_CIDRS": '"0.0.0.0/0 ::/0"'},
            shell_env={"ALLOW_INSECURE_DEFAULTS": "1"},
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(calls, "")

    def test_wide_admin_cidrs_need_their_own_override(self):
        result, calls = self._run(
            {**PROXY_ENV, "ADMIN_ALLOW_CIDRS": '"0.0.0.0/0 ::/0"', "ALLOW_WIDE_ADMIN_CIDRS": "1"}
        )
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertIn("admin=0.0.0.0/0 ::/0 ", calls)

    def test_narrow_admin_cidrs_pass(self):
        result, calls = self._run(
            {**PROXY_ENV, "ADMIN_ALLOW_CIDRS": '"203.0.113.10/32 2001:db8::/48"'}
        )
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        self.assertIn("admin=203.0.113.10/32 2001:db8::/48 ", calls)
        self.assertNotIn("ADMIN_ALLOW_CIDRS is empty", result.stdout)

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
        self.assertIn("BACKEND_TAG=rollback FRONTEND_TAG=latest SKIP_PULL=1", out)
        # Undoing migrations needs the NEW image, named explicitly (not .env's tag).
        self.assertIn(
            "BACKEND_TAG=latest scripts/deploy/compose.sh run --rm --no-deps web python manage.py migrate <app>",
            out,
        )
        self.assertIn("restore.sh", out)

    def test_object_storage_is_the_hosts_not_a_bundled_service(self):
        """No bundled MinIO or bucket job; the app proves the host's bucket first."""
        result, calls = self._run()
        out = result.stdout
        lines = calls.splitlines()
        self.assertNotIn("minio", calls.lower())
        self.assertNotIn("createbuckets", calls)
        core = "compose -f docker-compose.prod.yml up -d --wait --no-deps redis db"
        self.assertIn(core, lines)
        probe = "run --rm --no-deps web python manage.py s3_check"
        probe_line = next(i for i, line in enumerate(lines) if line.endswith(probe))
        self.assertGreater(probe_line, lines.index(f"{core}"))
        self.assertIn("==> Object storage", out)
        # Before the configuration check and any schema change.
        for later in ("manage.py check --deploy", "manage.py migrate --plan"):
            later_line = next(i for i, line in enumerate(lines) if later in line)
            self.assertGreater(later_line, probe_line, later)
        self.assertLess(out.index("Object storage"), out.index("Configuration check"))

    def test_a_failing_object_storage_check_stops_the_deploy_before_any_change(self):
        result, calls = self._run(FAKE_FAIL_S3_CHECK="1")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("object storage check failed", result.stdout + result.stderr)
        self.assertIn("anishows-s3 network", result.stdout + result.stderr)
        self.assertNotIn("manage.py check --deploy", calls)
        self.assertNotIn("migrate", calls)
        self.assertNotIn("Rollback recipe", result.stdout)

    def test_recipe_names_the_deployed_and_previous_tags(self):
        result, _ = _run_in_temp_repo(
            "deploy-prod.sh",
            SAFE_ENV,
            {
                "SKIP_ANILIST_SMOKE": "1",
                "SKIP_PULL": "1",
                "BACKEND_TAG": "sha-new",
                "FRONTEND_TAG": "sha-new",
            },
            state=(
                "BACKEND_TAG=sha-old\nFRONTEND_TAG=sha-old\n"
                "BACKEND_IMAGE_ID=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nFRONTEND_IMAGE_ID=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
            ),
        )
        self.assertEqual(result.returncode, 1)
        out = result.stdout
        self.assertIn("This attempt: BACKEND_TAG=sha-new FRONTEND_TAG=sha-new", out)
        self.assertIn("last successful release (sha-old/sha-old)", out)
        self.assertIn("BACKEND_TAG=sha-new scripts/deploy/compose.sh run", out)
        # Backend: the image web runs now; frontend: the live release, by id.
        self.assertIn("docker tag sha256:previous ghcr.io/oddava/anishows-backend:rollback", out)
        self.assertIn(
            "docker tag sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ghcr.io/oddava/anishows-frontend:rollback",
            out,
        )
        self.assertIn("BACKEND_TAG=rollback FRONTEND_TAG=rollback SKIP_PULL=1", out)

    def test_the_adult_rule_sync_is_queued_by_the_new_image_once_live(self):
        """After roll_web and the release record, in a one-off container of the new
        image (the running web may still be the old release, or absent), and a
        failure stops the run. The fake docker cannot complete a roll, so the
        order is checked in the script itself.
        """
        script = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        enqueue = script.index("python manage.py sync_adult_flags --enqueue")
        newline = chr(10)
        self.assertGreater(enqueue, script.index(f"{newline}roll_web{newline}"))
        self.assertGreater(enqueue, script.index('ok "release recorded'))
        line = script[script.rindex(newline, 0, enqueue) : enqueue]
        self.assertIn('"${COMPOSE[@]}" run --rm --no-deps -T web', line)
        self.assertIn("|| die", script[enqueue : enqueue + 200])
        self.assertIn('grep -q "0060_adult_flag_from_anilist" "$PLAN_FILE"', script)

    def test_no_schema_steps_without_migrations(self):
        result, _ = self._run(FAKE_EMPTY_PLAN="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("No schema change in this deploy", result.stdout)
        self.assertNotIn("restore.sh", result.stdout)
        self.assertNotIn("Undo this deploy's migrations", result.stdout)

    def test_a_partial_migrate_still_lists_the_schema_steps(self):
        result, _ = self._run(FAKE_FAIL_MIGRATE="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Rollback recipe", result.stdout)
        self.assertIn("Undo this deploy's migrations", result.stdout)
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
        self.assertIn("hsts=max-age=31536000 ", line)
        self.assertTrue(line.endswith("profiles=bundled-db,tunnel"), line)

    def _umami_line(self, env_lines: dict[str, str]) -> str:
        result, calls = _run_in_temp_repo("scripts/deploy/compose.sh", env_lines, args=("ps",))
        self.assertEqual(result.returncode, 0, result.stderr)
        (line,) = [entry for entry in calls.splitlines() if entry.startswith("umami: ")]
        return line

    def test_analytics_origin_is_derived_for_the_csp(self):
        # ANISHOWS-001: an unset UMAMI_PUBLIC_ORIGIN left the CSP blocking the
        # Umami script on every page.
        line = self._umami_line(
            {**SAFE_ENV, "ANALYTICS_ENABLED": "auto", "UMAMI_DOMAIN": "analytics.example.com"}
        )
        self.assertEqual(line, "umami: origin=https://analytics.example.com")

    def test_analytics_origin_from_the_script_url(self):
        line = self._umami_line(
            {
                **SAFE_ENV,
                "ANALYTICS_ENABLED": "1",
                "VITE_UMAMI_SCRIPT_URL": "https://stats.example.com/script.js",
            }
        )
        self.assertEqual(line, "umami: origin=https://stats.example.com")

    def test_an_explicit_analytics_origin_wins(self):
        line = self._umami_line(
            {
                **SAFE_ENV,
                "ANALYTICS_ENABLED": "auto",
                "UMAMI_DOMAIN": "analytics.example.com",
                "UMAMI_PUBLIC_ORIGIN": "https://cdn.example.com",
            }
        )
        self.assertEqual(line, "umami: origin=https://cdn.example.com")

    def test_no_analytics_no_origin(self):
        self.assertEqual(self._umami_line(SAFE_ENV), "umami: origin=")

    def test_external_cloudflared_gets_no_trust_default(self):
        # No private_ranges fallback: Caddy trusts only loopback (compose's
        # default) until the operator names that cloudflared.
        line = self._env_line({**SAFE_ENV, "TUNNEL_EXTERNAL": "1"})
        self.assertIn("trusted= ", line)
        self.assertIn("ipheaders=CF-Connecting-IP ", line)
        self.assertTrue(line.endswith("profiles=bundled-db"), line)

    def test_proxy_mode_without_the_deploy_script(self):
        result, calls = _run_in_temp_repo("scripts/deploy/compose.sh", PROXY_ENV, args=("ps",))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("-f infra/compose/proxy-port.yml", calls)
        self.assertIn("mode=proxy site=:80 ", calls)
        self.assertIn("ipheaders=X-Forwarded-For ", calls)

    def test_manual_commands_warn_about_an_unconfigured_edge(self):
        env = {k: v for k, v in PROXY_ENV.items() if k != "CADDY_TRUSTED_PROXIES"}
        result, _ = _run_in_temp_repo("scripts/deploy/compose.sh", env, args=("ps",))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CADDY_MODE=proxy needs CADDY_TRUSTED_PROXIES", result.stderr)

    def test_public_mode_keeps_every_listed_host(self):
        line = self._env_line(
            {
                **SAFE_ENV,
                "CADDY_MODE": "public",
                "DOMAIN_NAME": "'anishows.com, www.anishows.com'",
                "SECURE_HSTS_INCLUDE_SUBDOMAINS": "True",
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


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class PruneImagesTests(SimpleTestCase):
    def test_keeps_current_previous_and_in_use_removes_the_rest(self):
        result, calls = _run_in_temp_repo(
            "scripts/deploy/prune_images.sh",
            {},
            {
                "KEEP_REFS": "ghcr.io/oddava/anishows-backend:sha-new "
                "ghcr.io/oddava/anishows-frontend:sha-new",
                "KEEP_IDS": "",
            },
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        removed = {line.split()[-1] for line in calls.splitlines() if line.startswith("rmi -f ")}
        # sha256:previous is the image a container uses; the others are current.
        self.assertEqual(removed, {"sha256:old-one", "sha256:old-two"})
        self.assertIn("images --no-trunc -q --filter label=app.anishows.component", calls)
        # A dangling-image prune would ignore the keep list (the previous
        # release is dangling once its tag moves on).
        self.assertNotIn("image prune", calls)


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class DeployedStateTests(SimpleTestCase):
    def test_manual_compose_runs_the_deployed_tags(self):
        result, calls = _run_in_temp_repo(
            "scripts/deploy/compose.sh",
            {**SAFE_ENV, "BACKEND_TAG": "latest"},
            {"FAKE_LOG_TAGS": "1"},
            args=("ps",),
            state="BACKEND_TAG=sha-new\nFRONTEND_TAG=sha-new\n",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("tags: backend=sha-new frontend=sha-new", calls)

    def test_the_shell_still_wins(self):
        _, calls = _run_in_temp_repo(
            "scripts/deploy/compose.sh",
            SAFE_ENV,
            {"BACKEND_TAG": "sha-pinned"},
            args=("ps",),
            state="BACKEND_TAG=sha-new\n",
        )
        self.assertIn("tags: backend=sha-pinned", calls)

    def test_backslash_in_double_quotes_is_refused(self):
        result, _ = _run_in_temp_repo(
            "scripts/deploy/compose.sh", {**SAFE_ENV, "DB_PASSWORD": '"a\\nb"'}, args=("ps",)
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DB_PASSWORD contains a backslash", result.stderr)


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class DeployTagPrecedenceTests(SimpleTestCase):
    """shell > deployed.env > .env: a config-only re-run keeps the live release."""

    def _release_line(self, env_lines, shell_env=None, state=None):
        result, _ = _run_in_temp_repo(
            "deploy-prod.sh",
            env_lines,
            {"FAKE_STOP_AT_PULL": "1", **(shell_env or {})},
            state=state,
        )
        self.assertEqual(result.returncode, 97, result.stdout + result.stderr)
        (line,) = [entry for entry in result.stdout.splitlines() if entry.startswith("Release: ")]
        return line

    def test_deployed_release_beats_env(self):
        line = self._release_line(
            {**SAFE_ENV, "BACKEND_TAG": "latest", "FRONTEND_TAG": "latest"},
            state="BACKEND_TAG=sha-live\nFRONTEND_TAG=sha-livefe\n",
        )
        self.assertIn("backend=sha-live frontend=sha-livefe (tags from deployed.env", line)

    def test_shell_beats_deployed_release(self):
        line = self._release_line(
            SAFE_ENV,
            {"BACKEND_TAG": "sha-ci", "FRONTEND_TAG": "sha-ci"},
            state="BACKEND_TAG=sha-live\n",
        )
        self.assertIn("backend=sha-ci frontend=sha-ci (tags from shell", line)

    def test_first_deploy_uses_env_or_latest(self):
        line = self._release_line(SAFE_ENV)
        self.assertIn("backend=latest frontend=latest (tags from .env/default", line)

    def test_only_valid_tag_keys_are_read_from_the_state_file(self):
        result, calls = _run_in_temp_repo(
            "scripts/deploy/compose.sh",
            {**SAFE_ENV, "BACKEND_TAG": "sha-env"},
            args=("ps",),
            state=(
                "BACKEND_TAG=bad tag;rm\n"
                "CADDY_TRUSTED_PROXIES=0.0.0.0/0\n"
                "ADMIN_ALLOW_CIDRS=0.0.0.0/0\n"
            ),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("tags: backend=sha-env", calls)
        self.assertIn("trusted=10.250.250.240/29 127.0.0.1/8 ::1/128 ", calls)

    def test_one_deploy_at_a_time(self):
        import fcntl

        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "held.lock"
            with lock.open("w") as handle:
                fcntl.flock(handle, fcntl.LOCK_EX)
                # Point the copy's lock at the held file through a symlink.
                result, calls = _run_in_temp_repo(
                    "deploy-prod.sh", SAFE_ENV, {"FAKE_STOP_AT_PULL": "1"}, deploy_lock=lock
                )
        self.assertEqual(result.returncode, 1)
        self.assertIn("another deploy-prod.sh is running", result.stdout)
        self.assertEqual(calls, "")


LOCK_SCRIPT = REPO_ROOT / "backups" / "shell" / "lock.sh"


@unittest.skipUnless(shutil.which("bash") and shutil.which("flock"), "bash and flock are required")
class BackupLockTests(SimpleTestCase):
    """backups/shell/lock.sh: one holder at a time, released when the holder dies."""

    def _bash(self, script: str, backup_dir: str, timeout: int = 60):
        return subprocess.run(  # noqa: S603 - fixed interpreter, our own script
            ["bash", "-c", script],  # noqa: S607
            env={**os.environ, "BACKUP_DIR": backup_dir, "LOCK_SH": str(LOCK_SCRIPT)},
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

    def test_second_holder_fails_fast_then_waits(self):
        with tempfile.TemporaryDirectory() as tmp:
            holder = subprocess.Popen(
                ["bash", "-c", 'source "$LOCK_SH"; acquire_backup_lock 0; echo held; sleep 6'],  # noqa: S607
                env={**os.environ, "BACKUP_DIR": tmp, "LOCK_SH": str(LOCK_SCRIPT)},
                stdout=subprocess.PIPE,
                text=True,
            )
            try:
                self.assertEqual(holder.stdout.readline().strip(), "held")
                busy = self._bash('source "$LOCK_SH"; acquire_backup_lock 0; echo got', tmp)
                self.assertEqual(busy.returncode, 1)
                self.assertIn("Another backup/restore operation is currently running", busy.stderr)
                waited = self._bash('source "$LOCK_SH"; acquire_backup_lock 30; echo got', tmp)
                self.assertEqual(waited.returncode, 0, waited.stderr)
                self.assertEqual(waited.stdout.strip(), "got")
            finally:
                holder.kill()
                holder.wait()

    def test_a_killed_holder_leaves_no_stale_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            holder = subprocess.Popen(
                ["bash", "-c", 'source "$LOCK_SH"; acquire_backup_lock 0; echo held; sleep 60'],  # noqa: S607
                env={**os.environ, "BACKUP_DIR": tmp, "LOCK_SH": str(LOCK_SCRIPT)},
                stdout=subprocess.PIPE,
                text=True,
            )
            self.assertEqual(holder.stdout.readline().strip(), "held")
            holder.kill()  # SIGKILL: no cleanup runs
            holder.wait()
            # bash's `sleep` child may briefly keep fd 9; give it a moment to exit.
            result = self._bash('source "$LOCK_SH"; acquire_backup_lock 10; echo got', tmp)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "got")

    def test_a_child_cannot_reacquire_so_restore_passes_skip_lock(self):
        # restore.sh holds the lock and runs backup.sh with BACKUP_SKIP_LOCK=1.
        # Without that flag the child would open the file anew and be refused.
        with tempfile.TemporaryDirectory() as tmp:
            result = self._bash(
                'source "$LOCK_SH"; acquire_backup_lock 0; '
                """bash -c 'source "$LOCK_SH"; acquire_backup_lock 0' && echo child-got-it""",
                tmp,
            )
        self.assertNotIn("child-got-it", result.stdout)
        self.assertIn("Another backup/restore operation is currently running", result.stderr)
