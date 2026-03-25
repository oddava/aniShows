from html import escape, unescape
from urllib.parse import quote

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.utils.html import strip_tags
from django.views import View

from apps.shared.media_urls import normalize_media_url
from apps.users.models import UserProfile, UserStats
from apps.users.services.avatar_service import get_user_avatar_url

User = get_user_model()

DEFAULT_PREVIEW_DESCRIPTION = (
    "Discover your next anime adventure. Track your favorites, write reviews, and join the community."
)


class ProfileSharePreviewView(View):
    """Return crawler-friendly HTML metadata for public profile links."""

    http_method_names = ["get", "head"]

    def get(self, request, username: str, section: str | None = None) -> HttpResponse:
        user = (
            User.objects.select_related("userprofile", "stats")
            .filter(username__iexact=username)
            .first()
        )

        if not user:
            canonical_url = request.build_absolute_uri(f"/u/{quote(username)}")
            html = self._render_html(
                title="Profile Not Found | AniShows",
                description="This AniShows profile could not be found.",
                canonical_url=canonical_url,
                image_url=self._default_image_url(request),
                redirect_url=canonical_url,
            )
            return HttpResponse(html, status=404, content_type="text/html; charset=utf-8")

        profile = self._get_profile(user)
        stats = self._get_stats(user)
        canonical_path = self._canonical_profile_path(user.username, section)
        canonical_url = request.build_absolute_uri(canonical_path)
        redirect_url = request.build_absolute_uri(self._legacy_profile_path(user.username, section))

        title = self._build_title(user.username, section)
        description = self._build_description(user.username, profile, stats)
        image_url = self._build_image_url(request, user, profile)

        html = self._render_html(
            title=title,
            description=description,
            canonical_url=canonical_url,
            image_url=image_url,
            redirect_url=redirect_url,
        )
        return HttpResponse(html, content_type="text/html; charset=utf-8")

    def _build_title(self, username: str, section: str | None) -> str:
        if not section or section.strip().lower() == "overview":
            return f"{username} on AniShows"

        section_title = section.split("/")[0].replace("-", " ").replace("_", " ").strip().title()
        if not section_title:
            return f"{username} on AniShows"
        return f"{username} - {section_title} | AniShows"

    def _build_description(
        self,
        username: str,
        profile: UserProfile | None,
        stats: UserStats | None,
    ) -> str:
        if profile and profile.is_private:
            return f"{username}'s profile is private on AniShows."

        stat_parts: list[str] = []
        if stats:
            if stats.anime_count:
                stat_parts.append(f"{stats.anime_count} anime tracked")
            if stats.followers_count:
                stat_parts.append(f"{stats.followers_count} followers")
            if stats.reviews_count:
                stat_parts.append(f"{stats.reviews_count} reviews")

        bio_text = self._clean_bio(profile.bio if profile else "")
        if bio_text:
            summary = f" {', '.join(stat_parts[:3])}." if stat_parts else ""
            return self._truncate(f"{bio_text}{summary}", 190)

        if stat_parts:
            return self._truncate(f"{username} on AniShows: {', '.join(stat_parts[:3])}.", 190)

        return f"{username} on AniShows. {DEFAULT_PREVIEW_DESCRIPTION}"

    def _build_image_url(self, request, user, profile: UserProfile | None) -> str:
        banner_url = None
        if profile and profile.banner:
            try:
                banner_url = normalize_media_url(profile.banner.url)
            except Exception:
                banner_url = None

        avatar_url = get_user_avatar_url(user)
        chosen = banner_url or avatar_url or self._default_image_url(request)
        return self._absolute_url(request, chosen)

    def _clean_bio(self, value: str | None) -> str:
        if not value:
            return ""
        plain_text = strip_tags(unescape(value))
        return " ".join(plain_text.split())

    def _truncate(self, value: str, limit: int) -> str:
        if len(value) <= limit:
            return value
        return value[: limit - 1].rstrip() + "…"

    def _default_image_url(self, request) -> str:
        return request.build_absolute_uri("/icon.svg?v=2")

    def _absolute_url(self, request, value: str) -> str:
        if value.startswith("//"):
            return f"https:{value}"
        if value.startswith(("http://", "https://")):
            return value
        if not value.startswith("/"):
            value = f"/{value}"
        return request.build_absolute_uri(value)

    def _canonical_profile_path(self, username: str, section: str | None) -> str:
        base = f"/u/{quote(username)}"
        if not section:
            return base
        return f"{base}/{quote(section, safe='/-_')}"

    def _legacy_profile_path(self, username: str, section: str | None) -> str:
        base = f"/profile/{quote(username)}"
        if not section:
            return base
        return f"{base}/{quote(section, safe='/-_')}"

    def _get_profile(self, user) -> UserProfile | None:
        try:
            return user.userprofile
        except UserProfile.DoesNotExist:
            return None

    def _get_stats(self, user) -> UserStats | None:
        try:
            return user.stats
        except UserStats.DoesNotExist:
            return None

    def _render_html(
        self,
        *,
        title: str,
        description: str,
        canonical_url: str,
        image_url: str,
        redirect_url: str,
    ) -> str:
        title_esc = escape(title, quote=True)
        desc_esc = escape(description, quote=True)
        canonical_esc = escape(canonical_url, quote=True)
        image_esc = escape(image_url, quote=True)
        redirect_esc = escape(redirect_url, quote=True)

        return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>{title_esc}</title>
  <meta name=\"description\" content=\"{desc_esc}\" />
  <link rel=\"canonical\" href=\"{canonical_esc}\" />

  <meta property=\"og:site_name\" content=\"AniShows\" />
  <meta property=\"og:type\" content=\"profile\" />
  <meta property=\"og:title\" content=\"{title_esc}\" />
  <meta property=\"og:description\" content=\"{desc_esc}\" />
  <meta property=\"og:url\" content=\"{canonical_esc}\" />
  <meta property=\"og:image\" content=\"{image_esc}\" />

  <meta name=\"twitter:card\" content=\"summary_large_image\" />
  <meta name=\"twitter:title\" content=\"{title_esc}\" />
  <meta name=\"twitter:description\" content=\"{desc_esc}\" />
  <meta name=\"twitter:image\" content=\"{image_esc}\" />

  <meta http-equiv=\"refresh\" content=\"0;url={redirect_esc}\" />
  <script>window.location.replace({redirect_esc!r});</script>
</head>
<body>
  <p><a href=\"{redirect_esc}\">Continue to profile</a></p>
</body>
</html>
"""
