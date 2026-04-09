from types import SimpleNamespace

from django.test import SimpleTestCase

from ..serializers.anime import AnimeDetailSerializer


class AnimeDetailStatusDistributionTests(SimpleTestCase):
    def test_status_distribution_uses_denormalized_counts(self):
        anime = SimpleNamespace(
            pk=99,
            status_distribution={
                "watching": 2,
                "completed": 1,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 4,
            },
        )

        distribution = AnimeDetailSerializer().get_status_distribution(anime)

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

    def test_status_distribution_normalizes_missing_counts(self):
        anime = SimpleNamespace(
            pk=99,
            status_distribution={
                "watching": 2,
            },
        )

        distribution = AnimeDetailSerializer().get_status_distribution(anime)

        self.assertEqual(
            distribution,
            {
                "watching": 2,
                "completed": 0,
                "on_hold": 0,
                "dropped": 0,
                "plan_to_watch": 0,
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
