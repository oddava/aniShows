"""Writing AniList payloads: anime rows, relationships, cast, media."""

from typing import TYPE_CHECKING

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


# Jikan (before D1) stored people under synthetic IDs: 1.6e9 + MAL ID for
# characters, 1.7e9 + MAL ID for staff. Real AniList IDs are far below.
LEGACY_CHARACTER_ID_MIN = 1_600_000_000
LEGACY_STAFF_ID_MIN = 1_700_000_000


def _name_key(name: str | None) -> str:
    return " ".join((name or "").split()).casefold()


def _legacy_name_keys(name: str | None) -> set[str]:
    """Keys a Jikan-era name may match: as stored, and "Family, Given" turned around.

    Jikan (MyAnimeList) wrote people as "Tanezaki, Atsumi"; AniList says
    "Atsumi Tanezaki".
    """
    keys = {_name_key(name)}
    family, comma, given = (name or "").partition(",")
    if comma and family.strip() and given.strip():
        keys.add(_name_key(f"{given} {family}"))
    return keys


def _replacement(name: str | None, people_by_name: dict):
    return next(
        (people_by_name[key] for key in _legacy_name_keys(name) if key in people_by_name), None
    )


def _move_favorites(model, field: str, old, new) -> None:
    """Point ``old``'s favourites at ``new``; drop the ones a user already has on ``new``."""
    favorites = model.objects.filter(**{field: old})
    favorites.filter(user__in=model.objects.filter(**{field: new}).values("user")).delete()
    favorites.update(**{field: new})


def _retire_legacy_cast(anime, characters_by_name: dict, staff_by_name: dict) -> None:
    """Fold ``anime``'s Jikan-era links into the people the AniList payload brought.

    A matched character's old link goes (the payload's link replaces it). A
    matched voice actor's or staff member's other links on this anime are
    moved onto the AniList person, role and all: the payload is a preview, so
    it may list one of several roles or characters. Favourites move with the
    person, one per user.
    """
    from ....models import UserFavoriteCharacter, UserFavoriteStaff

    moved_staff: set[int] = set()

    def fold_staff(old_staff):
        """The AniList row for a Jikan-era staff member, favourites moved; or None."""
        replacement = _replacement(old_staff.name, staff_by_name)
        if replacement is not None and old_staff.pk not in moved_staff:
            _move_favorites(UserFavoriteStaff, "staff", old_staff, replacement)
            moved_staff.add(old_staff.pk)
        return replacement

    legacy_characters = AnimeCharacter.objects.filter(
        anime=anime, character__anilist_id__gte=LEGACY_CHARACTER_ID_MIN
    ).select_related("character", "voice_actor")
    for link in legacy_characters:
        replacement = _replacement(link.character.name, characters_by_name)
        if replacement is None:
            continue
        _move_favorites(UserFavoriteCharacter, "character", link.character, replacement)
        if link.voice_actor and (link.voice_actor.anilist_id or 0) >= LEGACY_STAFF_ID_MIN:
            fold_staff(link.voice_actor)
        link.delete()

    # A matched voice actor may also voice characters outside the preview:
    # point those links at the AniList person too.
    legacy_voices = AnimeCharacter.objects.filter(
        anime=anime, voice_actor__anilist_id__gte=LEGACY_STAFF_ID_MIN
    ).select_related("voice_actor")
    for link in legacy_voices:
        replacement = fold_staff(link.voice_actor)
        if replacement is None:
            continue
        if AnimeCharacter.objects.filter(
            anime=anime, character_id=link.character_id, voice_actor=replacement
        ).exists():
            link.delete()
        else:
            link.voice_actor = replacement
            link.save(update_fields=["voice_actor"])

    legacy_staff = AnimeStaff.objects.filter(
        anime=anime, staff__anilist_id__gte=LEGACY_STAFF_ID_MIN
    ).select_related("staff")
    for staff_link in legacy_staff:
        replacement = fold_staff(staff_link.staff)
        if replacement is None:
            continue
        if AnimeStaff.objects.filter(anime=anime, staff=replacement, role=staff_link.role).exists():
            staff_link.delete()
        else:
            staff_link.staff = replacement
            staff_link.save(update_fields=["staff"])


if TYPE_CHECKING:
    from .client import AniListClient

    _ClientBase = AniListClient
else:
    _ClientBase = object


class AniListPersistence(_ClientBase):
    """Persistence half of ``AniListService``; mixed in with ``AniListClient``.

    At runtime this is a plain mixin; type checkers see the client as its base
    so the client methods it calls are known.
    """

    if TYPE_CHECKING:

        def resolve_media_for_anime(self, anime: Anime) -> dict | None: ...

    def process_media_list(self, media_list: list[dict], progress_callback=None):
        """Process a list of media items and save/update them in the database.
        Returns a stats dict, with the IDs of the anime it created.
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
        except Exception:
            logger.exception("Error in manual update of anime %s", anime.id)
            raise

    def refresh_anime_metadata(self, anime: Anime, item: dict | None = None) -> bool:
        """Fetch (unless given) and apply a full payload: fields, cast, relations, media.

        False when no matching media was found or the payload belongs to
        another identity.
        """
        media = item or self.resolve_media_for_anime(anime)
        if not media:
            logger.info("Skipped metadata refresh for Anime ID %s: no matching media", anime.id)
            return False
        return self.update_anime_manual(anime, media)

    def update_airing_fields(self, anime: Anime, item: dict) -> bool:
        """Apply an airing payload's schedule and status, nothing heavier.

        The hourly airing refresh only needs fresh schedule fields, not a cast,
        relation or image refresh; unknown values keep what is stored.
        """
        if not item:
            return False
        if anime.anilist_id and item.get("id") and item["id"] != anime.anilist_id:
            logger.info(
                "Skipped airing update for Anime ID %s: payload is AniList ID %s, not %s",
                anime.id,
                item["id"],
                anime.anilist_id,
            )
            return False
        title, title_native = mapper.media_titles(item)
        anime_data = self._prepare_anime_data(item, title or anime.title, title_native, anime.slug)
        anime_data.pop("slug", None)
        self._update_anime(anime, anime_data)
        return True

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
        """Find the local row for a payload by AniList, then MAL ID.

        (The offline-catalog import copies its IDs onto these columns too.)
        Titles are not unique, so slug and title are only used for payloads
        with no IDs at all.
        """
        for lookup, value in (("anilist_id", anilist_id), ("mal_id", mal_id)):
            if value:
                anime = Anime.objects.filter(**{lookup: value}).first()
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
        genres = [
            Genre.objects.get_or_create(name=genre_name, defaults={"slug": slugify(genre_name)})[0]
            for genre_name in item.get("genres") or []
        ]
        if genres:
            # One add() call: one m2m_changed signal (is_adult re-check) per anime.
            anime.genres.add(*genres)

        studio_names = mapper.studio_names(item)
        if studio_names:
            anime.set_studios(Studio.objects.get_or_create(name=name)[0] for name in studio_names)

        sync_relations_from_media(anime, item)

    def _handle_extended_info(self, anime, item):
        """Store the payload's cast and staff next to the anime's existing ones.

        AniList payloads carry a preview (the top 10 of each), so links to
        people missing from it are kept: deleting them would cut a 40-person
        cast down to 10. For a character in the payload, its link is the
        current one (one per character). Staff roles only accumulate: the
        preview may list one of a person's several roles. People written
        before D1 from Jikan, under synthetic IDs, are folded into the AniList
        rows that match them by name (``_retire_legacy_cast``).
        """
        characters_by_name: dict[str, Character] = {}
        staff_by_name: dict[str, Staff] = {}
        with transaction.atomic():
            for edge in mapper.character_edges(item):
                node = edge["node"]
                role = edge["role"]  # MAIN, SUPPORTING, etc.
                character = _upsert_person(Character, mapper.character_fields(node))
                characters_by_name[_name_key(character.name)] = character

                # Japanese voice actor, if any.
                voice_actors = edge.get("voiceActors") or []
                voice_actor = None
                if voice_actors:
                    voice_actor = _upsert_person(Staff, mapper.person_fields(voice_actors[0]))
                    staff_by_name[_name_key(voice_actor.name)] = voice_actor

                link, _ = AnimeCharacter.objects.update_or_create(
                    anime=anime,
                    character=character,
                    voice_actor=voice_actor,
                    defaults={"role": ROLE_MAP.get(role, AnimeCharacter.Role.SUPPORTING)},
                )
                # The payload names this character's voice actor: an older link
                # with another one (recast, credited later) is out of date.
                AnimeCharacter.objects.filter(anime=anime, character=character).exclude(
                    pk=link.pk
                ).delete()

            for edge in mapper.staff_edges(item):
                node = edge["node"]
                role = edge["role"]
                staff_member = _upsert_person(Staff, mapper.person_fields(node))
                staff_by_name[_name_key(staff_member.name)] = staff_member

                AnimeStaff.objects.update_or_create(
                    anime=anime,
                    staff=staff_member,
                    role=role,  # Keep exact role string
                )

            _retire_legacy_cast(anime, characters_by_name, staff_by_name)

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

            if (cover_url and not has_cover) or (banner_url and not has_banner) or force_replace:
                from ....tasks.images import _queue_image_fetch

                logger.info(f"Queueing background image fetch for {anime.title}")
                _queue_image_fetch(
                    anime_id=anime.id,
                    cover_url=cover_url,
                    banner_url=banner_url,
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

        # By AniList, then MAL ID; titles are not unique, so the slug is only
        # tried for a payload without IDs.
        existing = self._lookup_existing_anime(anilist_id=anilist_id, mal_id=mal_id, slug=base_slug)
        if existing:
            logger.debug("Found anime %s for AniList ID %s", existing.id, anilist_id)
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

        self._handle_relationships(anime, item)
        self._handle_extended_info(anime, item)
        self._download_and_save_images(anime, item)

        return anime

    def _update_anime_from_media(
        self, anime: Anime, item: dict, title: str, title_native: str, slug: str
    ):
        """Apply a full payload to an existing row: fields, relations, cast, media."""
        anime_data = self._prepare_anime_data(item, title, title_native, slug)
        anime_data["anilist_id"] = item.get("id") or anime.anilist_id
        anime_data["mal_id"] = item.get("idMal") or anime.mal_id

        self._update_anime(anime, anime_data)
        self._handle_relationships(anime, item)
        self._handle_extended_info(anime, item)
        self._download_and_save_images(anime, item)
