"""
Prometheus metrics endpoint with HTTP Basic Authentication.

Provides:
- /metrics endpoint for Prometheus scraping
- HTTP Basic Auth protection
- Multi-process support for Celery workers
"""

import base64
import logging
import os
from typing import Optional

from django.conf import settings
from django.http import HttpResponse, HttpResponseForbidden
from django.views import View
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    generate_latest,
    multiprocess,
)

logger = logging.getLogger(__name__)


class MetricsView(View):
    """
    Prometheus metrics endpoint with Basic Auth.

    URL: /metrics
    Authentication: HTTP Basic Auth (configured via env vars)
    """

    def get(self, request, *args, **kwargs) -> HttpResponse:
        """Handle GET request for metrics."""
        # Check if metrics are enabled
        if not self._is_metrics_enabled():
            return HttpResponseForbidden("Metrics endpoint disabled")

        # Verify Basic Auth
        if not self._verify_auth(request):
            response = HttpResponseForbidden("Authentication required")
            response["WWW-Authenticate"] = 'Basic realm="Metrics"'
            return response

        # Generate and return metrics
        try:
            metrics_data = self._generate_metrics()
            return HttpResponse(metrics_data, content_type=CONTENT_TYPE_LATEST)
        except Exception as e:
            logger.error(f"Error generating metrics: {e}")
            return HttpResponse(
                f"# Error generating metrics: {e}\n",
                content_type=CONTENT_TYPE_LATEST,
                status=500,
            )

    def _is_metrics_enabled(self) -> bool:
        """Check if metrics endpoint is enabled."""
        return os.getenv("METRICS_ENABLED", "true").lower() == "true"

    def _verify_auth(self, request) -> bool:
        """
        Verify HTTP Basic Auth credentials.

        Returns:
            True if auth is valid or disabled, False otherwise
        """
        # Get credentials from environment
        expected_username = os.getenv("METRICS_USERNAME", "admin")
        expected_password = os.getenv("METRICS_PASSWORD", "admin")

        # If no password is set, allow access (development mode)
        if not expected_password or expected_password == "admin":
            logger.warning(
                "Metrics endpoint using default credentials - change METRICS_PASSWORD in production!"
            )

        # Get Authorization header
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")

        if not auth_header.startswith("Basic "):
            return False

        try:
            # Decode credentials
            encoded_credentials = auth_header.split(" ", 1)[1]
            decoded_credentials = base64.b64decode(encoded_credentials).decode("utf-8")
            username, password = decoded_credentials.split(":", 1)

            # Verify credentials
            return username == expected_username and password == expected_password
        except Exception as e:
            logger.warning(f"Invalid auth header: {e}")
            return False

    def _generate_metrics(self) -> bytes:
        """
        Generate Prometheus metrics.

        Supports multi-process mode for Celery workers.
        """
        # Check if we're in multi-process mode
        if "PROMETHEUS_MULTIPROC_DIR" in os.environ:
            # Multi-process mode (for Celery workers)
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(
                registry, path=os.environ["PROMETHEUS_MULTIPROC_DIR"]
            )
            return generate_latest(registry)
        else:
            # Single-process mode (default registry)
            from apps.animes.services.metrics import get_metrics_registry

            registry = get_metrics_registry()
            if registry:
                return generate_latest(registry)
            else:
                # Fallback to default registry
                return generate_latest()
