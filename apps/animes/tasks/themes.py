"""Theme-song upkeep.

AniList, the only catalog source (decision D1), has no theme-song data, so
stored ``ThemeSong`` rows are no longer synced; this task only fills in
missing YouTube search links for the rows that exist.
"""

from urllib.parse import quote_plus

from django.db import DatabaseError

from ...shared.celery import observed_shared_task
from ...shared.logger import logger


@observed_shared_task(retry_policy="long")
def backfill_theme_youtube_urls(self, limit: int = 100):
    """Periodic task to backfill missing YouTube URLs for theme songs."""
    from ..models import ThemeSong

    logger.info(f"Starting YouTube URL backfill for up to {limit} themes")

    themes = (
        ThemeSong.objects.filter(youtube_url="")
        .exclude(title="No themes available")
        .select_related("anime")[:limit]
    )

    updated = 0
    errors = 0

    for theme in themes:
        try:
            if theme.anime:
                youtube_url = _generate_youtube_url_sync(
                    theme.title, theme.artist, theme.song_type, theme.anime.title
                )

                if youtube_url:
                    theme.youtube_url = youtube_url
                    theme.save(update_fields=["youtube_url"])
                    updated += 1
                    logger.debug(f"Generated YouTube URL for {theme.title}")
        except DatabaseError:
            # Building the URL is pure string work; only the save can fail
            # (e.g. a URL longer than the column).
            errors += 1
            logger.exception("Error saving YouTube URL for theme %s", theme.id)

    result = {
        "processed": len(themes),
        "updated": updated,
        "errors": errors,
    }

    logger.info(f"YouTube URL backfill complete: {result}")
    return result


def _generate_youtube_url_sync(title: str, artist: str, song_type: str, anime_title: str) -> str:
    """A YouTube search URL for a theme song (title, artist, anime, opening/ending)."""
    query_parts = []

    if title:
        query_parts.append(title)
    if artist:
        query_parts.append(artist)
    if anime_title:
        query_parts.append(anime_title)
    if song_type == "opening":
        query_parts.append("opening")
    elif song_type == "ending":
        query_parts.append("ending")

    query = " ".join(query_parts)
    encoded_query = quote_plus(query)

    return f"https://www.youtube.com/results?search_query={encoded_query}"[:500]
