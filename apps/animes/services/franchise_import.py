from dataclasses import dataclass

from asgiref.sync import async_to_sync
from django.core.cache import cache

from ...shared.logger import logger
from ...shared.public_cache import invalidate_public_cache_keys
from ..models import Anime
from .jikan import JikanService
from .relation_links import anime_keys, relation_key


class FranchiseImportError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class FranchiseImportResult:
    slug: str
    title: str
    imported: bool


class FranchiseImportService:
    rate_limit = 10
    rate_window_seconds = 60

    def import_related_anime(
        self,
        *,
        anilist_id: int | None = None,
        mal_id: int | None = None,
        client_ip: str,
        source_slug: str | None = None,
        rate_limit_key: str | None = None,
    ) -> FranchiseImportResult:
        if not anilist_id and not mal_id:
            raise FranchiseImportError("anilist_id or mal_id is required", 400)

        existing = self._find_existing(anilist_id=anilist_id, mal_id=mal_id)
        if existing:
            if source_slug:
                self.update_relation_slug(source_slug, existing)

            if self._is_missing_primary_images(existing):
                self._enforce_rate_limit(rate_limit_key or client_ip)
                self._refresh_existing_anime(existing)
                existing.refresh_from_db(fields=["title", "slug"])

            invalidate_public_cache_keys(
                f"anime_detail_base:v2:{existing.slug}",
                f"anime_detail_base:{existing.slug}",
            )
            return FranchiseImportResult(
                slug=existing.slug,
                title=existing.title,
                imported=False,
            )

        if not mal_id:
            # Jikan can only fetch by MAL ID; an unknown AniList-only relation can't be imported.
            raise FranchiseImportError("Not found", 404)

        self._enforce_rate_limit(rate_limit_key or client_ip)

        service = JikanService(enable_caching=False, enable_rate_limiting=True)
        try:
            item = async_to_sync(service.search_by_mal_id)(mal_id, anilist_id=anilist_id)
            if not item:
                raise FranchiseImportError("Not found", 404)

            imported = self._find_existing(anilist_id=item.get("id"), mal_id=item.get("idMal")) is None
            anime = service.save_anime_to_db(item)
            self._ensure_external_image_refs(anime, item)
            invalidate_public_cache_keys(
                f"anime_detail_base:v2:{anime.slug}",
                f"anime_detail_base:{anime.slug}",
            )

            if anime.mal_id:
                from ..tasks.themes import sync_theme_songs

                sync_theme_songs.delay(anime_id=anime.id)

            if source_slug:
                self.update_relation_slug(source_slug, anime)

            return FranchiseImportResult(
                slug=anime.slug,
                title=anime.title,
                imported=imported,
            )
        except FranchiseImportError:
            raise
        except Exception as exc:
            logger.error(
                f"Error importing franchise anime (MAL {mal_id}, AniList {anilist_id}): {exc}",
                exc_info=True,
            )
            raise FranchiseImportError("Import failed", 500) from exc
        finally:
            async_to_sync(service.close)()

    @staticmethod
    def _find_existing(*, anilist_id: int | None, mal_id: int | None) -> Anime | None:
        if anilist_id:
            anime = Anime.objects.filter(anilist_id=anilist_id).first()
            if anime:
                return anime
        if mal_id:
            return Anime.objects.filter(mal_id=mal_id).first()
        return None

    def _refresh_existing_anime(self, anime: Anime) -> None:
        """Fetch fresh sync data for an existing anime with missing media metadata."""
        service = JikanService(enable_caching=False, enable_rate_limiting=True)
        try:
            item = async_to_sync(service.resolve_media_for_anime)(anime)
            if item:
                refreshed = service.save_anime_to_db(item)
                self._ensure_external_image_refs(refreshed, item)
            else:
                logger.warning(f"No Jikan payload returned while refreshing existing anime {anime.slug}")
        except Exception as exc:
            logger.warning(f"Failed to refresh existing anime {anime.slug}: {exc}")
        finally:
            async_to_sync(service.close)()

    @staticmethod
    def _is_missing_primary_images(anime: Anime) -> bool:
        has_cover_ref = bool(anime.cover_image or anime.cover_image_external_url)
        has_banner_ref = bool(anime.banner_image or anime.banner_image_external_url)
        return not has_cover_ref or not has_banner_ref

    @staticmethod
    def _ensure_external_image_refs(anime: Anime, item: dict) -> None:
        """Persist external URLs when local media is absent.

        This keeps detail pages renderable immediately while background image downloads run.
        """
        cover_image = item.get("coverImage") or {}
        if not isinstance(cover_image, dict):
            cover_image = {}

        cover_url = JikanService.normalize_external_image_url(
            cover_image.get("extraLarge") or cover_image.get("large")
        )
        banner_url = JikanService.normalize_external_image_url(item.get("bannerImage"))

        update_fields: list[str] = []
        if not anime.cover_image and not anime.cover_image_external_url and cover_url:
            anime.cover_image_external_url = cover_url
            update_fields.append("cover_image_external_url")

        # Some AniList entries do not expose a banner; use cover as banner fallback.
        fallback_banner = banner_url or cover_url
        if not anime.banner_image and not anime.banner_image_external_url and fallback_banner:
            anime.banner_image_external_url = fallback_banner
            update_fields.append("banner_image_external_url")

        if update_fields:
            anime.save(update_fields=update_fields)

    def _enforce_rate_limit(self, rate_limit_key: str) -> None:
        rate_key = f"franchise_fetch:{rate_limit_key or 'unknown'}"
        current_count = cache.get(rate_key, 0)
        if current_count >= self.rate_limit:
            raise FranchiseImportError("Rate limit exceeded", 429)
        cache.set(rate_key, current_count + 1, timeout=self.rate_window_seconds)

    @staticmethod
    def update_relation_slug(source_slug: str, target: Anime) -> None:
        try:
            source_anime = Anime.objects.get(slug=source_slug)
            relations = source_anime.relations or []
            target_keys = set(anime_keys(target))
            updated = False
            for rel in relations:
                if relation_key(rel) in target_keys and not rel.get("slug"):
                    rel["slug"] = target.slug
                    updated = True
            if updated:
                source_anime.relations = relations
                source_anime.save(update_fields=["relations"])
        except Anime.DoesNotExist:
            return
        except Exception as exc:
            logger.warning(f"Failed to update relation slug for {source_slug}: {exc}")
