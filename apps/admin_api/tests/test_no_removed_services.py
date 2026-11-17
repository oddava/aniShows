"""No Jikan, Mongo, Typesense or theme-sync remnants in G6's admin code (spec 6 checklist)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
G6_PATHS = [
    "apps/admin_api",
    "apps/core/views/admin_import_jobs.py",
    "apps/core/views/celery_admin.py",
    "apps/core/services/admin_import_jobs_service.py",
    "apps/core/services/celery_admin_service.py",
    "apps/core/services/celery_monitoring.py",
    "apps/core/middleware",
    "apps/users/views/admin_badges.py",
    "frontend/src/pages/admin",
    "frontend/src/components/AdminLayout.jsx",
]
REMNANT = re.compile(r"jikan|typesense|mongo|themes_status", re.IGNORECASE)
SKIP = {Path(__file__).resolve()}


def _files():
    for relative in G6_PATHS:
        path = ROOT / relative
        if path.is_file():
            yield path
        elif path.is_dir():
            yield from (
                child
                for child in path.rglob("*")
                if child.suffix in {".py", ".js", ".jsx"} and "node_modules" not in child.parts
            )


def test_no_removed_service_strings_in_g6_files():
    hits = [
        f"{path.relative_to(ROOT)}:{number}"
        for path in _files()
        if path.resolve() not in SKIP
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if REMNANT.search(line)
    ]
    assert hits == []
