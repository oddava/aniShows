"""Security-focused URL validation for user-provided social links.

Provides comprehensive validation including:
- HTTPS-only enforcement
- IP address detection
- URL shortener blocking
- Homograph attack detection
- Subdomain depth limiting
- Google Safe Browsing API integration
- DNS resolution validation
- Domain age verification
"""

import hashlib
import ipaddress
import re
import socket
from datetime import datetime
from typing import Tuple
from urllib.parse import urlparse, urlunparse

import idna
import whois
from django.core.cache import cache

from ...shared.logger import logger


class URLValidationError(Exception):
    """Raised when URL validation fails."""


class URLValidator:
    """Validates URLs for security concerns before allowing them as social links."""

    # URL shorteners to block
    URL_SHORTENERS = {
        "bit.ly",
        "tinyurl.com",
        "t.co",
        "goo.gl",
        "ow.ly",
        "buff.ly",
        "is.gd",
        "short.link",
        "rebrand.ly",
        "cutt.ly",
        "shorturl.at",
        "rb.gy",
        "short.io",
        "bl.ink",
        "t2m.io",
        "tiny.cc",
        "tr.im",
        "cli.gs",
        "pic.gd",
        "DwarfURL.com",
        "ff.im",
        "rubyurl.com",
        "post.ly",
        "idek.net",
        "yhoo.it",
        "lnkd.in",
        "db.tt",
        "qr.ae",
        "ad.vu",
        "coinurl.com",
        "cur.lv",
        "doiop.com",
        "fun.ly",
        "golinks.co",
        "ity.im",
        "link.zip",
        "linkd.in",
        "moourl.com",
        "sp2.ro",
        "su.pr",
        "tl.gd",
        "twitter.com\\/i\\/redirect",
    }

    # Platforms with their domain patterns
    PLATFORM_PATTERNS = {
        "twitter": ["x.com", "twitter.com"],
        "youtube": ["youtube.com", "youtu.be"],
        "instagram": ["instagram.com"],
        "github": ["github.com"],
        "linkedin": ["linkedin.com"],
        "twitch": ["twitch.tv"],
        "discord": ["discord.com", "discord.gg"],
        "tiktok": ["tiktok.com"],
        "facebook": ["facebook.com", "fb.com"],
        "reddit": ["reddit.com", "redd.it"],
        "patreon": ["patreon.com"],
        "ko-fi": ["ko-fi.com"],
        "buymeacoffee": ["buymeacoffee.com"],
        "telegram": ["t.me", "telegram.me"],
        "whatsapp": ["wa.me", "whatsapp.com"],
        "snapchat": ["snapchat.com"],
        "pinterest": ["pinterest.com"],
        "spotify": ["spotify.com"],
        "soundcloud": ["soundcloud.com"],
        "bandcamp": ["bandcamp.com"],
        "deviantart": ["deviantart.com"],
        "behance": ["behance.net"],
        "dribbble": ["dribbble.com"],
        "figma": ["figma.com"],
        "notion": ["notion.so"],
        "medium": ["medium.com"],
        "substack": ["substack.com"],
        "mastodon": ["mastodon.social", "mstdn.jp", "pawoo.net"],
        "threads": ["threads.net"],
        "bluesky": ["bsky.app", "bsky.social"],
    }

    # Cache validation results for 1 hour
    VALIDATION_CACHE_TTL = 3600

    def __init__(self, google_safe_browsing_api_key: str | None = None):
        self.google_safe_browsing_api_key = google_safe_browsing_api_key
        self._safe_browsing_client = None

    def _get_cache_key(self, url: str) -> str:
        """Generate cache key for URL validation"""
        url_hash = hashlib.md5(url.lower().encode(), usedforsecurity=False).hexdigest()
        return f"url_validation:{url_hash}"

    def validate(self, url: str) -> Tuple[bool, str, dict]:
        """
        Validate a URL for security concerns.
        Results are cached for 1 hour to avoid redundant validation.

        Returns:
            Tuple of (is_valid: bool, error_message: str, metadata: dict)
        """
        # Check cache first
        cache_key = self._get_cache_key(url)
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            # Normalize URL
            normalized_url = self._normalize_url(url)
            parsed = urlparse(normalized_url)
            hostname = parsed.hostname or ""

            # Check 1: HTTPS only
            if parsed.scheme != "https":
                result = (False, "Only HTTPS URLs are allowed", {})
                cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                return result

            # Check 2: IP address detection
            if self._is_ip_address(hostname):
                result = (False, "IP addresses are not allowed", {})
                cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                return result

            # Check 3: URL shortener blocking
            if self._is_url_shortener(hostname):
                result = (
                    False,
                    "URL shorteners are not allowed for security reasons",
                    {},
                )
                cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                return result

            # Check 4: Subdomain depth
            subdomain_count = self._count_subdomains(hostname)
            if subdomain_count > 3:
                result = (
                    False,
                    f"Too many subdomains ({subdomain_count}). Maximum allowed: 3",
                    {},
                )
                cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                return result

            # Check 5: Homograph attack detection
            if self._is_homograph_attack(hostname):
                result = (
                    False,
                    "Potential homograph attack detected (punycode domain)",
                    {},
                )
                cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                return result

            # Check 6: DNS resolution
            resolved_ips = self._resolve_public_ips(hostname)
            if not resolved_ips:
                result = (
                    False,
                    "Domain does not resolve to a public IP address",
                    {},
                )
                cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                return result

            # Check 7: Domain age (WHOIS) - only for suspicious domains
            # Skip for known good platforms to speed up validation
            platform = self._detect_platform(parsed.netloc)
            domain_age_days = None
            if not platform:  # Only check age for unknown platforms
                domain_age_days = self._get_domain_age(hostname)
                if domain_age_days is not None and domain_age_days < 7:
                    result = (
                        False,
                        f"Domain is too new ({domain_age_days} days old). Minimum: 7 days",
                        {},
                    )
                    cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                    return result

            # Check 8: Google Safe Browsing (if API key provided)
            if self.google_safe_browsing_api_key:
                safe_browsing_result = self._check_safe_browsing(normalized_url)
                if not safe_browsing_result["safe"]:
                    result = (
                        False,
                        f"Google Safe Browsing flagged this URL: {safe_browsing_result['threat']}",
                        {},
                    )
                    cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
                    return result

            metadata = {
                "normalized_url": normalized_url,
                "domain": hostname,
                "platform": platform or "website",
                "subdomain_count": subdomain_count,
                "domain_age_days": domain_age_days,
            }

            result = (True, "", metadata)
            # Cache successful validation
            cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
            return result

        except URLValidationError as e:
            result = (False, str(e), {})
            cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
            return result
        except Exception as e:
            logger.error(f"Unexpected error validating URL {url}: {e}")
            result = (False, f"Validation error: {str(e)}", {})
            cache.set(cache_key, result, self.VALIDATION_CACHE_TTL)
            return result

    def _normalize_url(self, url: str) -> str:
        """Normalize URL to standard format"""
        url = url.strip()

        # Add scheme if missing
        if not url.startswith(("http://", "https://")):
            url = "https://" + url

        # Parse and reconstruct to normalize
        parsed = urlparse(url)

        # Remove default port if present
        netloc = parsed.netloc
        if ":443" in netloc and parsed.scheme == "https":
            netloc = netloc.replace(":443", "")
        elif ":80" in netloc and parsed.scheme == "http":
            netloc = netloc.replace(":80", "")

        # Reconstruct normalized URL
        normalized = urlunparse(
            (
                parsed.scheme,
                netloc.lower(),
                parsed.path,
                parsed.params,
                parsed.query,
                "",  # Remove fragment
            )
        )

        return normalized

    def validate_public_target(
        self, url: str, *, allowed_schemes: tuple[str, ...] = ("https",)
    ) -> str:
        """Validate a request target before fetching it over the network."""
        normalized_url = self._normalize_url(url)
        parsed = urlparse(normalized_url)
        hostname = parsed.hostname or ""

        if parsed.scheme not in allowed_schemes:
            raise URLValidationError("Unsupported URL scheme")
        if not hostname:
            raise URLValidationError("URL is missing a hostname")
        if self._is_ip_address(hostname):
            raise URLValidationError("IP addresses are not allowed")
        if not self._resolve_public_ips(hostname):
            raise URLValidationError("Hostname resolves to a private or reserved IP address")

        return normalized_url

    def _is_ip_address(self, netloc: str) -> bool:
        """Check if the netloc is an IP address"""
        # Remove port if present
        host = netloc.split(":")[0]

        # IPv4 pattern
        ipv4_pattern = r"^(\d{1,3}\.){3}\d{1,3}$"
        if re.match(ipv4_pattern, host):
            return True

        # IPv6 pattern (basic check)
        if host.startswith("[") and host.endswith("]"):
            return True
        if ":" in host and not host.startswith("www."):
            # Could be IPv6, do more thorough check
            try:
                socket.inet_pton(socket.AF_INET6, host)
                return True
            except OSError:
                pass

        return False

    def _is_url_shortener(self, netloc: str) -> bool:
        """Check if domain is a known URL shortener"""
        domain = netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]

        return domain in self.URL_SHORTENERS

    def _count_subdomains(self, netloc: str) -> int:
        """Count the number of subdomains"""
        host = netloc.split(":")[0]  # Remove port
        parts = host.split(".")

        # Remove www. prefix from count
        if parts[0] == "www":
            parts = parts[1:]

        # For domains like example.com, we have 2 parts (domain + TLD)
        # Subdomains = total parts - 2
        if len(parts) <= 2:
            return 0

        return len(parts) - 2

    def _is_homograph_attack(self, netloc: str) -> bool:
        """Detect potential homograph attacks using punycode"""
        host = netloc.split(":")[0]  # Remove port

        try:
            # Try to decode punycode
            decoded = idna.decode(host)

            # Check if the decoded version contains non-ASCII characters
            # that could be homograph attacks
            for char in decoded:
                if ord(char) > 127:
                    # Contains unicode - potential homograph
                    # Check for suspicious lookalikes
                    lookalikes = {
                        "\u0430": "a",  # Cyrillic small letter a
                        "\u0435": "e",  # Cyrillic small letter ie
                        "\u043e": "o",  # Cyrillic small letter o
                        "\u0440": "p",  # Cyrillic small letter er
                        "\u0441": "c",  # Cyrillic small letter es
                        "\u0445": "x",  # Cyrillic small letter ha
                    }
                    if char in lookalikes:
                        return True

            return False
        except (idna.IDNAError, UnicodeError):
            # If we can't decode it, it might be suspicious
            if host.startswith("xn--"):
                return True
            return False

    def _resolve_dns(self, netloc: str) -> bool:
        """Check if domain resolves to a valid IP"""
        return bool(self._resolve_public_ips(netloc))

    def _resolve_public_ips(
        self, netloc: str
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        """Resolve hostname and return only globally routable addresses."""
        host = netloc.split(":")[0]

        try:
            addrinfo = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            return []

        public_ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        for _family, _socktype, _proto, _canonname, sockaddr in addrinfo:
            candidate = sockaddr[0]
            try:
                ip_obj = ipaddress.ip_address(candidate)
            except ValueError:
                continue
            if ip_obj.is_global:
                public_ips.append(ip_obj)

        return public_ips

    def _get_domain_age(self, netloc: str) -> int | None:
        """Get domain age in days using WHOIS"""
        host = netloc.split(":")[0]  # Remove port

        # Extract registered domain (remove subdomains)
        parts = host.split(".")
        if len(parts) >= 2:
            # Take last 2 parts for most domains, or last 3 for co.uk style
            if len(parts) > 2 and parts[-2] in ("co", "com", "org", "net", "gov"):
                registered_domain = ".".join(parts[-3:])
            else:
                registered_domain = ".".join(parts[-2:])
        else:
            registered_domain = host

        try:
            domain_info = whois.whois(registered_domain)

            creation_date = domain_info.creation_date
            if isinstance(creation_date, list):
                creation_date = creation_date[0]

            if creation_date:
                age = datetime.now() - creation_date
                return age.days

            return None
        except Exception as e:
            logger.warning(f"Could not get WHOIS info for {registered_domain}: {e}")
            return None

    def _check_safe_browsing(self, url: str) -> dict:
        """Check URL against Google Safe Browsing API"""
        try:
            from googleapiclient.discovery import build

            if not self._safe_browsing_client:
                self._safe_browsing_client = build(
                    "safebrowsing",
                    "v4",
                    developerKey=self.google_safe_browsing_api_key,
                    cache_discovery=False,
                )

            threat_info = {
                "threatTypes": [
                    "MALWARE",
                    "SOCIAL_ENGINEERING",
                    "UNWANTED_SOFTWARE",
                    "POTENTIALLY_HARMFUL_APPLICATION",
                    "THREAT_TYPE_UNSPECIFIED",
                ],
                "platformTypes": ["ANY_PLATFORM"],
                "threatEntryTypes": ["URL"],
                "threatEntries": [{"url": url}],
            }

            response = (
                self._safe_browsing_client.threatMatches()
                .find(body={"threatInfo": threat_info})
                .execute()
            )

            if response.get("matches"):
                threat = response["matches"][0]
                return {
                    "safe": False,
                    "threat": threat.get("threatType", "Unknown threat"),
                }

            return {"safe": True, "threat": None}

        except Exception as e:
            logger.error(f"Safe Browsing API error: {e}")
            # Fail open - if API fails, assume safe but log it
            return {"safe": True, "threat": None}

    def _detect_platform(self, netloc: str) -> str | None:
        """Detect social platform from domain"""
        domain = netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]

        for platform, domains in self.PLATFORM_PATTERNS.items():
            for pattern in domains:
                if pattern in domain:
                    return platform

        return None

    def normalize_username(self, platform: str, username: str) -> str:
        """
        Normalize a username to a full URL based on platform.

        Handles various input formats:
        - @username → username
        - username → username
        - https://... → keep as-is
        """
        username = username.strip()

        # Remove @ prefix
        if username.startswith("@"):
            username = username[1:]

        # If already a URL, return as-is
        if username.startswith(("http://", "https://")):
            return username

        # Platform-specific normalization
        platform = platform.lower()

        if platform in ["twitter", "x"]:
            return f"https://x.com/{username}"
        elif platform == "youtube":
            return f"https://youtube.com/@{username}"
        elif platform == "instagram":
            return f"https://instagram.com/{username}"
        elif platform == "github":
            return f"https://github.com/{username}"
        elif platform == "twitch":
            return f"https://twitch.tv/{username}"
        elif platform == "tiktok":
            return f"https://tiktok.com/@{username}"
        elif platform == "linkedin":
            return f"https://linkedin.com/in/{username}"
        elif platform == "telegram":
            return f"https://t.me/{username}"
        elif platform == "reddit":
            return f"https://reddit.com/user/{username}"
        elif platform == "facebook":
            return f"https://facebook.com/{username}"
        elif platform == "discord":
            # Discord uses invite links, not usernames
            return f"https://discord.gg/{username}"
        elif platform == "patreon":
            return f"https://patreon.com/{username}"
        elif platform == "ko-fi":
            return f"https://ko-fi.com/{username}"
        elif platform == "buymeacoffee":
            return f"https://buymeacoffee.com/{username}"
        elif platform == "mastodon":
            # Mastodon handles are @user@instance
            if "@" in username:
                parts = username.split("@")
                if len(parts) == 3:  # ['', 'user', 'instance']
                    return f"https://{parts[2]}/@{parts[1]}"
            return f"https://mastodon.social/@{username}"
        elif platform == "threads":
            return f"https://threads.net/@{username}"
        elif platform == "bluesky":
            return f"https://bsky.app/profile/{username}"

        # Generic fallback - assume it's a website
        return f"https://{username}"
