"""The daily backfills must move through the catalog, not re-pick the same rows."""

from unittest.mock import patch

from django.test import TestCase

from ..models import Anime
from ..tasks.metadata import MetadataEnrichmentTask
from ..tasks.themes import backfill_theme_youtube_urls


def _anime(slug, **fields):
    return Anime.objects.create(
        title=slug.title(),
        slug=slug,
        synopsis="x",
        anime_type=Anime.AnimeType.tv,
        status=Anime.AnimeStatus.finished,
        **fields,
    )


class MetadataBackfillRotationTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)

    def _run(self, batch_size):
        task = MetadataEnrichmentTask()
        seen = []

        def resolve(service, anime):
            seen.append(anime.slug)
            return None

        with patch.object(task, "_resolve_media_for_anime", side_effect=resolve):
            task._enrich_batch(batch_size, None, "popularity_rank", None, False)
        return seen

    def test_most_popular_first_then_moves_on_to_unchecked_rows(self):
        _anime("unranked")
        _anime("niche", popularity_rank=500)
        _anime("hit", popularity_rank=1)

        self.assertEqual(self._run(2), ["hit", "niche"])
        self.assertEqual(self._run(2), ["unranked", "hit"])
        self.assertTrue(all(Anime.objects.values_list("metadata_checked_at", flat=True)))


class ThemeYoutubeBackfillTests(TestCase):
    """Theme songs are no longer synced (AniList has none); stored ones keep their links."""

    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_fills_missing_youtube_links_only(self):
        anime = _anime("frieren")
        missing = anime.theme_songs.create(
            song_type="opening", track_number=1, title="Yuusha", artist="YOASOBI"
        )
        linked = anime.theme_songs.create(
            song_type="ending", track_number=1, title="Anytime", youtube_url="https://y/1"
        )

        result = backfill_theme_youtube_urls.apply().get()

        missing.refresh_from_db()
        linked.refresh_from_db()
        self.assertEqual(result["updated"], 1)
        self.assertEqual(
            missing.youtube_url,
            "https://www.youtube.com/results?search_query=Yuusha+YOASOBI+Frieren+opening",
        )
        self.assertEqual(linked.youtube_url, "https://y/1")

    def test_theme_sync_task_is_gone(self):
        from .. import tasks

        self.assertFalse(hasattr(tasks, "sync_theme_songs"))
