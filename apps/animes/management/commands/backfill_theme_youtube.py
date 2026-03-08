"""Management command to backfill YouTube URLs for existing theme songs.

This command generates YouTube search URLs for theme songs that don't have them.
Handles long URLs by intelligently trimming the search query.
"""

from urllib.parse import quote_plus

from django.core.management.base import BaseCommand

from apps.animes.models import ThemeSong


class Command(BaseCommand):
    help = "Backfill YouTube URLs for existing theme songs"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Maximum number of themes to process (default: all)",
        )
        parser.add_argument(
            "--anime-id",
            type=int,
            default=None,
            help="Backfill for specific anime ID only",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Force update even if URL already exists",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        anime_id = options["anime_id"]
        force = options["force"]

        # Get themes without YouTube URLs
        if force:
            queryset = ThemeSong.objects.exclude(title="No themes available")
        else:
            queryset = ThemeSong.objects.filter(youtube_url="").exclude(
                title="No themes available"
            )

        if anime_id:
            queryset = queryset.filter(anime_id=anime_id)

        if limit:
            queryset = queryset[:limit]

        themes = list(queryset)
        total = len(themes)

        if total == 0:
            self.stdout.write(self.style.SUCCESS("No themes need YouTube URLs!"))
            return

        self.stdout.write(f"Found {total} themes to process")

        updated = 0
        errors = 0
        skipped_too_long = 0

        for i, theme in enumerate(themes, 1):
            try:
                # Generate YouTube URL with length handling
                youtube_url = self._generate_youtube_url(theme, max_length=200)

                if youtube_url:
                    if len(youtube_url) > 200:
                        # Shouldn't happen with our logic, but just in case
                        skipped_too_long += 1
                        self.stdout.write(
                            self.style.WARNING(
                                f"  Skipping {theme}: URL too long ({len(youtube_url)} chars)"
                            )
                        )
                        continue

                    theme.youtube_url = youtube_url
                    theme.save(update_fields=["youtube_url"])
                    updated += 1

                    if i % 10 == 0 or i == total:
                        self.stdout.write(f"  Processed {i}/{total} themes...")
                else:
                    errors += 1

            except Exception as e:
                errors += 1
                self.stdout.write(self.style.ERROR(f"  Error processing {theme}: {e}"))

        self.stdout.write(
            self.style.SUCCESS(
                f"\nComplete! Updated {updated} themes with YouTube URLs."
            )
        )
        if skipped_too_long > 0:
            self.stdout.write(
                self.style.WARNING(f"Skipped {skipped_too_long} themes (URL too long)")
            )
        if errors > 0:
            self.stdout.write(self.style.ERROR(f"Errors: {errors}"))

    def _generate_youtube_url(self, theme: ThemeSong, max_length: int = 200) -> str:
        """Generate YouTube search URL for a theme song.
        Intelligently trims the query to fit within max_length.
        """
        base_url = "https://www.youtube.com/results?search_query="
        max_query_length = max_length - len(base_url)

        # Build search query parts in order of importance
        query_parts = []

        # 1. Song title (most important)
        if theme.title:
            query_parts.append(theme.title)

        # 2. Artist
        if theme.artist:
            query_parts.append(theme.artist)

        # 3. Anime title (for context)
        if theme.anime and theme.anime.title:
            # Use shortened anime title if very long
            anime_title = theme.anime.title
            if len(anime_title) > 50:
                # Try to get just the main title (before any colons)
                anime_title = anime_title.split(":")[0].strip()
            query_parts.append(anime_title)

        # 4. Song type (least important, add only if space permits)
        song_type_suffix = ""
        if theme.song_type == "opening":
            song_type_suffix = "opening"
        elif theme.song_type == "ending":
            song_type_suffix = "ending"

        if not query_parts:
            return ""

        # Build initial query
        query = " ".join(query_parts)

        # Encode and check length
        encoded_query = quote_plus(query)

        # If too long, start trimming from the end
        if len(encoded_query) > max_query_length:
            # Strategy 1: Remove song type
            if song_type_suffix and song_type_suffix in query.lower():
                query_parts.pop()  # Remove last added item
                query = " ".join(query_parts)
                encoded_query = quote_plus(query)

            # Strategy 2: Shorten anime title (keep only first word)
            if len(encoded_query) > max_query_length and len(query_parts) >= 3:
                # Shorten anime title to just first word
                anime_title = query_parts[-1]
                shortened = (
                    anime_title.split()[0] if anime_title.split() else anime_title[:20]
                )
                query_parts[-1] = shortened
                query = " ".join(query_parts)
                encoded_query = quote_plus(query)

            # Strategy 3: Remove anime title entirely
            if len(encoded_query) > max_query_length and len(query_parts) >= 3:
                query_parts = query_parts[:-1]  # Remove anime title
                query = " ".join(query_parts)
                encoded_query = quote_plus(query)

            # Strategy 4: Truncate the entire query
            if len(encoded_query) > max_query_length:
                # Rough estimate: each char becomes ~3 chars when URL encoded
                # Leave some buffer
                safe_length = int(max_query_length / 3) - 10
                query = query[:safe_length].rstrip()
                encoded_query = quote_plus(query)

        # Final length check
        full_url = base_url + encoded_query
        if len(full_url) > max_length:
            # Last resort: hard truncate
            full_url = full_url[:max_length]

        return full_url
