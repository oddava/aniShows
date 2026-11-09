from ...shared.logger import logger
from ...shared.retry import backoff

"""
Image processing tasks for anime.

Includes thumbnail generation for anime images.
"""
import hashlib

import httpx
from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q

from ...core.services.celery_monitoring import get_queue_size
from ...shared.celery import observed_shared_task
from ...shared.task_lock import cache_lock
from ..services.jikan import JIKAN_BASE_URL, JikanRateLimiter, JikanService
from .base import run_async_in_task

try:
    from botocore.exceptions import ConnectionClosedError, EndpointConnectionError

    _BOTOCORE_STORAGE_ERRORS: tuple[type[Exception], ...] = (
        ConnectionClosedError,
        EndpointConnectionError,
    )
except Exception:  # pragma: no cover - botocore is available in runtime environments
    _BOTOCORE_STORAGE_ERRORS = ()

_ENDPOINT_ERROR_PATTERNS = (
    "could not connect to the endpoint url",
    "connection refused",
    "failed to establish a new connection",
    "name or service not known",
    "temporary failure in name resolution",
    "connection reset by peer",
    "nodename nor servname provided",
)
_FETCH_DEDUP_KEY = "anime:image-fetch:queued:{anime_id}"
_FETCH_DEDUP_TTL_SECONDS = 300
_STORAGE_RETRY_BASE_DELAY_SECONDS = 300
_STORAGE_RETRY_MAX_DELAY_SECONDS = 3600
_STORAGE_RETRY_ATTEMPT_LIMIT = 24
_MEDIA_SELF_HEAL_LOCK_KEY = "anime:media-self-heal:lock"


def _iter_exception_chain(exc: Exception):
    """Iterate through an exception and its causes/contexts."""
    seen = set()
    current = exc
    while current and id(current) not in seen:
        yield current
        seen.add(id(current))
        current = current.__cause__ or current.__context__


def _is_storage_endpoint_error(exc: Exception) -> bool:
    """Return True when the error is likely a transient storage endpoint outage."""
    for current in _iter_exception_chain(exc):
        if _BOTOCORE_STORAGE_ERRORS and isinstance(current, _BOTOCORE_STORAGE_ERRORS):
            return True

        msg = str(current).lower()
        if any(pattern in msg for pattern in _ENDPOINT_ERROR_PATTERNS):
            return True
        if "endpoint url" in msg and "minio" in msg:
            return True
    return False


def _storage_retry_delay_seconds(storage_retry: int) -> int:
    multiplier = 2 ** min(storage_retry, 4)
    return min(
        _STORAGE_RETRY_BASE_DELAY_SECONDS * multiplier,
        _STORAGE_RETRY_MAX_DELAY_SECONDS,
    )


def _image_filename(slug: str, kind: str, source_url: str) -> str:
    digest = hashlib.sha256((source_url or "").encode("utf-8")).hexdigest()[:10]
    safe_slug = (slug or "anime").strip() or "anime"
    return f"{safe_slug}_{kind}_{digest}.jpg"


def _queue_image_fetch(
    anime_id: int,
    cover_url: str,
    banner_url: str,
    mal_id: int | None,
    *,
    countdown: int = 0,
    storage_retry: int = 0,
    force: bool = False,
    force_replace: bool = False,
) -> bool:
    """Queue image fetch task with per-anime dedupe to prevent retry storms."""
    resolved_cover_url = JikanService.resolve_fetchable_image_url(cover_url)
    resolved_banner_url = JikanService.resolve_fetchable_image_url(banner_url)

    if not resolved_cover_url and cover_url:
        logger.info(
            "Skipping non-fetchable cover image URL before enqueue",
            extra={"anime_id": anime_id, "cover_url": cover_url},
        )
    if not resolved_banner_url and banner_url:
        logger.info(
            "Skipping non-fetchable banner image URL before enqueue",
            extra={"anime_id": anime_id, "banner_url": banner_url},
        )
    if not resolved_cover_url and not resolved_banner_url and not mal_id:
        return False

    dedupe_ttl = max(_FETCH_DEDUP_TTL_SECONDS, countdown + 60)
    cache_key = _FETCH_DEDUP_KEY.format(anime_id=anime_id)

    if not force and not cache.add(cache_key, True, timeout=dedupe_ttl):
        return False

    kwargs = {
        "anime_id": anime_id,
        "cover_url": resolved_cover_url,
        "banner_url": resolved_banner_url,
        "mal_id": mal_id,
        "storage_retry": storage_retry,
    }
    if force_replace:
        kwargs["force_replace"] = True
    if countdown > 0:
        fetch_anime_images.apply_async(kwargs=kwargs, countdown=countdown)
    else:
        fetch_anime_images.delay(**kwargs)
    return True


def _is_storage_available() -> bool:
    """Check whether object storage is currently reachable."""
    if not getattr(settings, "USE_S3", False):
        return True

    from django.core.files.storage import default_storage

    try:
        default_storage.exists("health-check/storage-probe")
        return True
    except Exception as exc:
        if _is_storage_endpoint_error(exc):
            return False

        logger.warning(f"Storage health probe failed unexpectedly: {exc}")
        return False


async def _fetch_jikan_fallback_banner(mal_id: int) -> str:
    """Fetch high-res promotional image from Jikan API to use as a banner fallback."""
    if not mal_id:
        return None

    limiter = JikanRateLimiter(base_delay=0.35)

    for attempt in range(3):
        try:
            await limiter.acquire()
            async with httpx.AsyncClient(timeout=10.0) as client:
                url = f"{JIKAN_BASE_URL}/anime/{mal_id}/pictures"
                response = await client.get(url)

                if response.status_code == 429:
                    limiter.record_429()
                    await backoff(2**attempt)
                    continue

                if response.status_code >= 500:
                    limiter.record_error()
                    logger.warning(
                        "Jikan banner fallback returned server error for MAL %s (status=%s, attempt=%s)",
                        mal_id,
                        response.status_code,
                        attempt + 1,
                    )
                    await backoff(2**attempt)
                    continue

                if 400 <= response.status_code < 500:
                    logger.info(
                        "Jikan banner fallback returned non-retryable response for MAL %s (status=%s)",
                        mal_id,
                        response.status_code,
                    )
                    return None

                response.raise_for_status()
                try:
                    data = response.json().get("data", [])
                except ValueError:
                    logger.warning(
                        "Jikan banner fallback returned invalid JSON for MAL %s",
                        mal_id,
                        exc_info=True,
                    )
                    return None

                # Find the largest picture
                for pic in data:
                    large_img = pic.get("webp", {}).get("large_image_url") or pic.get("jpg", {}).get(
                        "large_image_url"
                    )
                    if large_img:
                        return large_img
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError):
            limiter.record_error()
            logger.warning(
                "Jikan banner fallback network failure for MAL %s (attempt=%s)",
                mal_id,
                attempt + 1,
                exc_info=True,
            )
            await backoff(2**attempt)
        except httpx.HTTPStatusError as exc:
            limiter.record_error()
            status_code = exc.response.status_code if exc.response is not None else "unknown"
            logger.warning(
                "Jikan banner fallback HTTP error for MAL %s (status=%s, attempt=%s)",
                mal_id,
                status_code,
                attempt + 1,
                exc_info=True,
            )
            if exc.response is not None and 400 <= exc.response.status_code < 500:
                return None
            await backoff(2**attempt)
        except Exception:
            logger.warning("Jikan banner fallback failed for MAL %s", mal_id, exc_info=True)
            return None

    return None


@observed_shared_task(retry_policy="standard", time_limit_preset="quick")
def fetch_anime_images(
    self,
    anime_id: int,
    cover_url: str,
    banner_url: str,
    mal_id: int | None = None,
    storage_retry: int = 0,
    force_replace: bool = False,
):
    """Background task to download and save cover/banner images without blocking the main sync loop.
    Implements a Jikan fallback for missing banner images.
    """
    logger.info(f"Starting image fetch for Anime ID: {anime_id}")

    from ..models import Anime

    try:
        anime = Anime.objects.get(id=anime_id)

        async def _download_job():
            service = JikanService(enable_caching=False, enable_rate_limiting=False)
            try:
                nonlocal banner_url

                cover_url_resolved = JikanService.resolve_fetchable_image_url(cover_url)
                banner_url = JikanService.resolve_fetchable_image_url(banner_url)

                # Persist external URLs so the API can always fall back even while
                # local storage is degraded.
                if cover_url_resolved and cover_url_resolved != anime.cover_image_external_url:
                    await service._save_external_url(
                        anime, "cover_image_external_url", cover_url_resolved
                    )
                if banner_url and banner_url != anime.banner_image_external_url:
                    await service._save_external_url(anime, "banner_image_external_url", banner_url)

                # Step 1: Jikan Fallback if no banner from AniList
                if not banner_url and not anime.banner_image and mal_id:
                    logger.info(f"No banner for {anime.title}, attempting Jikan fallback...")
                    banner_url = await _fetch_jikan_fallback_banner(mal_id)
                    if banner_url:
                        # Save external URL reference
                        anime.banner_image_external_url = banner_url
                        await service._save_external_url(anime, "banner_image_external_url", banner_url)

                async def _clear_local_image(field_name: str):
                    image_field = getattr(anime, field_name, None)
                    if not image_field:
                        return
                    try:
                        await sync_to_async(image_field.delete)(save=False)
                    except Exception as exc:
                        logger.warning(
                            f"Failed deleting existing {field_name} for anime {anime.id}: {exc}"
                        )
                    setattr(anime, field_name, "")
                    await sync_to_async(anime.save)(update_fields=[field_name])

                # Step 2: Download the Images natively
                if cover_url_resolved and (force_replace or not anime.cover_image):
                    if force_replace and anime.cover_image:
                        await _clear_local_image("cover_image")
                    cover_data = await service.download_image(cover_url_resolved)
                    if cover_data:
                        filename = _image_filename(anime.slug, "cover", cover_url_resolved)
                        await service._save_image(anime, "cover_image", filename, cover_data)

                if banner_url and (force_replace or not anime.banner_image):
                    if force_replace and anime.banner_image:
                        await _clear_local_image("banner_image")
                    banner_data = await service.download_image(banner_url)
                    if banner_data:
                        filename = _image_filename(anime.slug, "banner", banner_url)
                        await service._save_image(anime, "banner_image", filename, banner_data)
            finally:
                await service.close()

        run_async_in_task(_download_job())

        return {"anime_id": anime_id, "status": "success", "storage_retry": storage_retry}

    except Anime.DoesNotExist:
        logger.error(f"Anime with ID {anime_id} not found")
        return {"status": "error", "reason": "anime_not_found"}
    except Exception as e:
        if _is_storage_endpoint_error(e):
            if storage_retry >= _STORAGE_RETRY_ATTEMPT_LIMIT:
                logger.error(
                    f"Storage remained unavailable for anime {anime_id} after "
                    f"{_STORAGE_RETRY_ATTEMPT_LIMIT} attempts; waiting for periodic self-heal"
                )
                return {
                    "anime_id": anime_id,
                    "status": "error",
                    "reason": "storage_unavailable_retry_limit",
                    "storage_retry": storage_retry,
                }

            delay = _storage_retry_delay_seconds(storage_retry)
            queued = _queue_image_fetch(
                anime_id=anime_id,
                cover_url=cover_url,
                banner_url=banner_url,
                mal_id=mal_id,
                countdown=delay,
                storage_retry=storage_retry + 1,
                force_replace=force_replace,
            )
            logger.warning(
                f"Storage unavailable while fetching images for anime {anime_id}; "
                f"scheduled self-heal retry in {delay}s (queued={queued}, attempt={storage_retry + 1})"
            )
            return {
                "anime_id": anime_id,
                "status": "deferred",
                "reason": "storage_unavailable",
                "retry_in_seconds": delay,
                "queued": queued,
                "storage_retry": storage_retry + 1,
            }

        logger.error("Error fetching images for anime %s", anime_id, exc_info=True)
        raise self.retry(exc=e, countdown=60)


@observed_shared_task(retry_policy="none", time_limit_preset="quick")
def heal_missing_anime_media(self, batch_size: int | None = None):
    """Periodic self-heal task for anime missing local media files."""
    from ..models import Anime

    with cache_lock(
        _MEDIA_SELF_HEAL_LOCK_KEY,
        timeout=settings.MEDIA_SELF_HEAL_LOCK_SECONDS,
    ) as acquired:
        if not acquired:
            logger.info("Skipping media self-heal run because another run is active")
            return {"status": "skipped", "reason": "already_running"}

        if not _is_storage_available():
            logger.warning("Skipping media self-heal run because storage is unavailable")
            return {"status": "skipped", "reason": "storage_unavailable"}

        image_queue_depth = get_queue_size("images")
        max_queue_depth = settings.MEDIA_SELF_HEAL_MAX_QUEUE_DEPTH
        if image_queue_depth is not None and image_queue_depth >= max_queue_depth:
            logger.info(
                "Skipping media self-heal run because images queue backlog is already high",
                extra={"image_queue_depth": image_queue_depth, "max_queue_depth": max_queue_depth},
            )
            return {
                "status": "skipped",
                "reason": "image_queue_backlog",
                "image_queue_depth": image_queue_depth,
            }

        resolved_batch_size = max(int(batch_size or settings.MEDIA_SELF_HEAL_BATCH_SIZE), 1)
        missing_cover = (Q(cover_image__isnull=True) | Q(cover_image="")) & Q(
            cover_image_external_url__isnull=False
        ) & ~Q(cover_image_external_url="")
        missing_banner = (Q(banner_image__isnull=True) | Q(banner_image="")) & Q(
            banner_image_external_url__isnull=False
        ) & ~Q(banner_image_external_url="")
        missing_banner_with_mal = (Q(banner_image__isnull=True) | Q(banner_image="")) & Q(
            mal_id__isnull=False
        )

        queryset = Anime.objects.filter(
            missing_cover | missing_banner | missing_banner_with_mal
        ).order_by("-member_count", "id")[:resolved_batch_size]

        inspected = 0
        queued = 0
        for anime in queryset:
            inspected += 1
            cover_url = "" if anime.cover_image else (anime.cover_image_external_url or "")
            banner_url = "" if anime.banner_image else (anime.banner_image_external_url or "")

            if not cover_url and not banner_url and not anime.mal_id:
                continue

            if _queue_image_fetch(
                anime_id=anime.id,
                cover_url=cover_url,
                banner_url=banner_url,
                mal_id=anime.mal_id,
                force=False,
            ):
                queued += 1

        logger.info(
            "Media self-heal run complete",
            extra={
                "inspected": inspected,
                "queued": queued,
                "batch_size": resolved_batch_size,
                "image_queue_depth": image_queue_depth,
            },
        )
        return {
            "status": "success",
            "inspected": inspected,
            "queued": queued,
            "batch_size": resolved_batch_size,
            "image_queue_depth": image_queue_depth,
        }


@observed_shared_task(retry_policy="standard", time_limit_preset="quick")
def generate_image_thumbnails(self, anime_id: int):
    """Generate optimized thumbnails for anime images.
    Runs asynchronously to avoid blocking import process.
    Generates WebP thumbnails in small, medium, and large sizes.
    """
    logger.info(f"Starting thumbnail generation for Anime ID: {anime_id}")

    try:
        from ..models import Anime

        anime = Anime.objects.get(id=anime_id)
        generated_count = 0
        attempted_batches = 0
        failed_batches = 0
        last_error = None

        # Generate cover image thumbnails
        if anime.cover_image:
            attempted_batches += 1
            try:
                # Explicitly generate the thumbnails (since we use Optimistic cache strategy)
                anime.cover_image_small.generate()
                anime.cover_image_medium.generate()
                anime.cover_image_large.generate()
                generated_count += 3
                logger.info(f"Generated cover thumbnails for {anime.title}")
            except Exception as e:
                failed_batches += 1
                last_error = e
                logger.warning(
                    f"Failed to generate cover thumbnails for {anime.title}: {e}"
                )

        # Generate banner image thumbnails
        if anime.banner_image:
            attempted_batches += 1
            try:
                # Explicitly generate the thumbnails (since we use Optimistic cache strategy)
                anime.banner_image_small.generate()
                anime.banner_image_medium.generate()
                anime.banner_image_large.generate()
                generated_count += 3
                logger.info(f"Generated banner thumbnails for {anime.title}")
            except Exception as e:
                failed_batches += 1
                last_error = e
                logger.warning(
                    f"Failed to generate banner thumbnails for {anime.title}: {e}"
                )

        if attempted_batches and failed_batches == attempted_batches and generated_count == 0:
            raise last_error or RuntimeError("Thumbnail generation failed for all requested image variants")

        logger.info(
            f"Thumbnail generation complete for {anime.title}. Generated: {generated_count}"
        )
        return {"anime_id": anime_id, "thumbnails_generated": generated_count}

    except Anime.DoesNotExist:
        logger.error(f"Anime with ID {anime_id} not found")
        return {"status": "error", "reason": "anime_not_found"}
    except Exception as e:
        logger.error(f"Error generating thumbnails for anime {anime_id}: {e}")
        raise self.retry(exc=e, countdown=60)
