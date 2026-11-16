""".env.production.example is the one list of production variables (G7 contract).

Every environment variable a settings module reads, and every variable the
production compose files interpolate, must appear in the template (as
``NAME=`` or as a commented ``# NAME=`` default), unless it is dev/test-only.
When a group adds an ``os.getenv`` in its ``features/*.py``, this fails until
the integrator (G7's rebase) lists the variable.
"""

import ast
import re
from pathlib import Path

from django.test import SimpleTestCase

from apps.core.checks import is_placeholder_secret_key

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = REPO_ROOT / ".env.production.example"
SETTINGS_DIR = REPO_ROOT / "root" / "settings"
COMPOSE_FILES = [
    REPO_ROOT / "docker-compose.prod.yml",
    *sorted((REPO_ROOT / "infra" / "compose").glob("*.yml")),
]

# Read by settings, but never set in production.
DEV_ONLY = {
    "DJANGO_SETTINGS_MODULE",
    "TEST_DB_DATABASE",
    "TEST_DB_HOST",
    "TEST_DB_NAME",
    "TEST_DB_PASSWORD",
    "TEST_DB_PORT",
    "TEST_DB_USER",
}
# Helpers whose first argument is an environment variable name.
ENV_READERS = {"getenv", "_env_bool", "_env_int", "_env_float", "_env_flag", "_env_number"}
# Values deploy-prod.sh refuses; the template must hold placeholders there.
SECRETS = (
    "DJANGO_SECRET_KEY",
    "DB_PASSWORD",
    "REDIS_PASSWORD",
    "AWS_SECRET_ACCESS_KEY",
    "METRICS_PASSWORD",
    "UMAMI_DB_PASSWORD",
    "UMAMI_APP_SECRET",
    "TUNNEL_TOKEN",
)
_LINE = re.compile(r"^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$")


def _template_entries() -> dict[str, tuple[bool, str]]:
    """NAME -> (is_active, value) for every NAME= / # NAME= line."""
    entries: dict[str, tuple[bool, str]] = {}
    for line in TEMPLATE.read_text(encoding="utf-8").splitlines():
        match = _LINE.match(line.strip())
        if match:
            name = match.group(2)
            active = match.group(1) is None
            if active or name not in entries:
                entries[name] = (active, match.group(3))
    return entries


def _settings_env_names() -> set[str]:
    names: set[str] = set()
    for path in SETTINGS_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            func = node.func
            func_name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            is_environ_get = (
                isinstance(func, ast.Attribute)
                and func.attr == "get"
                and isinstance(func.value, ast.Attribute)
                and func.value.attr == "environ"
            )
            if func_name in ENV_READERS or is_environ_get:
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    names.add(first.value)
        for node in ast.walk(tree):  # os.environ["X"]
            if (
                isinstance(node, ast.Subscript)
                and isinstance(node.value, ast.Attribute)
                and node.value.attr == "environ"
                and isinstance(node.slice, ast.Constant)
                and isinstance(node.slice.value, str)
            ):
                names.add(node.slice.value)
    return names


def _compose_names() -> set[str]:
    names: set[str] = set()
    for path in COMPOSE_FILES:
        names |= set(re.findall(r"(?<!\$)\$\{([A-Z][A-Z0-9_]*)", path.read_text(encoding="utf-8")))
    return names


class EnvTemplateTests(SimpleTestCase):
    entries: dict[str, tuple[bool, str]]

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.entries = _template_entries()

    def test_every_settings_variable_is_listed(self):
        names = _settings_env_names()
        self.assertGreater(len(names), 50, "the AST scan found suspiciously few names")
        missing = sorted(names - DEV_ONLY - set(self.entries))
        self.assertEqual(missing, [], f"add these to .env.production.example: {missing}")

    def test_every_compose_variable_is_listed(self):
        missing = sorted(_compose_names() - set(self.entries))
        self.assertEqual(missing, [], f"add these to .env.production.example: {missing}")

    def test_secrets_hold_placeholders_only(self):
        for name in SECRETS:
            with self.subTest(name=name):
                self.assertIn(name, self.entries)
                _, value = self.entries[name]
                self.assertTrue(
                    value == "" or value.startswith("<"),
                    f"{name} must be empty or a <placeholder>, got {value!r}",
                )
                if name == "DJANGO_SECRET_KEY":
                    self.assertTrue(is_placeholder_secret_key(value))

    def test_values_with_spaces_are_quoted(self):
        # deploy-prod.sh and compose both read .env; an unquoted space breaks neither,
        # but quoting keeps the file valid for any POSIX-style parser.
        for name, (active, value) in self.entries.items():
            if not active or not value or value.startswith("<"):
                continue
            with self.subTest(name=name):
                bare = value.split(" #", 1)[0].strip()
                if " " in bare:
                    self.assertRegex(bare, r'^".*"$|^\'.*\'$')

    def test_production_mode_defaults(self):
        self.assertEqual(self.entries["DJANGO_ENV"], (True, "production"))
        self.assertEqual(self.entries["CADDY_MODE"], (True, "tunnel"))
        self.assertEqual(self.entries["DRF_NUM_PROXIES"], (True, "1"))
        self.assertEqual(self.entries["BACKUP_KEEP"], (True, "7"))
        for name in ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "ADMIN_ALLOW_CIDRS"):
            self.assertIn(name, self.entries)
