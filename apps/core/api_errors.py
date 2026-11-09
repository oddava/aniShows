from collections.abc import Mapping

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def _coerce_text(value) -> str:
    if isinstance(value, Mapping):
        for nested in value.values():
            text = _coerce_text(nested)
            if text:
                return text
        return ""
    if isinstance(value, (list, tuple)):
        for nested in value:
            text = _coerce_text(nested)
            if text:
                return text
        return ""
    if value is None:
        return ""
    return str(value)


def _first_code(value) -> str | None:
    if isinstance(value, Mapping):
        for nested in value.values():
            code = _first_code(nested)
            if code:
                return code
        return None
    if isinstance(value, (list, tuple)):
        for nested in value:
            code = _first_code(nested)
            if code:
                return code
        return None
    if value is None:
        return None
    return str(value)


def build_error_payload(*, detail: str, code: str, errors=None) -> dict:
    payload = {
        "detail": detail,
        "code": code,
    }
    if errors is not None:
        payload["errors"] = errors
    return payload


def error_response(
    detail: str,
    *,
    code: str,
    status_code: int,
    errors=None,
    headers: Mapping[str, str] | None = None,
) -> Response:
    return Response(
        build_error_payload(detail=detail, code=code, errors=errors),
        status=status_code,
        headers=headers,
    )


def api_response(
    payload,
    *,
    status_code: int,
    default_code: str = "request_failed",
    headers: Mapping[str, str] | None = None,
) -> Response:
    if status_code < status.HTTP_400_BAD_REQUEST:
        return Response(payload, status=status_code, headers=headers)

    if isinstance(payload, Mapping):
        if set(payload.keys()).issubset({"detail", "code", "errors"}):
            normalized_payload = dict(payload)
            normalized_payload.setdefault("detail", "Request failed.")
            normalized_payload.setdefault("code", default_code)
            return Response(normalized_payload, status=status_code, headers=headers)
        detail = _coerce_text(payload.get("detail") or payload.get("error") or payload.get("errors"))
        errors = payload.get("errors")
        code = str(payload.get("code") or default_code)
    else:
        detail = _coerce_text(payload)
        errors = None
        code = default_code

    return error_response(
        detail or "Request failed.",
        code=code,
        status_code=status_code,
        errors=errors,
        headers=headers,
    )


def _exception_code(exc) -> str | None:
    if hasattr(exc, "get_codes"):
        derived_code = _first_code(exc.get_codes())
        if derived_code:
            return derived_code
    default_code = getattr(exc, "default_code", None)
    return str(default_code) if default_code else None


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(response.data, Mapping) and set(response.data.keys()).issubset(
        {"detail", "code", "errors"}
    ):
        response.data.setdefault("detail", "Request failed.")
        # Keep the exception's own code (e.g. "not_authenticated", "throttled").
        response.data.setdefault("code", _exception_code(exc) or "request_failed")
        return response

    errors = None
    detail = ""
    if isinstance(response.data, Mapping):
        if "detail" in response.data and len(response.data) <= 2:
            detail = _coerce_text(response.data["detail"])
        else:
            errors = response.data
            detail = _coerce_text(
                response.data.get("non_field_errors") or next(iter(response.data.values()), None)
            )
    else:
        detail = _coerce_text(response.data)

    code = "validation_error" if errors is not None else "request_failed"
    if errors is None:
        code = _exception_code(exc) or code

    response.data = build_error_payload(
        detail=detail or "Request failed.",
        code=code,
        errors=errors,
    )
    return response
