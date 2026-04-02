from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.animes.serializers.anime import AnimeDetailSerializer


class AnimeDetailStatusDistributionTests(SimpleTestCase):
    @patch("apps.animes.serializers.anime.UserAnimeList.objects.filter")
    def test_status_distribution_uses_live_site_counts(self, filter_mock):
        filter_mock.return_value.aggregate.return_value = {
            "watching": 2,
            "completed": 1,
            "on_hold": 0,
            "dropped": 0,
            "plan_to_watch": 4,
        }

        anime = SimpleNamespace(pk=99, status_distribution={"CURRENT": 99999})
        distribution = AnimeDetailSerializer().get_status_distribution(anime)

        filter_mock.assert_called_once_with(anime_id=99)
        self.assertEqual(
            distribution,
            {
                "watching": 2,
                "completed": 1,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 4,
            },
        )

    def test_status_distribution_defaults_to_zero_without_anime_id(self):
        anime = SimpleNamespace(pk=None)
        distribution = AnimeDetailSerializer().get_status_distribution(anime)

        self.assertEqual(
            distribution,
            {
                "watching": 0,
                "completed": 0,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 0,
            },
        )
