"""Social link validation and orchestration services."""

from typing import Any, Dict, List

from django.conf import settings

from apps.shared.logger import logger
from apps.users.models import SocialLinkChangeLog

from .metadata_service import MetadataService
from .url_validator import URLValidationError, URLValidator


class SocialLinkValidationError(Exception):
    """Raised when a social link fails validation."""


class SocialLinksService:
    """Service for processing, validating, and managing social links."""

    MAX_LINKS = 5

    TRUST_VERIFIED = "verified"
    TRUST_COMMON = "common"
    TRUST_UNKNOWN = "unknown"
    TRUST_SUSPICIOUS = "suspicious"

    def __init__(self):
        self.validator = URLValidator(
            google_safe_browsing_api_key=getattr(settings, "GOOGLE_SAFE_BROWSING_API_KEY", None)
        )
        self.metadata_service = MetadataService()

    def validate_and_process(
        self, links: List[Dict], user: Any, skip_metadata: bool = True
    ) -> List[Dict]:
        """
        Validate and process a list of social links.
        Optimized: skips metadata fetching by default (done async).

        Args:
            links: List of dicts with 'platform' and 'value' keys
            user: User instance for audit logging
            skip_metadata: If True, skip metadata fetching (faster)

        Returns:
            List of processed link dictionaries
        """
        if not isinstance(links, list):
            raise SocialLinkValidationError("Social links must be a list")

        if len(links) > self.MAX_LINKS:
            raise SocialLinkValidationError(f"Maximum {self.MAX_LINKS} social links allowed")

        processed_links = []
        urls_needing_metadata = []

        for idx, link in enumerate(links):
            if not isinstance(link, dict):
                raise SocialLinkValidationError(f"Link at index {idx} must be a dictionary")

            platform = link.get("platform", "").strip()
            value = link.get("value", "").strip() or link.get("url", "").strip()

            if not platform or not value:
                continue

            try:
                processed_link = self._process_single_link(
                    platform, value, skip_metadata=skip_metadata
                )
                processed_link["value"] = processed_link["url"]
                processed_links.append(processed_link)

                if skip_metadata:
                    urls_needing_metadata.append(processed_link["url"])
            except SocialLinkValidationError as e:
                raise SocialLinkValidationError(f"Invalid link for {platform}: {str(e)}")

        if skip_metadata and urls_needing_metadata and user:
            self._trigger_async_metadata_fetch(urls_needing_metadata, user.id)

        return processed_links

    def _process_single_link(self, platform: str, value: str, skip_metadata: bool = True) -> Dict:
        """Process and validate a single social link."""
        dangerous_schemes = ["javascript:", "data:", "vbscript:", "file:"]
        value_lower = value.lower()
        for scheme in dangerous_schemes:
            if value_lower.startswith(scheme):
                raise SocialLinkValidationError(f"Invalid URL scheme detected: '{scheme}'")

        normalized_url = self.validator.normalize_username(platform, value)
        is_valid, error_message, validation_metadata = self.validator.validate(normalized_url)

        if not is_valid:
            raise SocialLinkValidationError(error_message)

        trust_level = self._determine_trust_level(
            validation_metadata.get("platform"), validation_metadata
        )

        return {
            "platform": platform,
            "url": normalized_url,
            "normalized_url": validation_metadata.get("normalized_url", normalized_url),
            "domain": validation_metadata.get("domain", ""),
            "detected_platform": validation_metadata.get("platform", "website"),
            "trust_level": trust_level,
            "metadata": {},
            "metadata_pending": True,
            "validation": {
                "subdomain_count": validation_metadata.get("subdomain_count", 0),
                "domain_age_days": validation_metadata.get("domain_age_days"),
            },
        }

    def _trigger_async_metadata_fetch(self, urls: List[str], user_id: int):
        """Trigger async metadata fetching for URLs."""
        try:
            from apps.core.tasks import fetch_multiple_link_metadata

            fetch_multiple_link_metadata.delay(urls, user_id)
            logger.info(f"Triggered async metadata fetch for {len(urls)} URLs")
        except Exception as e:
            logger.warning(f"Failed to trigger async metadata fetch: {e}")

    def _determine_trust_level(self, platform: str | None, validation_metadata: Dict) -> str:
        """Determine trust level based on platform and validation data."""
        verified_platforms = [
            "twitter",
            "youtube",
            "instagram",
            "github",
            "linkedin",
            "twitch",
            "discord",
            "tiktok",
            "facebook",
            "reddit",
            "telegram",
            "whatsapp",
            "pinterest",
            "spotify",
            "soundcloud",
            "mastodon",
            "threads",
            "bluesky",
        ]

        if platform in verified_platforms:
            return self.TRUST_VERIFIED

        common_platforms = [
            "patreon",
            "ko-fi",
            "buymeacoffee",
            "deviantart",
            "behance",
            "dribbble",
            "figma",
            "notion",
            "medium",
            "substack",
            "bandcamp",
        ]

        if platform in common_platforms:
            return self.TRUST_COMMON

        domain_age = validation_metadata.get("domain_age_days")
        if domain_age is not None and domain_age < 30:
            return self.TRUST_SUSPICIOUS

        return self.TRUST_UNKNOWN

    def log_changes(
        self, user: Any, old_links: List[Dict], new_links: List[Dict], ip_address: str
    ) -> None:
        """Log changes to social links for audit purposes."""
        try:
            old_urls = {link.get("url") or link.get("value") for link in old_links}
            new_urls = {link.get("url") or link.get("value") for link in new_links}

            added = new_urls - old_urls
            removed = old_urls - new_urls

            for link in new_links:
                url = link.get("url") or link.get("value")
                if url in added:
                    SocialLinkChangeLog.objects.create(
                        user=user, action="add", new_value=link, ip_address=ip_address
                    )

            for link in old_links:
                url = link.get("url") or link.get("value")
                if url in removed:
                    SocialLinkChangeLog.objects.create(
                        user=user,
                        action="delete",
                        old_value=link,
                        new_value={},
                        ip_address=ip_address,
                    )

            for new_link in new_links:
                new_url = new_link.get("url") or new_link.get("value")
                if new_url not in added and new_url not in removed:
                    old_link = next(
                        (
                            old_link_item
                            for old_link_item in old_links
                            if (old_link_item.get("url") or old_link_item.get("value")) == new_url
                        ),
                        None,
                    )
                    if old_link and old_link != new_link:
                        SocialLinkChangeLog.objects.create(
                            user=user,
                            action="edit",
                            old_value=old_link,
                            new_value=new_link,
                            ip_address=ip_address,
                        )
        except Exception as e:
            logger.error(f"Error logging social link changes: {e}")

    def validate_single_url(self, url: str) -> Dict:
        """
        Validate a single URL for real-time frontend validation.
        Returns validation result with metadata.
        """
        try:
            dangerous_schemes = ["javascript:", "data:", "vbscript:", "file:"]
            url_lower = url.lower()
            for scheme in dangerous_schemes:
                if url_lower.startswith(scheme):
                    return {
                        "valid": False,
                        "error": f"Invalid URL scheme detected: '{scheme}'",
                        "trust_level": self.TRUST_SUSPICIOUS,
                    }

            normalized = self.validator._normalize_url(url)
            is_valid, error_message, validation_metadata = self.validator.validate(normalized)

            if not is_valid:
                return {
                    "valid": False,
                    "error": error_message,
                    "trust_level": self.TRUST_SUSPICIOUS,
                }

            trust_level = self._determine_trust_level(
                validation_metadata.get("platform"), validation_metadata
            )

            return {
                "valid": True,
                "url": normalized,
                "platform": validation_metadata.get("platform", "website"),
                "domain": validation_metadata.get("domain", ""),
                "trust_level": trust_level,
                "subdomain_count": validation_metadata.get("subdomain_count", 0),
                "domain_age_days": validation_metadata.get("domain_age_days"),
            }
        except Exception as e:
            logger.error(f"Error validating URL {url}: {e}")
            return {
                "valid": False,
                "error": str(e),
                "trust_level": self.TRUST_SUSPICIOUS,
            }
