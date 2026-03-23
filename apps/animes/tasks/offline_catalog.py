from celery import shared_task

from apps.animes.services.offline_catalog import (
    DEFAULT_ASSET_NAME,
    OfflineCatalogImportService,
)

from .base import BaseTask


class OfflineCatalogImportTask(BaseTask):
    enable_locking = True
    lock_timeout = 7200

    def execute(
        self,
        release_tag: str = "latest",
        asset_name: str = DEFAULT_ASSET_NAME,
        source_url: str | None = None,
        source_path: str | None = None,
        limit: int | None = None,
        resume: bool = False,
        enqueue_enrichment: bool = False,
        batch_size: int = 250,
        enrichment_chunk_size: int = 100,
    ):
        self.metrics.start()
        service = OfflineCatalogImportService(
            batch_size=batch_size,
            enrichment_chunk_size=enrichment_chunk_size,
        )
        result = service.run_import(
            release_tag=release_tag,
            asset_name=asset_name,
            source_url=source_url,
            source_path=source_path,
            limit=limit,
            resume=resume,
            enqueue_enrichment=enqueue_enrichment,
        )
        self.metrics.record_records(result.get("records_seen", 0))
        return result


@shared_task(
    bind=True,
    base=OfflineCatalogImportTask,
    max_retries=2,
    default_retry_delay=300,
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    time_limit=7200,
    soft_time_limit=6900,
)
def import_offline_catalog(
    self,
    release_tag: str = "latest",
    asset_name: str = DEFAULT_ASSET_NAME,
    source_url: str | None = None,
    source_path: str | None = None,
    limit: int | None = None,
    resume: bool = False,
    enqueue_enrichment: bool = False,
    batch_size: int = 250,
    enrichment_chunk_size: int = 100,
):
    return self.execute(
        release_tag=release_tag,
        asset_name=asset_name,
        source_url=source_url,
        source_path=source_path,
        limit=limit,
        resume=resume,
        enqueue_enrichment=enqueue_enrichment,
        batch_size=batch_size,
        enrichment_chunk_size=enrichment_chunk_size,
    )
