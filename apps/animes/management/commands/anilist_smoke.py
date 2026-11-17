"""Run every AniList GraphQL operation the app uses once, against a known title.

    python manage.py anilist_smoke

The deploy runs it before migrating: a query AniList rejects (a schema change,
the complexity limit) would otherwise surface only as error logs and degraded
pages. About ten requests, through the shared rate limiter. It fails only
when AniList rejects a query; AniList being busy or unreachable is reported
but does not fail it (the app copes with that on its own).
"""

from django.core.management.base import BaseCommand, CommandError

from ...services.anilist import TRANSIENT_ERROR_CODES, AniListService

# Cowboy Bebop: AniList 1, MyAnimeList 1. Long finished, so every field is stable.
ANILIST_ID = 1
MAL_ID = 1
REJECTED_CODES = {"query_rejected", "invalid_variable"}


class Command(BaseCommand):
    help = "Check that AniList accepts every GraphQL query the app sends"

    def handle(self, *args, **options):
        service = AniListService(enable_caching=False, enable_rate_limiting=True)
        checks = {
            "GetAnimeById": lambda: service.get_anime_by_id(ANILIST_ID),
            "SearchByMalId": lambda: service.search_by_mal_id(MAL_ID),
            "SearchAnime": lambda: service.search_anime("Cowboy Bebop", per_page=1),
            "GetAnime (trending)": lambda: service.get_recent_updates(limit=1),
            "BySeason": lambda: service.get_by_season("SPRING", 1998, limit=1),
            "GetAiringByIds": lambda: service.get_airing_by_ids(
                anilist_ids=[ANILIST_ID], mal_ids=[MAL_ID]
            ),
            "GetAiringAnime": lambda: service.get_airing_anime(anilist_id=ANILIST_ID),
            "GetAnimeEpisodes": lambda: service.get_episode_schedule(anilist_id=ANILIST_ID),
            "GetAnimeRecommendations": lambda: service.get_recommendations_for_anime(
                ANILIST_ID, limit=1
            ),
        }
        rejected = []
        try:
            for name, check in checks.items():
                result = check()
                code, message = service.last_error_code, service.last_error_message
                if result:
                    self.stdout.write(self.style.SUCCESS(f"ok        {name}"))
                elif code in REJECTED_CODES:
                    rejected.append(name)
                    self.stdout.write(self.style.ERROR(f"REJECTED  {name}: {message}"))
                elif code in TRANSIENT_ERROR_CODES:
                    self.stdout.write(self.style.WARNING(f"skipped   {name}: AniList {code}"))
                else:
                    self.stdout.write(self.style.WARNING(f"no data   {name}: {code or 'empty'}"))
        finally:
            service.close()

        if rejected:
            raise CommandError(f"AniList rejected {len(rejected)} queries: {', '.join(rejected)}")
