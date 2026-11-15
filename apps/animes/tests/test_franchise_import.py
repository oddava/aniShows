from unittest.mock import MagicMock, patch

from django.test import TestCase

from ..models import Anime
from ..services.franchise_import import FranchiseImportError, FranchiseImportService
from ..services.relation_links import set_relations


class FranchiseImportServiceTests(TestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.services.franchise_import.AniListService")
    def test_existing_anime_refreshes_when_images_missing(
        self, mock_service_cls, _mock_enrich_metadata
    ):
        source = Anime.objects.create(
            title="Source Anime",
            slug="source-anime",
            synopsis="Source",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
        )
        set_relations(
            source,
            [
                {
                    "id": 1001,
                    "type": "SEQUEL",
                    "title": "Target Anime",
                    "format": "TV",
                    "status": "FINISHED",
                    "cover": "https://img.anilist.co/cover.jpg",
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
        mock_service_cls.normalize_external_image_url.side_effect = lambda value: value or ""
        mock_service = mock_service_cls.return_value
        mock_service.resolve_media_for_anime = MagicMock(return_value=anilist_payload)
        mock_service.close = MagicMock(return_value=None)
        mock_service.save_anime_to_db.return_value = existing

        service = FranchiseImportService()
        result = service.import_related_anime(
            anilist_id=1001, client_ip="127.0.0.1", source_slug=source.slug
        )

        self.assertFalse(result.imported)
        self.assertEqual(result.slug, existing.slug)
        self.assertEqual(result.title, existing.title)

        self.assertEqual(source.relations.get().to_anime, existing)

        mock_service.resolve_media_for_anime.assert_called_once_with(existing)
        mock_service.save_anime_to_db.assert_called_once_with(anilist_payload)
        mock_service.close.assert_called_once()

    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.services.franchise_import.AniListService")
    def test_existing_anime_skips_refresh_when_images_present(
        self, mock_service_cls, _mock_enrich_metadata
    ):
        source = Anime.objects.create(
            title="Source Anime 2",
            slug="source-anime-2",
            synopsis="Source",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
        )
        set_relations(
            source,
            [
                {
                    "id": 2002,
                    "type": "SEQUEL",
                    "title": "Target Anime 2",
                    "format": "TV",
                    "status": "FINISHED",
                    "cover": "https://img.anilist.co/cover2.jpg",
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
        result = service.import_related_anime(
            anilist_id=2002, client_ip="127.0.0.1", source_slug=source.slug
        )

        self.assertFalse(result.imported)
        self.assertEqual(result.slug, existing.slug)
        self.assertEqual(result.title, existing.title)

        self.assertEqual(source.relations.get().to_anime, existing)

        mock_service_cls.assert_not_called()


@patch("apps.animes.signals.enrich_metadata.delay")
@patch("apps.animes.services.franchise_import.AniListService")
class FranchiseImportNewAnimeTests(TestCase):
    def _service(self, mock_service_cls, *, by_id=None, by_mal=None):
        mock_service_cls.normalize_external_image_url.side_effect = lambda value: value or ""
        service = mock_service_cls.return_value
        service.get_anime_by_id.return_value = by_id
        service.search_by_mal_id.return_value = by_mal

        def save(item):
            return Anime.objects.create(
                title=item["title"]["romaji"],
                slug=item["title"]["romaji"].lower().replace(" ", "-"),
                synopsis="x",
                anilist_id=item.get("id"),
                mal_id=item.get("idMal"),
            )

        service.save_anime_to_db.side_effect = save
        return service

    def test_imports_an_anilist_only_relation(self, mock_service_cls, _enrich):
        payload = {"id": 5005, "idMal": None, "title": {"romaji": "AniList Only"}}
        service = self._service(mock_service_cls, by_id=payload)

        result = FranchiseImportService().import_related_anime(anilist_id=5005, client_ip="1.2.3.4")

        self.assertTrue(result.imported)
        self.assertEqual(result.slug, "anilist-only")
        service.get_anime_by_id.assert_called_once_with(5005)
        service.search_by_mal_id.assert_not_called()
        service.close.assert_called_once()

    def test_falls_back_to_the_mal_id(self, mock_service_cls, _enrich):
        payload = {"id": 6006, "idMal": 66, "title": {"romaji": "Via MAL"}}
        service = self._service(mock_service_cls, by_id=None, by_mal=payload)

        result = FranchiseImportService().import_related_anime(
            anilist_id=6006, mal_id=66, client_ip="1.2.3.4"
        )

        self.assertTrue(result.imported)
        service.search_by_mal_id.assert_called_once_with(66)

    def test_mal_only_relation_skips_the_anilist_lookup(self, mock_service_cls, _enrich):
        payload = {"id": 7007, "idMal": 77, "title": {"romaji": "MAL Relation"}}
        service = self._service(mock_service_cls, by_mal=payload)

        FranchiseImportService().import_related_anime(mal_id=77, client_ip="1.2.3.4")

        service.get_anime_by_id.assert_not_called()
        service.search_by_mal_id.assert_called_once_with(77)

    def test_unknown_anime_is_a_404(self, mock_service_cls, _enrich):
        self._service(mock_service_cls)

        with self.assertRaises(FranchiseImportError) as raised:
            FranchiseImportService().import_related_anime(anilist_id=8008, client_ip="1.2.3.4")

        self.assertEqual(raised.exception.status_code, 404)
