"""
Gunicorn configuration for aniShows production deployment.

This file centralizes all gunicorn settings so docker-compose, Dockerfile,
and deploy scripts don't need to duplicate CLI flags.

Usage: gunicorn root.asgi:application -c gunicorn.conf.py
"""

import multiprocessing
import os

# =============================================================================
# Server Socket
# =============================================================================
bind = "0.0.0.0:8000"

# =============================================================================
# Worker Processes
# =============================================================================
# Use 2 * CPU + 1 as baseline, but cap for memory-constrained containers.
# Override via GUNICORN_WORKERS env var if needed.
workers = int(os.getenv("GUNICORN_WORKERS", min(multiprocessing.cpu_count() * 2 + 1, 3)))
worker_class = os.getenv("GUNICORN_WORKER_CLASS", "uvicorn.workers.UvicornWorker")

# =============================================================================
# Worker Lifecycle
# =============================================================================
# Restart workers after N requests to prevent memory leaks
max_requests = 500
max_requests_jitter = 50

# =============================================================================
# Timeouts
# =============================================================================
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))

# =============================================================================
# Preloading
# =============================================================================
# Preload app to share memory across workers (copy-on-write)
preload_app = True

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
# Prometheus Metrics (Multiprocess Mode)
# =============================================================================
def child_exit(server, worker):
    """Mark process dead for Prometheus multiprocess mode"""
    from prometheus_client import multiprocess

    multiprocess.mark_process_dead(worker.pid)


def on_starting(server):
    """Clean up Prometheus multiprocess directory on start"""
    import glob

    path = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if path:
        if not os.path.exists(path):
            os.makedirs(path, exist_ok=True)
        else:
            for f in glob.glob(os.path.join(path, "*.db")):
                try:
                    os.remove(f)
                except OSError:
                    pass
