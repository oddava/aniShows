from django.db import models
from rest_framework import status

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


class EpisodeRatingCommandService:
    """Handle episode rating write operations and summary refresh."""

    def upsert(self, *, anime, user, episode_number: int, rating):
        self._validate_episode_number(anime, episode_number)
        _, created = EpisodeRating.objects.update_or_create(
            user=user,
            anime=anime,
            episode_number=episode_number,
            defaults={"rating": rating},
        )
        summary = EpisodeRatingSummaryService().get_for_anime(
            anime,
            user=user,
            episode_numbers=[episode_number],
        )[0]
        return summary, status.HTTP_201_CREATED if created else status.HTTP_200_OK

    def delete(self, *, anime, user, episode_number: int):
        self._validate_episode_number(anime, episode_number)
        EpisodeRating.objects.filter(
            user=user,
            anime=anime,
            episode_number=episode_number,
        ).delete()
        summary = EpisodeRatingSummaryService().get_for_anime(
            anime,
            user=user,
            episode_numbers=[episode_number],
        )[0]
        return summary, status.HTTP_200_OK

    @staticmethod
    def _validate_episode_number(anime, episode_number: int):
        if episode_number <= 0:
            raise ValueError("Episode number must be positive.")
        if anime.episode_count > 0 and episode_number > anime.episode_count:
            raise ValueError(
                f"Episode number cannot exceed the known episode count ({anime.episode_count})."
            )
