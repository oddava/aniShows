"""Small query-string helpers shared by admin views."""


def wants_refresh(request) -> bool:
    """``?refresh=1`` asks a cached admin payload to be rebuilt."""
    return str(request.query_params.get("refresh", "")).lower() in {"1", "true", "yes"}
