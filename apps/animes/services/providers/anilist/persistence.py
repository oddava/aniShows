"""Writing AniList payloads: anime rows, relationships, people, themes, media."""

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.utils.text import slugify

from .....shared.logger import logger
from ....models import (
    Anime,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Genre,
    Staff,
    Studio,
    ThemeSong,
)
from ...relation_links import sync_relations_from_media
from ..base import with_creation_defaults
from . import mapper

ROLE_MAP = {
    "MAIN": AnimeCharacter.Role.MAIN,
    "SUPPORTING": AnimeCharacter.Role.SUPPORTING,
    "BACKGROUND": AnimeCharacter.Role.BACKGROUND,
}


def _upsert_person(model, fields: dict):
    """Update or create a Character/Staff row, keyed by AniList ID when there is one."""
    defaults = {key: value for key, value in fields.items() if key != "anilist_id"}
    defaults["name_native"] = defaults["name_native"] or ""
    if fields["anilist_id"]:
        return model.objects.update_or_create(anilist_id=fields["anilist_id"], defaults=defaults)[0]
    name = defaults.pop("name")
    return model.objects.update_or_create(name=name, defaults=defaults)[0]


class AniListPersistence:
    """Persistence half of ``AniListService``; mixed in with ``AniListClient``."""

    def process_media_list(self, media_list: list[dict], progress_callback=None):
        """Process a list of media items and save/update them in the database.
        Returns stats dict with created anime IDs for theme sync.
        """
        stats = {"created": 0, "updated": 0, "skipped": 0, "created_anime_ids": []}

        for i, item in enumerate(media_list):
            try:
                title, title_native = mapper.media_titles(item)

                if not title:
                    continue

                slug = slugify(title)
                anime_data_dict = self._prepare_anime_data(item, title, title_native, slug)

                # Get or Create
                anime, created = self._get_or_create_anime(slug, anime_data_dict)

                if created:
                    stats["created"] += 1
                    stats["created_anime_ids"].append(anime.id)
                    logger.info(f"Created Anime: {title} (ID: {anime.id})")
                else:
                    # Always update for real-time freshness
                    # Preserve existing slug to maintain URL stability
                    if "slug" in anime_data_dict:
                        del anime_data_dict["slug"]

                    self._update_anime(anime, anime_data_dict)
                    stats["updated"] += 1
                    logger.info(f"Updated Anime: {title}")

                # Handle Relationships & Media
                self._handle_relationships(anime, item)

                # Handle Extended Info (Chars, Staff, Links, Relations)
                self._handle_extended_info(anime, item)

                # Download images if missing
                self._download_and_save_images(anime, item)

                if progress_callback:
                    progress_callback(i + 1)

            except Exception as e:
                logger.error(f"Error processing anime {item.get('id')}: {e}", exc_info=True)
                stats["skipped"] += 1
                if progress_callback:
                    progress_callback(i + 1)

        return stats

    def update_anime_manual(self, anime: Anime, item: dict):
        """Manually update a specific Anime instance with AniList data.
        Updates fields but PRESERVES the existing slug to avoid integrity errors/identity shifts.
        """
        try:
            item = self._resolve_manual_update_item(anime, item)
            if not item:
                logger.info(
                    f"Skipped manual update for Anime ID {anime.id}: could not resolve matching AniList media"
                )
                return False

            title, title_native = mapper.media_titles(item)

            # Use the EXISTING slug to ensure we don't collide with other records
            anime_data_dict = self._prepare_anime_data(item, title, title_native, anime.slug)

            self._update_anime(anime, anime_data_dict)
            logger.info(f"Manually Updated Anime ID {anime.id}: {anime.title}")

            # Handle extended info
            self._handle_relationships(anime, item)
            self._handle_extended_info(anime, item)
            self._download_and_save_images(anime, item)

            return True
        except Exception as e:
            logger.error(f"Error manual update anime {anime.id}: {e}")
            raise e

    def _resolve_manual_update_item(self, anime: Anime, item: dict) -> dict | None:
        """Resolve identity mismatches before applying a manual update.

        Metadata searches can return ambiguous title matches. This prevents writes that
        would move an Anime row onto a different AniList/MAL identity.
        """
        incoming_anilist_id = item.get("id")
        incoming_mal_id = item.get("idMal")

        # Strongest identity: AniList ID
        if anime.anilist_id and incoming_anilist_id and anime.anilist_id != incoming_anilist_id:
            logger.info(
                f"AniList mismatch for Anime ID {anime.id}: expected {anime.anilist_id}, got {incoming_anilist_id}. Re-fetching canonical media."
            )
            canonical_item = self.get_anime_by_id(anime.anilist_id)
            return canonical_item

        # Secondary identity: MAL ID (only if AniList ID is unavailable)
        if (
            not anime.anilist_id
            and anime.mal_id
            and incoming_mal_id
            and anime.mal_id != incoming_mal_id
        ):
            logger.info(
                f"MAL mismatch for Anime ID {anime.id}: expected {anime.mal_id}, got {incoming_mal_id}. Re-fetching canonical media."
            )
            canonical_item = self.search_by_mal_id(anime.mal_id)
            return canonical_item

        # Don't attach an identity already owned by another row.
        for field, incoming in (("anilist_id", incoming_anilist_id), ("mal_id", incoming_mal_id)):
            if not incoming or getattr(anime, field):
                continue
            existing = self._identity_owner(anime, field, incoming)
            if existing:
                label = "AniList" if field == "anilist_id" else "MAL"
                logger.info(
                    f"Skipped manual update for Anime ID {anime.id}: incoming {label} ID {incoming} belongs to Anime ID {existing['id']} ({existing['title']})."
                )
                return None

        return item

    @staticmethod
    def _identity_owner(anime: Anime, field: str, value) -> dict | None:
        return (
            Anime.objects.filter(**{field: value})
            .exclude(id=anime.id)
            .values("id", "title")
            .first()
        )

    def _lookup_existing_anime(
        self,
        *,
        anilist_id: int | None = None,
        mal_id: int | None = None,
        slug: str | None = None,
        title: str | None = None,
    ) -> Anime | None:
        if anilist_id:
            anime = Anime.objects.filter(anilist_id=anilist_id).first()
            if anime:
                return anime

        if mal_id:
            anime = Anime.objects.filter(mal_id=mal_id).first()
            if anime:
                return anime

        if anilist_id or mal_id:
            return None

        if slug:
            anime = Anime.objects.filter(slug=slug).first()
            if anime:
                return anime

        if title:
            anime = Anime.objects.filter(title=title).first()
            if anime:
                return anime

        return None

    def _get_or_create_anime(self, slug, anime_data_dict):
        anilist_id = anime_data_dict.get("anilist_id")
        mal_id = anime_data_dict.get("mal_id")
        title = anime_data_dict.get("title")

        existing = self._lookup_existing_anime(
            anilist_id=anilist_id, mal_id=mal_id, slug=slug, title=title
        )
        if existing:
            return existing, False

        # A new show gets a free slug. Matching on the slug instead would hand
        # back a different show that shares the title (a remake, a sequel
        # season) and the caller would overwrite it with this payload.
        anime_data = with_creation_defaults(anime_data_dict)
        anime_data["slug"] = Anime.available_slug(slug, year=anime_data.get("season_year"))
        try:
            return Anime.objects.create(**anime_data), True
        except IntegrityError as exc:
            recovered = self._lookup_existing_anime(
                anilist_id=anilist_id, mal_id=mal_id, slug=anime_data["slug"], title=title
            )
            if recovered:
                logger.warning(
                    f"Recovered from create race for slug '{slug}' (AniList ID: {anilist_id}): {exc}"
                )
                return recovered, False
            raise

    def _handle_relationships(self, anime, item):
        genres = item.get("genres") or []
        for genre_name in genres:
            genre, _ = Genre.objects.get_or_create(
                name=genre_name, defaults={"slug": slugify(genre_name)}
            )
            anime.genres.add(genre)

        studio_names = mapper.studio_names(item)
        if studio_names:
            anime.set_studios(Studio.objects.get_or_create(name=name)[0] for name in studio_names)

        sync_relations_from_media(anime, item)

    def _handle_extended_info(self, anime, item):
        with transaction.atomic():
            for edge in mapper.character_edges(item):
                node = edge["node"]
                role = edge["role"]  # MAIN, SUPPORTING, etc.
                character = _upsert_person(Character, mapper.character_fields(node))

                # Japanese voice actor, if any.
                voice_actors = edge.get("voiceActors") or []
                voice_actor = None
                if voice_actors:
                    voice_actor = _upsert_person(Staff, mapper.person_fields(voice_actors[0]))

                AnimeCharacter.objects.update_or_create(
                    anime=anime,
                    character=character,
                    voice_actor=voice_actor,
                    defaults={"role": ROLE_MAP.get(role, AnimeCharacter.Role.SUPPORTING)},
                )

            for edge in mapper.staff_edges(item):
                node = edge["node"]
                role = edge["role"]
                staff_member = _upsert_person(Staff, mapper.person_fields(node))

                AnimeStaff.objects.update_or_create(
                    anime=anime,
                    staff=staff_member,
                    role=role,  # Keep exact role string
                )

        self._process_theme_songs(anime, item)

    def _process_theme_songs(self, anime, item):
        """Process openings and endings from AniList data"""
        openings = item.get("openings") or []
        endings = item.get("endings") or []

        # AniList doesn't provide themes, so this will typically be empty;
        # themes are fetched separately via the Jikan API.
        if not openings and not endings:
            return

        # Clear existing theme songs to avoid duplicates (only if we have data)
        ThemeSong.objects.filter(anime=anime).delete()

        for song_type, entries in (
            (ThemeSong.SongType.OPENING, openings),
            (ThemeSong.SongType.ENDING, endings),
        ):
            for idx, text in enumerate(entries, 1):
                if text:
                    parsed = mapper.parse_theme_song(text)
                    ThemeSong.objects.create(
                        anime=anime,
                        song_type=song_type,
                        track_number=idx,
                        title=parsed["title"],
                        artist=parsed["artist"],
                        episodes=parsed["episodes"],
                        anilist_raw=text,
                    )

    def _parse_theme_song(self, text: str) -> dict:
        """Parse AniList theme song format: 'Song Title' by Artist (eps X-Y)"""
        return mapper.parse_theme_song(text)

    def _download_and_save_images(self, anime, item):
        try:
            cover_image = mapper.cover_image(item)

            cover_url = self.normalize_external_image_url(
                cover_image.get("extraLarge") or cover_image.get("large")
            )
            banner_url = self.normalize_external_image_url(item.get("bannerImage"))
            existing_cover_url = anime.cover_image_external_url or ""
            existing_banner_url = anime.banner_image_external_url or ""
            cover_url_changed = bool(cover_url and cover_url != existing_cover_url)
            banner_url_changed = bool(banner_url and banner_url != existing_banner_url)
            force_replace = cover_url_changed or banner_url_changed

            # Queue background task to download cover and banner images
            has_cover = bool(anime.cover_image)
            has_banner = bool(anime.banner_image)

            # Pass mal_id for Jikan fallback
            mal_id = item.get("idMal")

            if (
                (cover_url and not has_cover)
                or (banner_url and not has_banner)
                or (not has_banner and mal_id)
                or force_replace
            ):
                from ....tasks.images import _queue_image_fetch

                logger.info(f"Queueing background image fetch for {anime.title}")
                _queue_image_fetch(
                    anime_id=anime.id,
                    cover_url=cover_url,
                    banner_url=banner_url,
                    mal_id=mal_id,
                    force_replace=force_replace,
                )

            # Check if anime already has a trailer URL
            has_trailer = bool(anime.trailer_url)
            if not has_trailer:
                trailer_url = mapper.trailer_url(item.get("trailer"))
                if trailer_url:
                    self._save_trailer_url(anime, trailer_url)

        except Exception as e:
            logger.error(f"Error downloading media for {anime.title}: {e}", exc_info=True)

    def _save_image(self, anime, field_name, filename, image_data):
        field = getattr(anime, field_name)
        field.save(filename, ContentFile(image_data), save=True)

        # Queue thumbnail generation asynchronously to avoid blocking import
        # This runs in the background via Celery
        from ....tasks import generate_image_thumbnails

        generate_image_thumbnails.delay(anime.id)

    def _save_trailer_url(self, anime, trailer_url):
        anime.trailer_url = trailer_url
        anime.save()

    def _save_external_url(self, anime, field_name, url):
        """Save external image URL for fallback purposes"""
        setattr(anime, field_name, self.normalize_external_image_url(url))
        anime.save(update_fields=[field_name])

    def save_anime_to_db(self, item: dict) -> Anime:
        """Create or update the Anime row for an AniList media payload."""
        anilist_id = item.get("id")
        mal_id = item.get("idMal")
        title = item.get("title", {}).get("english") or item.get("title", {}).get("romaji")
        title_native = item.get("title", {}).get("native")

        if not title:
            raise ValueError("Anime must have a title")

        base_slug = slugify(title)

        # Try to find existing anime by AniList ID, then MAL ID.
        for field, label, value in (
            ("anilist_id", "AniList", anilist_id),
            ("mal_id", "MAL", mal_id),
        ):
            if not value:
                continue
            try:
                anime = Anime.objects.get(**{field: value})
            except Anime.DoesNotExist:
                continue
            logger.debug(f"Found anime by {label} ID {value}: {anime.title}")
            self._update_anime_from_media(anime, item, title, title_native, anime.slug)
            return anime

        # Titles are not unique: only fall back to slug matching for payloads without IDs.
        if not (anilist_id or mal_id):
            existing = Anime.objects.filter(slug=base_slug).first()
            if existing:
                self._update_anime_from_media(existing, item, title, title_native, existing.slug)
                return existing

        final_slug = Anime.available_slug(base_slug, year=item.get("seasonYear"))

        # Create new anime with unique slug
        anime_data = with_creation_defaults(
            self._prepare_anime_data(item, title, title_native, final_slug)
        )
        anime_data["anilist_id"] = anilist_id
        anime_data["mal_id"] = mal_id

        try:
            anime = Anime.objects.create(**anime_data)
            logger.info(f"Created new anime: {title} with slug {final_slug}")
        except IntegrityError as e:
            recovered = self._lookup_existing_anime(
                anilist_id=anilist_id,
                mal_id=mal_id,
                slug=final_slug,
                title=title,
            )
            if recovered:
                logger.warning(
                    f"Recovered from create integrity conflict for '{title}' (AniList ID: {anilist_id}): {e}"
                )
                self._update_anime_from_media(recovered, item, title, title_native, recovered.slug)
                return recovered
            logger.error(f"Failed to create anime '{title}' with slug '{final_slug}': {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to create anime '{title}' with slug '{final_slug}': {e}")
            raise

        # Handle relationships
        self._handle_relationships(anime, item)

        # Download images
        self._download_and_save_images(anime, item)

        return anime

    def _update_anime_from_media(
        self, anime: Anime, item: dict, title: str, title_native: str, slug: str
    ):
        """Update an existing anime asynchronously"""
        anime_data = self._prepare_anime_data(item, title, title_native, slug)
        anime_data["anilist_id"] = item.get("id") or anime.anilist_id
        anime_data["mal_id"] = item.get("idMal") or anime.mal_id

        self._update_anime(anime, anime_data)
        self._handle_relationships(anime, item)
        self._download_and_save_images(anime, item)
