import ipaddress
import os
from functools import lru_cache


@lru_cache(maxsize=1)
def _trusted_proxy_networks() -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    raw = os.getenv("TRUSTED_PROXY_CIDRS", "")
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []

    for candidate in (item.strip() for item in raw.split(",")):
        if not candidate:
            continue
        try:
            networks.append(ipaddress.ip_network(candidate, strict=False))
        except ValueError:
            continue

    return tuple(networks)


def _parse_ip(value: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    if not value:
        return None

    candidate = value.strip()
    if not candidate:
        return None

    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return None


def _is_trusted_proxy(value: str | None) -> bool:
    ip_obj = _parse_ip(value)
    if ip_obj is None:
        return False

    return any(ip_obj in network for network in _trusted_proxy_networks())


def get_client_ip(request):
    """Get the client's IP address from the request.

    Trust ``X-Forwarded-For`` only when the immediate sender is an explicitly
    configured trusted proxy via ``TRUSTED_PROXY_CIDRS``.
    """
    remote_addr = request.META.get("REMOTE_ADDR")

    if not _is_trusted_proxy(remote_addr):
        return remote_addr or "0.0.0.0"  # noqa: S104

    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if not x_forwarded_for:
        return remote_addr or "0.0.0.0"  # noqa: S104

    forwarded_ips = [item.strip() for item in x_forwarded_for.split(",") if item.strip()]
    for candidate in reversed(forwarded_ips):
        if _parse_ip(candidate) is None:
            return remote_addr or "0.0.0.0"  # noqa: S104
        if not _is_trusted_proxy(candidate):
            return candidate

    return forwarded_ips[0] if forwarded_ips else (remote_addr or "0.0.0.0")  # noqa: S104
