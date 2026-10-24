"""The daily backfills must move through the catalog, not re-pick the same rows."""

from datetime import timedelta
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import TestCase
from django.utils import timezone

from ..models import Anime
from ..tasks.metadata import MetadataEnrichmentTask
from ..tasks.themes import ThemeSongSyncTask


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

        async def resolve(service, anime):
            seen.append(anime.slug)
            return None

        with patch.object(task, "_resolve_media_for_anime", side_effect=resolve):
            async_to_sync(task._enrich_batch)(
                batch_size, None, "popularity_rank", None, False
            )
        return seen

    def test_most_popular_first_then_moves_on_to_unchecked_rows(self):
        _anime("unranked")
        _anime("niche", popularity_rank=500)
        _anime("hit", popularity_rank=1)

        self.assertEqual(self._run(2), ["hit", "niche"])
        self.assertEqual(self._run(2), ["unranked", "hit"])
        self.assertTrue(
            all(Anime.objects.values_list("metadata_checked_at", flat=True))
        )


class ThemeBackfillRotationTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_checked_anime_without_themes_are_not_refetched_daily(self):
        checked = _anime("checked", mal_id=1, themes_checked_at=timezone.now())
        fresh = _anime("fresh", mal_id=2)
        stale = _anime(
            "stale", mal_id=3, themes_checked_at=timezone.now() - timedelta(days=8)
        )
        fetch = AsyncMock(return_value={"openings": [], "endings": []})

        with patch("apps.animes.tasks.themes.fetch_themes_from_jikan", fetch):
            async_to_sync(ThemeSongSyncTask()._sync_batch)(10, False, False, 0, None)
            daily = [call.args[1] for call in fetch.await_args_list]
            fetch.reset_mock()
            async_to_sync(ThemeSongSyncTask()._sync_batch)(10, False, True, 0, None)
            retry = [call.args[1] for call in fetch.await_args_list]

        self.assertEqual(daily, [fresh.mal_id])
        self.assertEqual(retry, [stale.mal_id])
        fresh.refresh_from_db()
        self.assertIsNotNone(fresh.themes_checked_at)
        checked.refresh_from_db()
        self.assertIsNotNone(checked.themes_checked_at)


class ThemeSongSaveTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_replaces_existing_themes_and_skips_malformed_entries(self):
        anime = _anime("frieren", mal_id=52991)
        anime.theme_songs.create(song_type="opening", track_number=1, title="Old")

        count = async_to_sync(ThemeSongSyncTask()._save_theme_songs)(
            anime,
            {
                "openings": ['1: "Yuusha" by YOASOBI (eps 1-14)', None, 42],
                "endings": ['"Anytime Anywhere" by milet'],
            },
        )

        self.assertEqual(count, 2)
        self.assertEqual(
            sorted(anime.theme_songs.values_list("song_type", "title")),
            [("ending", "Anytime Anywhere"), ("opening", "Yuusha")],
        )
