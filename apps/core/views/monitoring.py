import base64
import os

from django.conf import settings
from django.http import HttpResponse, HttpResponseForbidden
from django.views import View
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    generate_latest,
    multiprocess,
)
from apps.shared.logger import logger

class MetricsView(View):
    def get(self, request, *args, **kwargs) -> HttpResponse:
        if not self._is_metrics_enabled():
            return HttpResponseForbidden("Metrics endpoint disabled")

        if not self._verify_auth(request):
            response = HttpResponseForbidden("Authentication required")
            response["WWW-Authenticate"] = 'Basic realm="Metrics"'
            return response

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
        return os.getenv("METRICS_ENABLED", "true").lower() == "true"

    def _verify_auth(self, request) -> bool:
        expected_username = os.getenv("METRICS_USERNAME", "admin")
        expected_password = os.getenv("METRICS_PASSWORD", "admin")

        if not expected_password or expected_password == "admin":
            logger.warning(
                "Metrics endpoint using default credentials - change METRICS_PASSWORD in production!"
            )

        auth_header = request.META.get("HTTP_AUTHORIZATION", "")

        if not auth_header.startswith("Basic "):
            return False

        try:
            encoded_credentials = auth_header.split(" ", 1)[1]
            decoded_credentials = base64.b64decode(encoded_credentials).decode("utf-8")
            username, password = decoded_credentials.split(":", 1)

            return username == expected_username and password == expected_password
        except Exception as e:
            logger.warning(f"Invalid auth header: {e}")
            return False

    def _generate_metrics(self) -> bytes:
        if "PROMETHEUS_MULTIPROC_DIR" in os.environ:
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(
                registry, path=os.environ["PROMETHEUS_MULTIPROC_DIR"]
            )
            return generate_latest(registry)
        else:
            from apps.animes.services.metrics import get_metrics_registry

            registry = get_metrics_registry()
            if registry:
                return generate_latest(registry)
            else:
                return generate_latest()
