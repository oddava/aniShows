"""The proxy contract (G7): the app trusts exactly one proxy hop, Caddy.

In both deploy modes Caddy sends one X-Forwarded-For entry, the real client
(``header_up X-Forwarded-For {client_ip}``; behind Cloudflare Tunnel
``{client_ip}`` is CF-Connecting-IP). These tests pin the app side of that
chain (DRF throttle identity and ``get_client_ip``) and check the Caddyfile
keeps its side, so login throttles stay per client instead of global.
"""

import os
import re
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from apps.core import utils
from apps.users.throttling import LoginRateThrottle

REPO_ROOT = Path(__file__).resolve().parents[3]
CADDYFILE = REPO_ROOT / "Caddyfile.prod"
COMPOSE_TRUSTED = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
CADDY_IP = "172.18.0.5"  # the app's only peer: Caddy on the compose network

REST_FRAMEWORK_ONE_PROXY = {
    **settings.REST_FRAMEWORK,
    "NUM_PROXIES": 1,
    "DEFAULT_THROTTLE_RATES": {
        **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
        "login": "5/minute",
    },
}


def _request(xff: str | None, remote_addr: str = CADDY_IP):
    extra = {"REMOTE_ADDR": remote_addr}
    if xff is not None:
        extra["HTTP_X_FORWARDED_FOR"] = xff
    request = APIRequestFactory().post("/api/v1/auth/login/", **extra)
    request.user = AnonymousUser()
    return request


class ClientIpTests(SimpleTestCase):
    def setUp(self):
        patcher = patch.dict(os.environ, {"TRUSTED_PROXY_CIDRS": COMPOSE_TRUSTED})
        patcher.start()
        self.addCleanup(patcher.stop)
        utils._trusted_proxy_networks.cache_clear()
        self.addCleanup(utils._trusted_proxy_networks.cache_clear)

    def test_the_single_entry_from_caddy_is_the_client(self):
        self.assertEqual(utils.get_client_ip(_request("198.51.100.7")), "198.51.100.7")

    def test_ipv6_clients_are_kept(self):
        self.assertEqual(utils.get_client_ip(_request("2001:db8::1")), "2001:db8::1")

    def test_a_forged_entry_cannot_change_the_client(self):
        # Caddy replaces the header, but even an appended one keeps the last
        # (untrusted) entry: the address Caddy saw.
        self.assertEqual(
            utils.get_client_ip(_request("6.6.6.6, 198.51.100.7")),
            "198.51.100.7",
        )

    def test_headers_from_an_untrusted_peer_are_ignored(self):
        self.assertEqual(
            utils.get_client_ip(_request("198.51.100.7", remote_addr="203.0.113.50")),
            "203.0.113.50",
        )


@override_settings(REST_FRAMEWORK=REST_FRAMEWORK_ONE_PROXY)
class LoginThrottleBucketTests(SimpleTestCase):
    """Two phones behind different public IPs never share a login bucket."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def _allowed(self, xff: str) -> bool:
        throttle = LoginRateThrottle()
        throttle.rate = "5/minute"
        throttle.num_requests, throttle.duration = throttle.parse_rate(throttle.rate)
        return throttle.allow_request(_request(xff), APIView())

    def test_each_client_gets_its_own_bucket(self):
        phone_a, phone_b = "198.51.100.7", "203.0.113.9"
        self.assertTrue(all(self._allowed(phone_a) for _ in range(5)))
        self.assertFalse(self._allowed(phone_a), "the sixth attempt from A is throttled")
        self.assertTrue(self._allowed(phone_b), "B is not locked out by A")

    def test_spoofed_prefixes_share_the_real_clients_bucket(self):
        for spoof in range(5):
            self.assertTrue(self._allowed(f"10.9.9.{spoof}, 198.51.100.7"))
        self.assertFalse(self._allowed("1.1.1.1, 198.51.100.7"))

    def test_identity_is_the_client_not_caddy(self):
        throttle = LoginRateThrottle()
        self.assertEqual(throttle.get_ident(_request("198.51.100.7")), "198.51.100.7")


class CaddyfileKeepsItsSideTests(SimpleTestCase):
    """Static checks on Caddyfile.prod (Caddy itself is not in CI)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.text = CADDYFILE.read_text(encoding="utf-8")

    def _snippet(self, name: str) -> str:
        match = re.search(rf"^\({re.escape(name)}\) \{{\n(.*?)^\}}", self.text, re.M | re.S)
        self.assertIsNotNone(match, f"snippet ({name}) missing")
        return match.group(1)

    def test_django_snippet_sends_only_the_real_client(self):
        self.assertIn("header_up X-Forwarded-For {client_ip}", self._snippet("django"))

    def test_every_proxy_to_django_imports_the_snippet(self):
        blocks = re.findall(
            r"reverse_proxy \{\$WEB_UPSTREAMS:web:8000\} \{\n(.*?)\n\t*\}", self.text, re.S
        )
        self.assertGreaterEqual(len(blocks), 7)
        for block in blocks:
            self.assertIn("import django", block.splitlines()[0])
        # And no bare one-line proxy that would skip it.
        self.assertNotRegex(self.text, r"reverse_proxy \{\$WEB_UPSTREAMS:web:8000\}\s*\n")

    def test_client_ip_comes_from_cloudflare_only_via_trusted_peers(self):
        self.assertIn("client_ip_headers CF-Connecting-IP", self.text)
        # The default trusts loopback only: in public mode no client can pick its IP.
        self.assertIn(
            "trusted_proxies static {$CADDY_TRUSTED_PROXIES:127.0.0.1/8 ::1/128}", self.text
        )

    def test_operator_routes_are_gated_inside_their_handle_blocks(self):
        for path, arg in (
            ("/api/v1/health/ready/", "ready"),
            ("/django-admin/*", "admin"),
            ("/metrics", "metrics"),
        ):
            with self.subTest(path=path):
                self.assertRegex(
                    self.text, rf"handle {re.escape(path)} \{{\n\t\timport operator_gate {arg}\n"
                )
        gate = self._snippet("operator_gate")
        self.assertIn("{$ADMIN_ALLOW_CIDRS:0.0.0.0/0 ::/0}", gate)
        self.assertIn("respond @operator_denied_{args[0]} 403", gate)

    def test_liveness_stays_the_upstream_health_check(self):
        self.assertNotIn("health_uri /api/v1/health/ready/", self.text)
        self.assertIn("health_uri /api/v1/health/", self.text)
