from apps.shared.logger import logger
"""
Metadata Service for Social Links
Fetches Open Graph metadata, favicons, and other link information.
Caches results in Redis for 24 hours.
"""

import httpx
from typing import Optional, Dict
from datetime import timedelta
from bs4 import BeautifulSoup
from django.core.cache import cache

class MetadataService:
    """
    Service for fetching and caching link metadata.
    """

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
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
        )

    def fetch_metadata(self, url: str) -> Dict:
        """
        Fetch metadata for a URL.
        Returns cached result if available.
        """
        cache_key = f"{self.CACHE_PREFIX}{url}"

        # Try cache first
        cached = cache.get(cache_key)
        if cached:
            return cached

        # Fetch fresh metadata
        try:
            metadata = self._scrape_metadata(url)

            # Cache the result
            cache.set(cache_key, metadata, timeout=self.CACHE_TTL.total_seconds())

            return metadata

        except Exception as e:
            logger.error(f"Error fetching metadata for {url}: {e}")
            # Return fallback metadata
            return self._fallback_metadata(url)

    def _scrape_metadata(self, url: str) -> Dict:
        """Scrape Open Graph and other metadata from URL"""
        try:
            response = self.client.get(url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # Extract metadata
            metadata = {
                "title": self._extract_title(soup, url),
                "description": self._extract_description(soup),
                "favicon": self._extract_favicon(soup, url),
                "image": self._extract_og_image(soup),
                "site_name": self._extract_site_name(soup, url),
            }

            return metadata

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
        """Extract page title"""
        # Try Open Graph title first
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            return og_title["content"][:200]

        # Try Twitter Card title
        twitter_title = soup.find("meta", attrs={"name": "twitter:title"})
        if twitter_title and twitter_title.get("content"):
            return twitter_title["content"][:200]

        # Fallback to page title
        if soup.title and soup.title.string:
            return soup.title.string[:200]

        # Last resort - use domain
        from urllib.parse import urlparse

        domain = urlparse(url).netloc
        return domain

    def _extract_description(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract page description"""
        # Try Open Graph description
        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            return og_desc["content"][:500]

        # Try Twitter Card description
        twitter_desc = soup.find("meta", attrs={"name": "twitter:description"})
        if twitter_desc and twitter_desc.get("content"):
            return twitter_desc["content"][:500]

        # Try meta description
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            return meta_desc["content"][:500]

        return None

    def _extract_favicon(self, soup: BeautifulSoup, url: str) -> str:
        """Extract favicon URL"""
        from urllib.parse import urljoin, urlparse

        # Try to find favicon in HTML
        favicon_link = (
            soup.find("link", rel="icon")
            or soup.find("link", rel="shortcut icon")
            or soup.find("link", rel="apple-touch-icon")
            or soup.find("link", rel="apple-touch-icon-precomposed")
        )

        if favicon_link and favicon_link.get("href"):
            favicon_url = urljoin(url, favicon_link["href"])
            # Verify it's absolute
            parsed = urlparse(favicon_url)
            if parsed.scheme and parsed.netloc:
                return favicon_url

        # Fallback to favicon services
        domain = urlparse(url).netloc
        if domain.startswith("www."):
            domain = domain[4:]

        # Use first favicon service as default
        return self.FAVICON_SERVICES[0].format(domain=domain)

    def _extract_og_image(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract Open Graph image"""
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            return og_image["content"]

        # Try Twitter image
        twitter_image = soup.find("meta", attrs={"name": "twitter:image"})
        if twitter_image and twitter_image.get("content"):
            return twitter_image["content"]

        return None

    def _extract_site_name(self, soup: BeautifulSoup, url: str) -> str:
        """Extract site name"""
        # Try Open Graph site name
        og_site = soup.find("meta", property="og:site_name")
        if og_site and og_site.get("content"):
            return og_site["content"]

        # Use domain as fallback
        from urllib.parse import urlparse

        domain = urlparse(url).netloc
        if domain.startswith("www."):
            domain = domain[4:]
        return domain

    def _fallback_metadata(self, url: str) -> Dict:
        """Generate fallback metadata when scraping fails"""
        from urllib.parse import urlparse

        domain = urlparse(url).netloc
        if domain.startswith("www."):
            domain = domain[4:]

        return {
            "title": domain,
            "description": None,
            "favicon": self.FAVICON_SERVICES[0].format(domain=domain),
            "image": None,
            "site_name": domain,
            "fallback": True,
        }

    def clear_cache(self, url: str) -> None:
        """Clear cached metadata for a URL"""
        cache_key = f"{self.CACHE_PREFIX}{url}"
        cache.delete(cache_key)

    def refresh_metadata(self, url: str) -> Dict:
        """Force refresh metadata for a URL"""
        self.clear_cache(url)
        return self.fetch_metadata(url)