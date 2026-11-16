"""Social link validation and orchestration services."""

from typing import Any, Dict, List

from django.conf import settings
from django.db import DatabaseError, transaction

from ...shared.errors import ENQUEUE_ERRORS
from ...shared.logger import logger
from ...users.models import SocialLinkChangeLog
from .metadata_service import MetadataService
from .url_validator import URLValidator


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
            google_safe_browsing_api_key=settings.GOOGLE_SAFE_BROWSING_API_KEY or None,
            safe_browsing_fail_open=settings.GOOGLE_SAFE_BROWSING_FAIL_OPEN,
        )
        self.metadata_service = MetadataService()

    def validate_and_process(self, links: List[Dict]) -> List[Dict]:
        """
        Validate and normalize a list of social links (no side effects).

        Metadata is fetched later, once the links are saved
        (see ``schedule_metadata_fetch``).

        Args:
            links: List of dicts with 'platform' and 'value' keys

        Returns:
            List of processed link dictionaries
        """
        if not isinstance(links, list):
            raise SocialLinkValidationError("Social links must be a list")

        if len(links) > self.MAX_LINKS:
            raise SocialLinkValidationError(f"Maximum {self.MAX_LINKS} social links allowed")

        processed_links = []
        for idx, link in enumerate(links):
            if not isinstance(link, dict):
                raise SocialLinkValidationError(f"Link at index {idx} must be a dictionary")

            platform = (link.get("platform") or "").strip()
            value = (link.get("value") or "").strip() or (link.get("url") or "").strip()

            if not platform or not value:
                continue

            try:
                processed_link = self._process_single_link(platform, value)
            except SocialLinkValidationError as e:
                raise SocialLinkValidationError(f"Invalid link for {platform}: {str(e)}")
            processed_link["value"] = processed_link["url"]
            processed_links.append(processed_link)

        return processed_links

    def _process_single_link(self, platform: str, value: str) -> Dict:
        """Process and validate a single social link."""
        dangerous_schemes = ["javascript:", "data:", "vbscript:", "file:"]
        value_lower = value.lower()
        for scheme in dangerous_schemes:
            if value_lower.startswith(scheme):
                raise SocialLinkValidationError(f"Invalid URL scheme detected: '{scheme}'")

        normalized_url = self.validator.normalize_username(platform, value)
        # Fast checks only: WHOIS and Safe Browsing run after the save, in the
        # metadata task (flag_suspicious_links), so the request never waits on them.
        is_valid, error_message, validation_metadata = self.validator.validate(
            normalized_url, check_reputation=False
        )

        if not is_valid:
            raise SocialLinkValidationError(error_message)

        validated_url = validation_metadata.get("normalized_url", normalized_url)
        trust_level = self._determine_trust_level(
            validation_metadata.get("platform"), validation_metadata
        )

        return {
            "platform": platform,
            "url": validated_url,
            "normalized_url": validated_url,
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

    def reputation_problems(self, urls: List[str]) -> Dict[str, str]:
        """``{url: reason}`` for the URLs that fail the slow reputation checks."""
        problems = {}
        for url in urls:
            problem = self.validator.reputation_problem(url)
            if problem:
                problems[url] = problem
        return problems

    def flag_suspicious_links(self, user_id: int, problems: Dict[str, str]) -> int:
        """Mark saved links that failed the reputation checks; return how many changed.

        A link to a days-old domain or a Safe Browsing match is kept, shown with
        a warning (``trust_level="suspicious"``), rather than rejected after the
        save (spec R4). Links are re-read under a row lock, as the metadata
        writer does, so concurrent edits are not overwritten.
        """
        if not problems:
            return 0
        from ...users.models import UserProfile

        with transaction.atomic():
            profile = UserProfile.objects.select_for_update().filter(user_id=user_id).first()
            if profile is None:
                return 0
            links = profile.social_links or []
            changed = 0
            for link in links:
                if not isinstance(link, dict):
                    continue
                url = link.get("url") or link.get("value")
                if url not in problems:
                    continue
                link["trust_level"] = self.TRUST_SUSPICIOUS
                link["metadata_pending"] = False
                validation = link.get("validation")
                link["validation"] = {
                    **(validation if isinstance(validation, dict) else {}),
                    "warning": problems[url],
                }
                changed += 1
            if changed:
                profile.social_links = links
                profile.save(update_fields=["social_links"])
        return changed

    @staticmethod
    def schedule_metadata_fetch(urls: List[str], user_id: int) -> None:
        """Queue a metadata fetch for ``urls`` once the current transaction commits."""
        if not urls:
            return

        def enqueue():
            try:
                from ..tasks import fetch_multiple_link_metadata

                fetch_multiple_link_metadata.delay(urls, user_id)
            except ENQUEUE_ERRORS:
                # Runs from on_commit: never fail the request that saved the links.
                logger.warning("Failed to trigger async metadata fetch", exc_info=True)

        transaction.on_commit(enqueue)

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
        except (DatabaseError, AttributeError, TypeError):
            # The audit trail is best effort. AttributeError: a stored link that
            # is not a dict; TypeError: a link value that is not JSON-serialisable.
            logger.exception("Error logging social link changes")
