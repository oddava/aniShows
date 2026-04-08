from dataclasses import dataclass

from asgiref.sync import async_to_sync
from django.core.cache import cache

from apps.animes.models import Anime
from apps.animes.services.jikan import JikanService
from apps.shared.logger import logger
from apps.shared.public_cache import invalidate_public_cache_keys


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

    def import_from_anilist(
        self,
        *,
        anilist_id: int,
        client_ip: str,
        source_slug: str | None = None,
        rate_limit_key: str | None = None,
    ) -> FranchiseImportResult:
        existing = Anime.objects.filter(anilist_id=anilist_id).first()
        if existing:
            if source_slug:
                self.update_relation_slug(source_slug, anilist_id, existing.slug)

            if self._is_missing_primary_images(existing):
                self._enforce_rate_limit(rate_limit_key or client_ip)
                self._refresh_existing_anime(existing, anilist_id)
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

        self._enforce_rate_limit(rate_limit_key or client_ip)

        service = JikanService(enable_caching=False, enable_rate_limiting=True)
        try:
            item = async_to_sync(service.get_anime_by_id)(anilist_id)
            if not item:
                raise FranchiseImportError("Not found", 404)

            imported = self._will_create_new_anime(item)
            anime = service.save_anime_to_db(item)
            self._ensure_external_image_refs(anime, item)
            invalidate_public_cache_keys(
                f"anime_detail_base:v2:{anime.slug}",
                f"anime_detail_base:{anime.slug}",
            )

            if anime.mal_id:
                from apps.animes.tasks.themes import sync_theme_songs

                sync_theme_songs.delay(anime_id=anime.id)

            if source_slug:
                self.update_relation_slug(source_slug, anilist_id, anime.slug)

            return FranchiseImportResult(
                slug=anime.slug,
                title=anime.title,
                imported=imported,
            )
        except FranchiseImportError:
            raise
        except Exception as exc:
            logger.error(f"Error importing franchise anime {anilist_id}: {exc}", exc_info=True)
            raise FranchiseImportError("Import failed", 500) from exc
        finally:
            async_to_sync(service.close)()

    def _refresh_existing_anime(self, anime: Anime, anilist_id: int) -> None:
        """Fetch fresh sync data for an existing anime with missing media metadata."""
        service = JikanService(enable_caching=False, enable_rate_limiting=True)
        try:
            item = async_to_sync(service.get_anime_by_id)(anilist_id)
            if item:
                refreshed = service.save_anime_to_db(item)
                self._ensure_external_image_refs(refreshed, item)
            else:
                logger.warning(
                    f"No Jikan payload returned while refreshing existing anime {anilist_id}"
                )
        except Exception as exc:
            logger.warning(f"Failed to refresh existing anime {anime.slug} ({anilist_id}): {exc}")
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
    def _will_create_new_anime(item: dict) -> bool:
        anilist_id = item.get("id")
        mal_id = item.get("idMal")
        title = item.get("title", {}).get("english") or item.get("title", {}).get("romaji")

        if anilist_id and Anime.objects.filter(anilist_id=anilist_id).exists():
            return False
        if mal_id and Anime.objects.filter(mal_id=mal_id).exists():
            return False
        if title:
            from django.utils.text import slugify

            if Anime.objects.filter(slug=slugify(title)).exists():
                return False
        return True

    @staticmethod
    def update_relation_slug(source_slug: str, anilist_id: int, target_slug: str) -> None:
        try:
            source_anime = Anime.objects.get(slug=source_slug)
            relations = source_anime.relations or []
            updated = False
            for rel in relations:
                if rel.get("id") == anilist_id and not rel.get("slug"):
                    rel["slug"] = target_slug
                    updated = True
            if updated:
                source_anime.relations = relations
                source_anime.save(update_fields=["relations"])
        except Anime.DoesNotExist:
            return
        except Exception as exc:
            logger.warning(f"Failed to update relation slug for {source_slug}: {exc}")
