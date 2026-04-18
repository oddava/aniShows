"""Helpers for sizing Gunicorn sensibly inside containers."""

from __future__ import annotations

import math
import os


def _read_text(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return None


def _read_cgroup_v2_cpu_limit() -> float | None:
    raw = _read_text("/sys/fs/cgroup/cpu.max")
    if not raw:
        return None

    quota_raw, _, period_raw = raw.partition(" ")
    if not quota_raw or quota_raw == "max" or not period_raw:
        return None

    try:
        quota = int(quota_raw)
        period = int(period_raw)
    except ValueError:
        return None

    if quota <= 0 or period <= 0:
        return None
    return quota / period


def _read_cgroup_v1_cpu_limit() -> float | None:
    quota_raw = _read_text("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
    period_raw = _read_text("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    if not quota_raw or not period_raw:
        return None

    try:
        quota = int(quota_raw)
        period = int(period_raw)
    except ValueError:
        return None

    if quota <= 0 or period <= 0:
        return None
    return quota / period


def detect_available_cpu_count() -> int:
    """Return a container-aware CPU count."""
    detected = _read_cgroup_v2_cpu_limit()
    if detected is None:
        detected = _read_cgroup_v1_cpu_limit()
    if detected is not None:
        return max(math.ceil(detected), 1)

    return max(os.cpu_count() or 1, 1)


def default_gunicorn_workers() -> int:
    """Use a conservative worker baseline for mixed web/background hosts."""
    detected_cores = detect_available_cpu_count()
    return min(max(detected_cores, 2), 4)
