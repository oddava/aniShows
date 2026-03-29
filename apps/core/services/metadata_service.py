"""Metadata fetching and caching for social links."""

from datetime import timedelta
from typing import Dict

import httpx
from bs4 import BeautifulSoup
from django.core.cache import cache

from apps.shared.logger import logger


class MetadataService:
    """Service for fetching and caching link metadata."""

    CACHE_PREFIX = "link_metadata:"
    CACHE_TTL = timedelta(hours=24)
    REQUEST_TIMEOUT = 5  # seconds

    # Favicon services as fallbacks
    FAVICON_SERVICES = [
        "https://www.google.com/s2/favicons?domain={domain}&sz=64",
        "https://icons.duckduckgo.com/ip3/{domain}.ico",
        "https://api.faviconkit.com/{domain}/64",
    ]

    def __init__(self):
        self.client = httpx.Client(
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
        )

    def fetch_metadata(self, url: str) -> Dict:
        """
        Fetch metadata for a URL.
        Returns cached result if available.
        """
        cache_key = f"{self.CACHE_PREFIX}{url}"

        cached = cache.get(cache_key)
        if cached:
            return cached

        try:
            metadata = self._scrape_metadata(url)
            cache.set(cache_key, metadata, timeout=self.CACHE_TTL.total_seconds())
            return metadata
        except Exception as e:
            logger.error(f"Error fetching metadata for {url}: {e}")
            return self._fallback_metadata(url)

    def _scrape_metadata(self, url: str) -> Dict:
        """Scrape Open Graph and other metadata from a URL."""
        try:
            response = self.client.get(url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            return {
                "title": self._extract_title(soup, url),
                "description": self._extract_description(soup),
                "favicon": self._extract_favicon(soup, url),
                "image": self._extract_og_image(soup),
                "site_name": self._extract_site_name(soup, url),
            }
        except httpx.TimeoutException:
            logger.warning(f"Timeout fetching metadata for {url}")
            return self._fallback_metadata(url)
        except httpx.HTTPStatusError as e:
            logger.warning(f"HTTP error {e.response.status_code} for {url}")
            return self._fallback_metadata(url)
        except Exception as e:
            logger.error(f"Error scraping metadata for {url}: {e}")
            return self._fallback_metadata(url)

    def _extract_title(self, soup: BeautifulSoup, url: str) -> str:
        """Extract page title."""
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            return og_title["content"][:200]

        twitter_title = soup.find("meta", attrs={"name": "twitter:title"})
        if twitter_title and twitter_title.get("content"):
            return twitter_title["content"][:200]

        if soup.title and soup.title.string:
            return soup.title.string[:200]

        from urllib.parse import urlparse

        return urlparse(url).netloc

    def _extract_description(self, soup: BeautifulSoup) -> str | None:
        """Extract page description."""
        og_description = soup.find("meta", property="og:description")
        if og_description and og_description.get("content"):
            return og_description["content"][:500]

        meta_description = soup.find("meta", attrs={"name": "description"})
        if meta_description and meta_description.get("content"):
            return meta_description["content"][:500]

        twitter_description = soup.find("meta", attrs={"name": "twitter:description"})
        if twitter_description and twitter_description.get("content"):
            return twitter_description["content"][:500]

        return None

    def _extract_favicon(self, soup: BeautifulSoup, url: str) -> str | None:
        """Extract favicon URL, with fallback services."""
        from urllib.parse import urljoin, urlparse

        icon_rel_values = {"icon", "shortcut icon", "apple-touch-icon"}
        for rel_value in icon_rel_values:
            icon_link = soup.find("link", rel=rel_value)
            if icon_link and icon_link.get("href"):
                return urljoin(url, icon_link["href"])

        domain = urlparse(url).netloc
        return self.FAVICON_SERVICES[0].format(domain=domain) if domain else None

    def _extract_og_image(self, soup: BeautifulSoup) -> str | None:
        """Extract Open Graph image."""
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            return og_image["content"]

        twitter_image = soup.find("meta", attrs={"name": "twitter:image"})
        if twitter_image and twitter_image.get("content"):
            return twitter_image["content"]

        return None

    def _extract_site_name(self, soup: BeautifulSoup, url: str) -> str:
        """Extract site name."""
        og_site_name = soup.find("meta", property="og:site_name")
        if og_site_name and og_site_name.get("content"):
            return og_site_name["content"][:100]

        from urllib.parse import urlparse

        domain = urlparse(url).netloc
        return domain.replace("www.", "").split(".")[0].title()

    def _fallback_metadata(self, url: str) -> Dict:
        """Build fallback metadata when scraping fails."""
        from urllib.parse import urlparse

        domain = urlparse(url).netloc
        site_name = domain.replace("www.", "").split(".")[0].title() if domain else "Unknown"

        return {
            "title": domain or url,
            "description": None,
            "favicon": self.FAVICON_SERVICES[0].format(domain=domain) if domain else None,
            "image": None,
            "site_name": site_name,
        }
