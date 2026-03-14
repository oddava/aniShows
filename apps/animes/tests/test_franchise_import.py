from unittest.mock import AsyncMock, patch

from django.test import TestCase

from apps.animes.models import Anime
from apps.animes.services.franchise_import import FranchiseImportService


class FranchiseImportServiceTests(TestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.services.franchise_import.AniListService")
    def test_existing_anime_refreshes_when_images_missing(
        self, mock_anilist_service_cls, _mock_enrich_metadata
    ):
        source = Anime.objects.create(
            title="Source Anime",
            slug="source-anime",
            synopsis="Source",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            relations=[
                {
                    "id": 1001,
                    "type": "SEQUEL",
                    "title": "Target Anime",
                    "format": "TV",
                    "status": "FINISHED",
                    "cover": "https://img.anilist.co/cover.jpg",
                    "slug": None,
                }
            ],
        )
        existing = Anime.objects.create(
            title="Target Anime",
            slug="target-anime",
            synopsis="Target",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=1001,
            cover_image_external_url="",
            banner_image_external_url="",
        )

        anilist_payload = {
            "id": 1001,
            "title": {"english": "Target Anime", "romaji": "Target Anime"},
        }
        mock_service = mock_anilist_service_cls.return_value
        mock_service.get_anime_by_id = AsyncMock(return_value=anilist_payload)
        mock_service.close = AsyncMock(return_value=None)
        mock_service.save_anime_to_db.return_value = existing

        service = FranchiseImportService()
        result = service.import_from_anilist(
            anilist_id=1001, client_ip="127.0.0.1", source_slug=source.slug
        )

        self.assertFalse(result.imported)
        self.assertEqual(result.slug, existing.slug)
        self.assertEqual(result.title, existing.title)

        source.refresh_from_db()
        self.assertEqual(source.relations[0]["slug"], existing.slug)

        mock_service.get_anime_by_id.assert_awaited_once_with(1001)
        mock_service.save_anime_to_db.assert_called_once_with(anilist_payload)
        mock_service.close.assert_awaited_once()

    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.services.franchise_import.AniListService")
    def test_existing_anime_skips_refresh_when_images_present(
        self, mock_anilist_service_cls, _mock_enrich_metadata
    ):
        source = Anime.objects.create(
            title="Source Anime 2",
            slug="source-anime-2",
            synopsis="Source",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            relations=[
                {
                    "id": 2002,
                    "type": "SEQUEL",
                    "title": "Target Anime 2",
                    "format": "TV",
                    "status": "FINISHED",
                    "cover": "https://img.anilist.co/cover2.jpg",
                    "slug": None,
                }
            ],
        )
        existing = Anime.objects.create(
            title="Target Anime 2",
            slug="target-anime-2",
            synopsis="Target",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=2002,
            cover_image_external_url="https://img.anilist.co/cover2.jpg",
            banner_image_external_url="https://img.anilist.co/banner2.jpg",
        )

        service = FranchiseImportService()
        result = service.import_from_anilist(
            anilist_id=2002, client_ip="127.0.0.1", source_slug=source.slug
        )

        self.assertFalse(result.imported)
        self.assertEqual(result.slug, existing.slug)
        self.assertEqual(result.title, existing.title)

        source.refresh_from_db()
        self.assertEqual(source.relations[0]["slug"], existing.slug)

        mock_anilist_service_cls.assert_not_called()
