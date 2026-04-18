"""
Gunicorn configuration for aniShows production deployment.

This file centralizes all gunicorn settings so docker-compose, Dockerfile,
and deploy scripts don't need to duplicate CLI flags.

Usage: gunicorn root.asgi:application -c gunicorn.conf.py
"""

import os
from contextlib import suppress
from pathlib import Path

from root.gunicorn_tuning import default_gunicorn_workers


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default

# =============================================================================
# Server Socket
# =============================================================================
bind = "0.0.0.0:8000"
backlog = _env_int("GUNICORN_BACKLOG", 4096)

# =============================================================================
# Worker Processes
# =============================================================================
# Default conservatively inside containers to avoid oversubscribing CPU.
# Override via GUNICORN_WORKERS env var if needed.
default_workers = default_gunicorn_workers()
workers = _env_int("GUNICORN_WORKERS", default_workers)
worker_class = os.getenv("GUNICORN_WORKER_CLASS", "uvicorn.workers.UvicornWorker")
reuse_port = os.getenv("GUNICORN_REUSE_PORT", "True").strip().lower() in {"1", "true", "yes", "on"}

# =============================================================================
# Worker Lifecycle
# =============================================================================
# Restart workers after N requests to prevent memory leaks
max_requests = _env_int("GUNICORN_MAX_REQUESTS", 2000)
max_requests_jitter = _env_int("GUNICORN_MAX_REQUESTS_JITTER", 200)

# =============================================================================
# Timeouts
# =============================================================================
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "15"))

# =============================================================================
# Preloading
# =============================================================================
# Preload app to share memory across workers (copy-on-write)
preload_app = True
worker_tmp_dir = os.getenv("GUNICORN_WORKER_TMP_DIR", "/dev/shm")  # noqa: S108

# =============================================================================
# Logging
# =============================================================================
accesslog = "-"  # stdout
errorlog = "-"  # stderr
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "warning")

# =============================================================================
# Security
# =============================================================================
# Limit request sizes to prevent abuse
limit_request_line = 8190
limit_request_fields = 100
limit_request_field_size = 8190


# =============================================================================
# Metrics Collection (Multiprocess Mode)
# =============================================================================
def child_exit(server, worker):
    """Mark process dead for multiprocess metrics collection."""
    from prometheus_client import multiprocess

    multiprocess.mark_process_dead(worker.pid)


def on_starting(server):
    """Clean up the multiprocess metrics directory on start."""
    path = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if path:
        multiproc_dir = Path(path)
        if not multiproc_dir.exists():
            multiproc_dir.mkdir(parents=True, exist_ok=True)
        else:
            for db_file in multiproc_dir.glob("*.db"):
                with suppress(OSError):
                    db_file.unlink()
