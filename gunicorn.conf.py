"""
Gunicorn configuration for aniShows production deployment.

This file centralizes all gunicorn settings so docker-compose, Dockerfile,
and deploy scripts don't need to duplicate CLI flags.

Usage: gunicorn root.wsgi:application -c gunicorn.conf.py
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
workers = int(os.getenv("GUNICORN_WORKERS", min(multiprocessing.cpu_count() * 2 + 1, 4)))
worker_class = "gthread"
threads = 4

# =============================================================================
# Worker Lifecycle
# =============================================================================
# Restart workers after N requests to prevent memory leaks
max_requests = 1000
max_requests_jitter = 100

# =============================================================================
# Timeouts
# =============================================================================
timeout = 30  # Kill worker if request takes longer than 30s
graceful_timeout = 15  # Time for worker to finish after SIGTERM
keepalive = 5  # Keep-alive connections for reverse proxy (Caddy)

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
