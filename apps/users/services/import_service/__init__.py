from ...models import UserImportJob
from .anilist import AniListImporter
from .base import BaseImporter
from .mal_api import MyAnimeListAPIImporter
from .mal_xml import MyAnimeListXMLImporter


class ImportService:
    """Factory for creating importers"""

    @staticmethod
    def create_importer(job: UserImportJob, **kwargs) -> BaseImporter:
        """Create appropriate importer based on job source"""
        if job.source == UserImportJob.ImportSource.myanimelist_api:
            return MyAnimeListAPIImporter(
                job=job,
                username=kwargs.get("username"),
                client_id=kwargs.get("client_id"),
            )
        elif job.source == UserImportJob.ImportSource.myanimelist_xml:
            return MyAnimeListXMLImporter(job=job, xml_content=kwargs.get("xml_content"))
        elif job.source == UserImportJob.ImportSource.anilist:
            return AniListImporter(
                job=job,
                username=kwargs.get("username"),
                access_token=kwargs.get("access_token"),
            )
        else:
            raise ValueError(f"Unknown import source: {job.source}")
