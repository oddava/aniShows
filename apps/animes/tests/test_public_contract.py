"""Response-shape contract for the public read endpoints.

Refactors must not change what clients receive. This test reduces each response
to its *shape* (keys and JSON types, recursively; list items merged) and
compares it with ``snapshots/public_contract.json``. It ignores values, so data
changes don't break it, but it fails if a field is added, removed, renamed or
changes type.

After an approved API change, regenerate the snapshot and commit it:

    UPDATE_CONTRACT_SNAPSHOTS=1 make test ARGS="apps/animes/tests/test_public_contract.py"
"""

import json
import os
from pathlib import Path

import pytest
from rest_framework.test import APIClient

from apps.animes.tests.catalog_fixtures import PUBLIC_ENDPOINTS, build_catalog, build_viewer

SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "public_contract.json"
UPDATE = os.getenv("UPDATE_CONTRACT_SNAPSHOTS") == "1"


def _scalar_type(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    return "str"


def _merge(left, right):
    """Combine two shapes into one that describes both."""
    if left == right:
        return left
    if isinstance(left, dict) and isinstance(right, dict):
        return {
            key: _merge(left.get(key, "absent"), right.get(key, "absent"))
            for key in sorted(left.keys() | right.keys())
        }
    if isinstance(left, list) and isinstance(right, list):
        return [_merge(left[0], right[0])] if left and right else (left or right)
    if isinstance(left, str) and isinstance(right, str):
        return "|".join(sorted(set(left.split("|")) | set(right.split("|"))))
    # Different container kinds, e.g. an object vs null.
    return {"anyOf": sorted([json.dumps(left, sort_keys=True), json.dumps(right, sort_keys=True)])}


def shape_of(value):
    if isinstance(value, dict):
        return {key: shape_of(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        if not value:
            return []
        merged = shape_of(value[0])
        for item in value[1:]:
            merged = _merge(merged, shape_of(item))
        return [merged]
    return _scalar_type(value)


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


@pytest.mark.django_db
def test_public_response_shapes_match_snapshot():
    # The fixtures use fixed dates, so time-relative output (schedule days) is stable.
    catalog = build_catalog(4)
    viewer = build_viewer(catalog)

    shapes = {}
    for name, (build_url, authenticated) in PUBLIC_ENDPOINTS.items():
        client = APIClient()
        if authenticated:
            client.force_authenticate(viewer)
        response = client.get(build_url())
        assert response.status_code == 200, f"{name}: {response.status_code}"
        shapes[name] = shape_of(response.json())

    if UPDATE or not SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.parent.mkdir(exist_ok=True)
        SNAPSHOT_PATH.write_text(
            json.dumps(shapes, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        if not UPDATE:
            pytest.fail(f"Created {SNAPSHOT_PATH.name}; review and commit it, then re-run.")
        return

    expected = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    for name in sorted(expected.keys() | shapes.keys()):
        assert shapes.get(name) == expected.get(name), (
            f"Response shape of '{name}' changed. If this is an approved API change, "
            "regenerate the snapshot (see the module docstring)."
        )
