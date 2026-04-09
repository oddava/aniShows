import base64
import os

from django.http import HttpResponse, HttpResponseForbidden
from django.views import View
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    generate_latest,
    multiprocess,
)

from ...shared.logger import logger


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
        if os.getenv("METRICS_ENABLED", "true").lower() != "true":
            return False

        if self._get_metrics_credentials() is None:
            logger.error(
                "Metrics endpoint disabled: explicit non-default METRICS_USERNAME and "
                "METRICS_PASSWORD must be configured"
            )
            return False

        return True

    def _verify_auth(self, request) -> bool:
        credentials = self._get_metrics_credentials()
        if credentials is None:
            return False
        expected_username, expected_password = credentials

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

    @staticmethod
    def _get_metrics_credentials() -> tuple[str, str] | None:
        username = (os.getenv("METRICS_USERNAME") or "").strip()
        password = (os.getenv("METRICS_PASSWORD") or "").strip()

        if not username or not password:
            return None
        if username == "admin" and password == "admin":
            return None

        return username, password

    def _generate_metrics(self) -> bytes:
        if "PROMETHEUS_MULTIPROC_DIR" in os.environ:
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(
                registry, path=os.environ["PROMETHEUS_MULTIPROC_DIR"]
            )
            return generate_latest(registry)
        else:
            from ...animes.services.metrics import get_metrics_registry

            registry = get_metrics_registry()
            if registry:
                return generate_latest(registry)
            else:
                return generate_latest()
