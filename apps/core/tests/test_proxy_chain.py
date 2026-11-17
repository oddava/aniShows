"""The proxy contract (G7): the app trusts exactly one proxy hop, Caddy.

In every deploy mode Caddy sends one X-Forwarded-For entry, the real client
(``header_up X-Forwarded-For {client_ip}``; behind the host's reverse proxy
``{client_ip}`` is the right-most untrusted X-Forwarded-For entry, behind
Cloudflare Tunnel it is CF-Connecting-IP). These tests pin the app side of that
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
COMPOSE_FILE = REPO_ROOT / "docker-compose.prod.yml"
COMPOSE_TRUSTED = "10.250.250.0/25"  # APP_SUBNET: what the template tells operators to set
CADDY_IP = "10.250.250.5"  # the app's only peer: Caddy on the compose network

REST_FRAMEWORK_ONE_PROXY = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}


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
        # The production rate (test settings relax every scope).
        with patch.object(LoginRateThrottle, "THROTTLE_RATES", {"login": "5/minute"}):
            throttle = LoginRateThrottle()
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

    text: str

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.text = CADDYFILE.read_text(encoding="utf-8")

    def _snippet(self, name: str) -> str:
        match = re.search(rf"^\({re.escape(name)}\) \{{\n(.*?)^\}}", self.text, re.M | re.S)
        assert match is not None, f"snippet ({name}) missing"
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

    def test_client_ip_comes_only_via_trusted_peers(self):
        # Proxy mode reads X-Forwarded-For; tunnel mode CF-Connecting-IP (env.sh).
        self.assertIn("client_ip_headers {$CADDY_CLIENT_IP_HEADERS:X-Forwarded-For}", self.text)
        # Right to left past trusted peers: a client's own prefix is ignored.
        self.assertRegex(self.text, r"(?m)^\t\ttrusted_proxies_strict$")
        # The default trusts loopback only: unset, no client can pick its IP.
        self.assertIn(
            "trusted_proxies static {$CADDY_TRUSTED_PROXIES:127.0.0.1/8 ::1/128}", self.text
        )

    def test_proxy_mode_is_the_default(self):
        self.assertIn("import /etc/caddy/sites-{$CADDY_MODE:proxy}.d/*.caddy", self.text)
        self.assertTrue((REPO_ROOT / "infra" / "caddy" / "sites-proxy.d").is_dir())

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
        # Unset or empty: closed to every client (only Caddy's loopback passes).
        self.assertIn("not client_ip {$ADMIN_ALLOW_CIDRS:100::/64}\n", gate)
        # Loopback passes by TCP peer only: a trusted proxy's CF-Connecting-IP
        # of 127.0.0.1 must not open the gate.
        self.assertIn("not remote_ip 127.0.0.1/8 ::1/128", gate)
        self.assertNotRegex(gate, r"client_ip[^\n]*127\.0\.0\.1")
        self.assertIn("respond @operator_denied_{args[0]} 403", gate)

    def test_access_logs_rotate_and_hide_account_tokens(self):
        log = self._snippet("access_log")
        self.assertIn("roll_size 10MiB", log)
        self.assertIn("roll_keep 5", log)
        self.assertIn("request>uri regexp", log)
        self.assertIn("request>headers>Referer regexp", log)
        self.assertIn("code|token", log)
        self.assertIn("reset-password", log)
        self.assertEqual(self.text.count("import access_log "), 2)
        self.assertNotIn("output file /var/log/caddy/access.log", self.text)

    def test_account_link_pages_send_no_referer(self):
        self.assertIn(
            "@account_link_pages path /reset-password/* /verify-email/* /confirm-email-change/*",
            self.text,
        )
        self.assertIn('header @account_link_pages Referrer-Policy "no-referrer"', self.text)
        # The site-wide policy is deferred (it would overwrite the one above)
        # and so must skip these pages.
        headers = self._snippet("security_headers")
        self.assertIn(
            "@referrer_default not path /reset-password/* /verify-email/* /confirm-email-change/*",
            headers,
        )
        # Set once, only in the matched (deferred) header block.
        self.assertEqual(headers.count('Referrer-Policy "strict-origin-when-cross-origin"'), 1)
        self.assertIn("header @referrer_default {", headers)

    def test_liveness_stays_the_upstream_health_check(self):
        self.assertNotIn("health_uri /api/v1/health/ready/", self.text)
        self.assertIn("health_uri /api/v1/health/", self.text)


class ComposeHasNoPermissiveTrustDefaultsTests(SimpleTestCase):
    """docker-compose.prod.yml: trusted peers and the operator gate default closed."""

    text: str

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.text = COMPOSE_FILE.read_text(encoding="utf-8")

    def test_django_trusted_proxies_are_required(self):
        self.assertRegex(self.text, r"TRUSTED_PROXY_CIDRS: \$\{TRUSTED_PROXY_CIDRS:\?")

    def test_caddy_trusts_loopback_only_by_default(self):
        self.assertIn(
            "CADDY_TRUSTED_PROXIES: ${CADDY_TRUSTED_PROXIES:-127.0.0.1/8 ::1/128}", self.text
        )

    def test_operator_gate_defaults_closed(self):
        self.assertIn("ADMIN_ALLOW_CIDRS: ${ADMIN_ALLOW_CIDRS:-100::/64}", self.text)
        self.assertNotIn("0.0.0.0/0", self.text)

    def test_proxy_mode_and_a_fixed_app_subnet_are_the_defaults(self):
        self.assertIn("CADDY_MODE: ${CADDY_MODE:-proxy}", self.text)
        self.assertIn("CADDY_SITE_ADDRESS: ${CADDY_SITE_ADDRESS:-:80}", self.text)
        self.assertIn("- subnet: ${APP_SUBNET:-10.250.250.0/25}", self.text)
        override = (REPO_ROOT / "infra" / "compose" / "proxy-port.yml").read_text(encoding="utf-8")
        # Loopback only by default: nothing but the host's proxy reaches Caddy.
        self.assertIn('"${CADDY_PROXY_BIND:-127.0.0.1}:${CADDY_PROXY_PORT:-8080}:80"', override)
