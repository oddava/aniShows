from django.db import models

from apps.animes.models import EpisodeRating


class EpisodeRatingSummaryService:
    """Build public episode rating aggregates with optional user-private values."""

    def get_for_anime(self, anime, *, user=None, episode_numbers=None) -> list[dict]:
        resolved_episode_numbers = self._resolve_episode_numbers(anime, episode_numbers)

        aggregates = EpisodeRating.objects.filter(anime=anime)
        if resolved_episode_numbers:
            aggregates = aggregates.filter(episode_number__in=resolved_episode_numbers)

        aggregate_map = {
            row["episode_number"]: row
            for row in aggregates.values("episode_number")
            .annotate(
                average_rating=models.Avg("rating"),
                rating_count=models.Count("id"),
            )
            .order_by("episode_number")
        }

        user_map = {}
        if getattr(user, "is_authenticated", False):
            user_queryset = EpisodeRating.objects.filter(anime=anime, user=user)
            if resolved_episode_numbers:
                user_queryset = user_queryset.filter(episode_number__in=resolved_episode_numbers)
            user_map = {
                episode_rating.episode_number: episode_rating.rating
                for episode_rating in user_queryset.only("episode_number", "rating")
            }

        if not resolved_episode_numbers:
            resolved_episode_numbers = sorted({*aggregate_map.keys(), *user_map.keys()})

        return [
            {
                "episode_number": episode_number,
                "average_rating": (aggregate_map.get(episode_number) or {}).get("average_rating"),
                "rating_count": int((aggregate_map.get(episode_number) or {}).get("rating_count") or 0),
                "user_rating": user_map.get(episode_number),
            }
            for episode_number in resolved_episode_numbers
        ]

    @staticmethod
    def _resolve_episode_numbers(anime, episode_numbers) -> list[int]:
        if episode_numbers:
            return sorted({int(number) for number in episode_numbers if int(number) > 0})

        total_episodes = int(getattr(anime, "episode_count", 0) or 0)
        if total_episodes > 0:
            return list(range(1, total_episodes + 1))

        return []
