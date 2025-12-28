from django.core.management.base import BaseCommand
from django.utils.text import slugify
from anime.models import Anime, Genre, Studio, AnimeType, AnimeStatus
import httpx
import asyncio
import json
from typing import Literal
from enum import Enum
from datetime import datetime
import os


class MediaSort(str, Enum):
    """Sorting options for anime."""
    ID_DESC = "ID_DESC"
    SCORE = "SCORE_DESC"
    POPULARITY = "POPULARITY_DESC"
    TRENDING = "TRENDING_DESC"
    START_DATE = "START_DATE_DESC"


class MediaStatus(str, Enum):
    """Status of the anime."""
    FINISHED = "FINISHED"
    RELEASING = "RELEASING"
    NOT_YET_RELEASED = "NOT_YET_RELEASED"
    CANCELLED = "CANCELLED"


class MediaFormat(str, Enum):
    """Format of the anime."""
    TV = "TV"
    TV_SHORT = "TV_SHORT"
    MOVIE = "MOVIE"
    SPECIAL = "SPECIAL"
    OVA = "OVA"
    ONA = "ONA"
    MUSIC = "MUSIC"


class AniListScraper:
    BASE_URL = "https://graphql.anilist.co/"

    def __init__(self):
        self.client = httpx.AsyncClient(
            headers={"Content-Type": "application/json"},
            timeout=15.0
        )

    async def _query(self, query: str, variables: dict) -> dict:
        """Execute GraphQL query."""
        try:
            response = await self.client.post(
                self.BASE_URL,
                json={"query": query, "variables": variables}
            )
            response.raise_for_status()
            data = response.json()

            if "errors" in data:
                print(f"GraphQL Error: {data['errors'][0]['message']}")
                return {}

            return data.get("data", {})
        except httpx.HTTPError as e:
            print(f"Request error: {e}")
            return {}

    async def get_anime(
            self,
            limit: int = 50,
            sort: MediaSort = MediaSort.POPULARITY
    ) -> list[dict]:
        """Get anime data."""
        gql = """
        query GetAnime($perPage: Int, $sort: [MediaSort]) {
            Page(perPage: $perPage) {
                media(type: ANIME, sort: $sort, isAdult: false) {
                    id
                    title { romaji english native }
                    format status episodes averageScore popularity duration
                    startDate { year month day }
                    endDate { year month day }
                    season seasonYear
                    genres
                    studios(isMain: true) { nodes { name } }
                    description
                    coverImage { large extraLarge }
                    bannerImage
                    trailer { id site }
                }
            }
        }
        """

        data = await self._query(gql, {"perPage": limit, "sort": [sort.value]})
        return data.get("Page", {}).get("media", [])

    async def get_by_season(
            self,
            season: Literal["WINTER", "SPRING", "SUMMER", "FALL"],
            year: int,
            limit: int = 50,
            sort: MediaSort = MediaSort.POPULARITY
    ) -> list[dict]:
        """Get anime by season and year."""
        gql = """
        query BySeason($season: MediaSeason, $year: Int, $perPage: Int, $sort: [MediaSort]) {
            Page(perPage: $perPage) {
                media(type: ANIME, season: $season, seasonYear: $year, sort: $sort, isAdult: false) {
                    id
                    title { romaji english native }
                    format status episodes averageScore popularity duration
                    startDate { year month day }
                    endDate { year month day }
                    season seasonYear
                    genres
                    studios(isMain: true) { nodes { name } }
                    description
                    coverImage { large extraLarge }
                    bannerImage
                    trailer { id site }
                }
            }
        }
        """

        data = await self._query(gql, {
            "season": season,
            "year": year,
            "perPage": limit,
            "sort": [sort.value]
        })
        return data.get("Page", {}).get("media", [])

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()


class Command(BaseCommand):
    help = 'Import anime data from AniList API'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=50,
            help='Number of anime to import'
        )
        parser.add_argument(
            '--season',
            type=str,
            choices=['WINTER', 'SPRING', 'SUMMER', 'FALL'],
            help='Import specific season'
        )
        parser.add_argument(
            '--year',
            type=int,
            help='Year for seasonal import'
        )
        parser.add_argument(
            '--sort',
            type=str,
            default='POPULARITY',
            choices=['POPULARITY', 'SCORE', 'TRENDING', 'START_DATE'],
            help='Sort method'
        )
        parser.add_argument(
            '--create-fixtures',
            action='store_true',
            help='Create JSON fixtures instead of importing to database'
        )
        parser.add_argument(
            '--update',
            action='store_true',
            help='Update existing anime if found'
        )

    def handle(self, *args, **options):
        limit = options['limit']
        sort = MediaSort[options['sort']]
        create_fixtures = options['create_fixtures']
        update_existing = options['update']

        self.stdout.write(self.style.NOTICE(f'Starting anime import (limit: {limit})...'))

        # Run async scraper
        anime_data = asyncio.run(self._scrape_data(options, limit, sort))

        if not anime_data:
            self.stdout.write(self.style.ERROR('No data retrieved'))
            return

        if create_fixtures:
            self._create_fixtures(anime_data)
        else:
            self._import_to_database(anime_data, update_existing)

    async def _scrape_data(self, options, limit, sort):
        """Scrape data from AniList API."""
        scraper = AniListScraper()
        try:
            if options['season'] and options['year']:
                self.stdout.write(f"Fetching {options['season']} {options['year']} anime...")
                data = await scraper.get_by_season(
                    options['season'],
                    options['year'],
                    limit,
                    sort
                )
            else:
                self.stdout.write("Fetching top anime...")
                data = await scraper.get_anime(limit, sort)

            return data
        finally:
            await scraper.close()

    def _import_to_database(self, anime_data, update_existing):
        """Import scraped data into Django database."""
        created_count = 0
        updated_count = 0
        skipped_count = 0

        for item in anime_data:
            try:
                # Extract data
                title_romaji = item.get("title", {}).get("romaji", "")
                title_english = item.get("title", {}).get("english", "")
                title_native = item.get("title", {}).get("native", "")

                title = title_english or title_romaji
                slug = slugify(title)

                # Check if exists
                anime, created = Anime.objects.get_or_create(
                    slug=slug,
                    defaults=self._prepare_anime_data(item, title, title_english, title_native, slug)
                )

                if not created and update_existing:
                    # Update existing anime
                    for key, value in self._prepare_anime_data(item, title, title_english, title_native, slug).items():
                        setattr(anime, key, value)
                    anime.save()
                    updated_count += 1
                    self.stdout.write(self.style.WARNING(f'Updated: {title}'))
                elif created:
                    # Handle relationships for new anime
                    self._handle_relationships(anime, item)
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f'Created: {title}'))
                else:
                    skipped_count += 1

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'Error importing {item.get("title", {})}: {str(e)}'))

        # Summary
        self.stdout.write(self.style.SUCCESS(f'\n=== Import Summary ==='))
        self.stdout.write(f'Created: {created_count}')
        self.stdout.write(f'Updated: {updated_count}')
        self.stdout.write(f'Skipped: {skipped_count}')

    def _prepare_anime_data(self, item, title, title_english, title_native, slug):
        """Prepare anime data for database insertion."""
        # Map format
        format_map = {
            'TV': AnimeType.tv,
            'TV_SHORT': AnimeType.tv,
            'MOVIE': AnimeType.movie,
            'OVA': AnimeType.ova,
            'ONA': AnimeType.special,
            'SPECIAL': AnimeType.special,
            'MUSIC': AnimeType.special,
        }
        anime_type = format_map.get(item.get("format", "TV"), AnimeType.tv)

        # Map status
        status_map = {
            'RELEASING': AnimeStatus.airing,
            'FINISHED': AnimeStatus.finished,
            'NOT_YET_RELEASED': AnimeStatus.upcoming,
            'CANCELLED': AnimeStatus.finished,
        }
        status = status_map.get(item.get("status", "FINISHED"), AnimeStatus.finished)

        # Dates
        start_date = self._parse_date(item.get("startDate", {}))
        end_date = self._parse_date(item.get("endDate", {}))

        # Rating (convert from 0-100 to 0-10)
        avg_score = item.get("averageScore", 0)
        rating = round(avg_score / 10, 1) if avg_score else None

        # Description
        description = item.get("description", "")
        if description:
            # Remove HTML tags
            import re
            description = re.sub(r'<[^>]+>', '', description)
            description = description.strip()

        return {
            'title': title,
            'title_english': title_english or "",
            'title_japanese': title_native or "",
            'slug': slug,
            'synopsis': description or "No description available.",
            'anime_type': anime_type,
            'status': status,
            'episode_count': item.get("episodes", 0) or 0,
            'duration_minutes': item.get("duration", 24) or 24,
            'release_date': start_date,
            'end_date': end_date,
            'rating': rating,
            'meta_description': (description[:157] + '...') if description and len(description) > 160 else description,
        }

    def _handle_relationships(self, anime, item):
        """Handle genres and studio relationships."""
        # Handle genres
        genres = item.get("genres", [])
        for genre_name in genres:
            genre, _ = Genre.objects.get_or_create(
                name=genre_name,
                defaults={'slug': slugify(genre_name)}
            )
            anime.genres.add(genre)

        # Handle studio
        studios = item.get("studios", {}).get("nodes", [])
        if studios and len(studios) > 0:
            studio_name = studios[0].get("name")
            if studio_name:
                studio, _ = Studio.objects.get_or_create(name=studio_name)
                anime.studio = studio
                anime.save()

    def _parse_date(self, date_obj):
        """Parse date object to Python date."""
        if not date_obj or not date_obj.get("year"):
            return None

        year = date_obj.get("year")
        month = date_obj.get("month", 1)
        day = date_obj.get("day", 1)

        try:
            return datetime(year, month, day).date()
        except ValueError:
            return None

    def _create_fixtures(self, anime_data):
        """Create JSON fixtures from scraped data."""
        fixtures = []
        anime_id = 1
        genre_id = 1
        studio_id = 1

        genres_map = {}
        studios_map = {}

        # Process all anime
        for item in anime_data:
            try:
                title_romaji = item.get("title", {}).get("romaji", "")
                title_english = item.get("title", {}).get("english", "")
                title_native = item.get("title", {}).get("native", "")
                title = title_english or title_romaji

                # Collect genres
                genre_ids = []
                for genre_name in item.get("genres", []):
                    if genre_name not in genres_map:
                        genres_map[genre_name] = genre_id
                        fixtures.append({
                            "model": "anime.genre",
                            "pk": genre_id,
                            "fields": {
                                "name": genre_name,
                                "slug": slugify(genre_name),
                                "description": ""
                            }
                        })
                        genre_id += 1
                    genre_ids.append(genres_map[genre_name])

                # Collect studio
                studio_pk = None
                studios = item.get("studios", {}).get("nodes", [])
                if studios and len(studios) > 0:
                    studio_name = studios[0].get("name")
                    if studio_name and studio_name not in studios_map:
                        studios_map[studio_name] = studio_id
                        fixtures.append({
                            "model": "anime.studio",
                            "pk": studio_id,
                            "fields": {
                                "name": studio_name,
                                "founded_date": None,
                                "website": ""
                            }
                        })
                        studio_pk = studio_id
                        studio_id += 1
                    elif studio_name:
                        studio_pk = studios_map[studio_name]

                # Create anime fixture
                anime_data_dict = self._prepare_anime_data(
                    item, title, title_english, title_native, slugify(title)
                )

                # Convert dates to strings
                if anime_data_dict.get('release_date'):
                    anime_data_dict['release_date'] = str(anime_data_dict['release_date'])
                if anime_data_dict.get('end_date'):
                    anime_data_dict['end_date'] = str(anime_data_dict['end_date'])

                anime_fixture = {
                    "model": "anime.anime",
                    "pk": anime_id,
                    "fields": {
                        **anime_data_dict,
                        "cover_image": "",
                        "banner_image": "",
                        "trailer_url": "",
                        "studio": studio_pk,
                        "genres": genre_ids,
                    }
                }
                fixtures.append(anime_fixture)
                anime_id += 1

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'Error creating fixture: {str(e)}'))

        # Save to file
        output_path = 'anime/fixtures/anime_data.json'
        os.makedirs('anime/fixtures', exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(fixtures, f, indent=2, ensure_ascii=False)

        self.stdout.write(self.style.SUCCESS(f'\n✓ Fixtures created: {output_path}'))
        self.stdout.write(f'Total anime: {anime_id - 1}')
        self.stdout.write(f'Total genres: {genre_id - 1}')
        self.stdout.write(f'Total studios: {studio_id - 1}')
        self.stdout.write(f'\nLoad with: python manage.py loaddata anime_data.json')