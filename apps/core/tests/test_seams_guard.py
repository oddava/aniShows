"""Guards for the feature-revamp seams: star re-exports must never collide silently.

Each package below re-exports its group-owned modules with ``from .x import *``. If two
modules exported the same name, the last import would win without any error. Integrator
owned (overview section 4a).
"""

import ast
import importlib
from itertools import combinations
from pathlib import Path

from django.test import SimpleTestCase

STAR_PACKAGES = {
    "apps.users.models": ["accounts", "badges", "lists", "social"],
    "apps.core.models": ["celery", "logs", "notifications", "settings"],
    "apps.users.serializers": [
        "accounts",
        "badges",
        "favorites",
        "lists",
        "notifications",
        "recommendations",
        "social",
    ],
}
FEATURE_MODULES = ["accounts", "admin", "browse", "community", "lists", "notifications", "ops"]


def _assigned_settings(module_name):
    """Uppercase names a module binds at top level (=, annotated =, +=; item updates excluded)."""
    module_file = importlib.import_module(module_name).__file__
    assert module_file is not None
    names = set()
    for node in ast.walk(ast.parse(Path(module_file).read_text(encoding="utf-8"))):
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign | ast.AugAssign):
            targets = [node.target]
        else:
            continue
        names |= {t.id for t in targets if isinstance(t, ast.Name) and t.id.isupper()}
    return names


class SeamsGuardTests(SimpleTestCase):
    def test_star_exported_modules_do_not_overlap(self):
        for package, modules in STAR_PACKAGES.items():
            exports = {m: set(importlib.import_module(f"{package}.{m}").__all__) for m in modules}
            for a, b in combinations(modules, 2):
                with self.subTest(package=package, modules=(a, b)):
                    self.assertFalse(exports[a] & exports[b])

    def test_every_star_export_is_reachable_from_the_package_or_shim(self):
        targets = {
            "apps.users.models": "apps.users.models",
            "apps.core.models": "apps.core.models",
            "apps.users.serializers": "apps.users.serializers.users",
        }
        for package, modules in STAR_PACKAGES.items():
            facade = importlib.import_module(targets[package])
            for m in modules:
                module = importlib.import_module(f"{package}.{m}")
                for name in module.__all__:
                    with self.subTest(module=module.__name__, name=name):
                        self.assertIs(getattr(facade, name), getattr(module, name))

    def test_feature_settings_modules_do_not_define_the_same_setting(self):
        # Updating a base dict in place (REST_FRAMEWORK["..."][...] = ...) is fine from any
        # module; binding the same name in two modules is last-wins, so it must not happen.
        defined = {m: _assigned_settings(f"root.settings.features.{m}") for m in FEATURE_MODULES}
        for a, b in combinations(FEATURE_MODULES, 2):
            with self.subTest(modules=(a, b)):
                self.assertFalse(defined[a] & defined[b])

    def test_feature_settings_modules_never_rebind_a_base_setting(self):
        # Rebinding (REST_FRAMEWORK = {...}, X += [...]) replaces base's value for everyone;
        # update base dicts in place instead.
        base_names = _assigned_settings("root.settings.base")
        for m in FEATURE_MODULES:
            with self.subTest(module=m):
                self.assertFalse(_assigned_settings(f"root.settings.features.{m}") & base_names)
