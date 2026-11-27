"""The <head> of a public profile (/u/<username>), for the SPA shell (RA-001).

Every visitor gets the app's index.html with this profile's title,
description, canonical URL, Open Graph card (banner, else avatar) and a
ProfilePage JSON-LD; crawlers no longer get a separate page. A private
profile, or one that does not exist, says nothing about the account.
The banner is the page's LCP element (components/profile/ProfileHeader.jsx
renders ``banner`` as is), so it is preloaded.
"""

from html import unescape
from urllib.parse import quote

from django.contrib.auth import get_user_model
from django.utils.html import strip_tags

from ..core.spa_shell import ImagePreload, RouteHead, SpaShellView, absolute_url, truncate
from ..shared.media_urls import field_media_url
from .models import UserProfile, UserStats
from .services.avatar_service import get_user_avatar_url
from .services.user_queryset import filter_username_ci

User = get_user_model()

DEFAULT_PREVIEW_DESCRIPTION = "Discover your next anime adventure. Track your favorites, write reviews, and join the community."


def _related(user, name: str, model):
    try:
        return getattr(user, name)
    except model.DoesNotExist:
        return None


def clean_bio(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(strip_tags(unescape(value)).split())


def section_title(section: str | None) -> str:
    if not section:
        return ""
    title = section.split("/")[0].replace("-", " ").replace("_", " ").strip().title()
    return "" if title.lower() == "overview" else title


def build_title(username: str, section: str | None) -> str:
    title = section_title(section)
    return f"{username} - {title} | AniShows" if title else f"{username} on AniShows"


def build_description(username: str, profile: UserProfile | None, stats: UserStats | None) -> str:
    stat_parts: list[str] = []
    if stats:
        if stats.anime_count:
            stat_parts.append(f"{stats.anime_count} anime tracked")
        if stats.followers_count:
            stat_parts.append(f"{stats.followers_count} followers")
        if stats.reviews_count:
            stat_parts.append(f"{stats.reviews_count} reviews")

    bio_text = clean_bio(profile.bio if profile else "")
    if bio_text:
        summary = f" {', '.join(stat_parts)}." if stat_parts else ""
        return truncate(f"{bio_text}{summary}")
    if stat_parts:
        return truncate(f"{username} on AniShows: {', '.join(stat_parts)}.")
    return f"{username} on AniShows. {DEFAULT_PREVIEW_DESCRIPTION}"


def profile_path(username: str, section: str | None = None) -> str:
    base = f"/u/{quote(username)}"
    if not section:
        return base
    return f"{base}/{quote(section.strip('/'), safe='/-_')}"


def build_profile_head(username: str, section: str | None = None) -> RouteHead:
    user = filter_username_ci(User.objects.select_related("userprofile", "stats"), username).first()
    profile = _related(user, "userprofile", UserProfile) if user else None
    if not user or not user.is_active or (profile and profile.is_private):
        # Missing and private profiles look the same: nothing about the account.
        return RouteHead(
            title="Profile not found | AniShows",
            description="This AniShows profile could not be found.",
            canonical_path=profile_path(username, section),
            og_type="profile",
            noindex=True,
            status=404,
        )

    stats = _related(user, "stats", UserStats)
    canonical_path = profile_path(user.username, section)
    banner = field_media_url(profile.banner) if profile and profile.banner else None
    avatar = get_user_avatar_url(user) or None
    description = build_description(user.username, profile, stats)

    person = {
        "@type": "Person",
        "name": user.username,
        "url": absolute_url(profile_path(user.username)),
    }
    if absolute_url(avatar):
        person["image"] = absolute_url(avatar)
    bio_text = clean_bio(profile.bio if profile else "")
    if bio_text:
        person["description"] = truncate(bio_text, 300)
    if stats and stats.followers_count:
        person["interactionStatistic"] = {
            "@type": "InteractionCounter",
            "interactionType": "https://schema.org/FollowAction",
            "userInteractionCount": stats.followers_count,
        }
    json_ld = {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "url": absolute_url(canonical_path),
        "mainEntity": person,
    }

    return RouteHead(
        title=build_title(user.username, section),
        description=description,
        canonical_path=canonical_path,
        og_type="profile",
        image=banner or avatar,
        image_alt=f"{user.username}'s profile",
        large_image=bool(banner),
        json_ld=[json_ld],
        preloads=[ImagePreload(href=banner)] if banner else [],
    )


class ProfileShellView(SpaShellView):
    def build_head(self, request, username: str, section: str | None = None, **kwargs) -> RouteHead:
        return build_profile_head(username, section or None)
