"""Signed-in devices: one ``UserSession`` per live refresh-token chain (BUG-008).

Settings showed "Signed in on N devices" with only "Sign out everywhere else",
and N grew with every sign-in: a new sign-in in the same browser minted a new
30-day token and left the one it replaced live. Now:

- a sign-in revokes the token this browser's cookie still holds;
- each device has a row (label, signed in, last active) that follows its
  refresh token across rotations, so devices can be listed and signed out
  one by one.

Rows are cleaned up with their tokens (``flush_expired_tokens``) and whenever
a token is revoked here.
"""

from __future__ import annotations

import re

from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from ..auth_cookies import get_refresh_cookie
from ..models import UserSession
from .auth_service import live_refresh_tokens, lock_user_sessions

UNKNOWN_DEVICE = "Unknown device"

_BROWSERS = (
    (re.compile(r"Edg(?:e|A|iOS)?/"), "Edge"),
    (re.compile(r"OPR/|Opera"), "Opera"),
    (re.compile(r"SamsungBrowser/"), "Samsung Internet"),
    (re.compile(r"Firefox/|FxiOS/"), "Firefox"),
    (re.compile(r"Chrome/|CriOS/"), "Chrome"),
    (re.compile(r"Safari/"), "Safari"),
)
_SYSTEMS = (
    (re.compile(r"iPhone"), "iPhone"),
    (re.compile(r"iPad"), "iPad"),
    (re.compile(r"Android"), "Android"),
    (re.compile(r"Windows"), "Windows"),
    (re.compile(r"CrOS"), "ChromeOS"),
    (re.compile(r"Mac OS X|Macintosh"), "macOS"),
    (re.compile(r"Linux"), "Linux"),
)


def device_label(user_agent: str | None) -> str:
    """A label such as "Firefox on Windows" or "Safari on iPhone", else ``UNKNOWN_DEVICE``."""
    agent = (user_agent or "")[:512]
    browser = next((name for pattern, name in _BROWSERS if pattern.search(agent)), None)
    system = next((name for pattern, name in _SYSTEMS if pattern.search(agent)), None)
    if browser and system:
        return f"{browser} on {system}"
    return browser or system or UNKNOWN_DEVICE


def _request_label(request) -> str:
    return device_label(request.headers.get("User-Agent") if request is not None else None)


def _claims(raw: str, *, verify: bool) -> tuple[int, str] | None:
    """(user id, jti) of a refresh token, or None when it is unusable."""
    try:
        token = RefreshToken(raw, verify=verify)  # type: ignore[arg-type]
        return int(token[jwt_settings.USER_ID_CLAIM]), str(token[jwt_settings.JTI_CLAIM])
    except (TokenError, KeyError, TypeError, ValueError):
        return None


def _blacklist_jti(jti: str) -> None:
    outstanding = OutstandingToken.objects.filter(jti=jti).first()
    if outstanding is not None:
        BlacklistedToken.objects.get_or_create(token=outstanding)


def begin_device_session(request, refresh: str) -> None:
    """A sign-in on this device issued ``refresh``: record the device, retire its old token.

    The browser's cookie (if any) is about to be replaced, so the token it
    holds would otherwise stay live, unused, until it expired: one more
    "device" per sign-in.
    """
    new = _claims(refresh, verify=False)
    if new is None:
        return
    user_id, jti = new
    previous_raw = get_refresh_cookie(request) if request is not None else None
    previous = _claims(previous_raw, verify=True) if previous_raw else None

    if previous and previous[1] != jti:
        with transaction.atomic():
            for locked in sorted({user_id, previous[0]}):  # same order everywhere
                lock_user_sessions(locked)
            _blacklist_jti(previous[1])
            UserSession.objects.filter(jti=previous[1]).delete()
    # A new token's jti is new: a plain insert (one query on the login path).
    UserSession.objects.create(user_id=user_id, jti=jti, device=_request_label(request))


def rotate_device_session(request, old_jti: str, new_refresh: str) -> None:
    """A refresh replaced ``old_jti``: the device's row moves to the new token.

    Runs inside the refresh's transaction (the user row is locked). A device
    signed in before rows existed gets one now.
    """
    new = _claims(new_refresh, verify=False)
    if new is None:
        return
    user_id, new_jti = new
    now = timezone.now()
    updated = UserSession.objects.filter(jti=old_jti).update(
        jti=new_jti, last_seen_at=now, device=_request_label(request)
    )
    if not updated:
        UserSession.objects.update_or_create(
            jti=new_jti,
            defaults={"user_id": user_id, "device": _request_label(request), "last_seen_at": now},
        )


def end_device_session(raw_refresh: str | None) -> None:
    """Sign-out on this device: forget its row (the token is blacklisted by the caller)."""
    claims = _claims(raw_refresh, verify=False) if raw_refresh else None
    if claims is not None:
        UserSession.objects.filter(jti=claims[1]).delete()


def list_device_sessions(user, current_jti: str | None) -> list[dict]:
    """The user's signed-in devices, the current one first, then most recent."""
    live = list(live_refresh_tokens(user).only("jti", "created_at"))
    rows = {
        row.jti: row for row in UserSession.objects.filter(user=user, jti__in=[t.jti for t in live])
    }
    sessions = []
    for token in live:
        row = rows.get(token.jti)
        if row is None:
            # Signed in before devices were recorded: listed, and revocable.
            row = UserSession.objects.create(user=user, jti=token.jti, device=UNKNOWN_DEVICE)
            UserSession.objects.filter(pk=row.pk).update(
                created_at=token.created_at, last_seen_at=token.created_at
            )
            row.created_at = row.last_seen_at = token.created_at
        sessions.append(
            {
                "id": row.pk,
                "device": row.device or UNKNOWN_DEVICE,
                "signed_in_at": row.created_at.isoformat(),
                "last_active_at": row.last_seen_at.isoformat(),
                "current": token.jti == current_jti,
            }
        )
    current = [s for s in sessions if s["current"]]
    others = sorted(
        (s for s in sessions if not s["current"]), key=lambda s: s["last_active_at"], reverse=True
    )
    return current + others


class SessionNotFoundError(Exception):
    pass


class CurrentSessionError(Exception):
    pass


def revoke_device_session(user, session_id: int, current_jti: str) -> None:
    """Sign out one other device of ``user``.

    Raises ``SessionNotFoundError`` for an id that is not one of the user's live
    devices (another user's id included: no hint that it exists), and
    ``CurrentSessionError`` for this device (that is "Sign out").
    """
    with transaction.atomic():
        lock_user_sessions(user.pk)
        row = UserSession.objects.filter(pk=session_id, user=user).first()
        if row is None:
            raise SessionNotFoundError
        if row.jti == current_jti:
            raise CurrentSessionError
        token = live_refresh_tokens(user).filter(jti=row.jti).first()
        row.delete()
        if token is None:
            raise SessionNotFoundError
        BlacklistedToken.objects.get_or_create(token=token)
