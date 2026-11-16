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
timeout = _env_int("GUNICORN_TIMEOUT", 60)
graceful_timeout = _env_int("GUNICORN_GRACEFUL_TIMEOUT", 30)
keepalive = _env_int("GUNICORN_KEEPALIVE", 15)

# =============================================================================
# Preloading
# =============================================================================
# Preload app to share memory across workers (copy-on-write)
preload_app = True
worker_tmp_dir = os.getenv("GUNICORN_WORKER_TMP_DIR", "/dev/shm")  # noqa: S108

# =============================================================================
# Logging
# =============================================================================
# LOG_FORMAT=json (production default): gunicorn's own lines use the same JSON
# formatter as Django (root/log_formatting.py). Its access log is off, because
# Caddy and the app already log requests; GUNICORN_ACCESS_LOG=1 turns it on.
# LOG_FORMAT=text keeps the previous plain stream with the access log.
log_format = (os.getenv("LOG_FORMAT") or "json").strip().lower()
_access_default = log_format != "json"
_access_raw = os.getenv("GUNICORN_ACCESS_LOG")
access_log_enabled = (
    _access_default
    if _access_raw is None or not _access_raw.strip()
    else _access_raw.strip().lower() in {"1", "true", "yes", "on"}
)
accesslog = "-" if access_log_enabled else None  # stdout
errorlog = "-"  # stderr
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "warning")

if log_format == "json":
    logconfig_dict = {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {"request_id": {"()": "root.log_formatting.RequestIdFilter"}},
        "formatters": {"json": {"()": "root.log_formatting.JsonFormatter"}},
        "handlers": {
            "error_console": {
                "class": "logging.StreamHandler",
                "formatter": "json",
                "filters": ["request_id"],
                "stream": "ext://sys.stderr",
            },
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "json",
                "filters": ["request_id"],
                "stream": "ext://sys.stdout",
            },
        },
        "loggers": {
            "gunicorn.error": {
                "level": loglevel.upper(),
                "handlers": ["error_console"],
                "propagate": False,
                "qualname": "gunicorn.error",
            },
            "gunicorn.access": {
                "level": "INFO",
                "handlers": ["console"] if access_log_enabled else [],
                "propagate": False,
                "qualname": "gunicorn.access",
            },
        },
        "root": {"level": "WARNING", "handlers": []},
    }

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
