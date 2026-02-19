from django.core.management.base import BaseCommand
from django.utils.text import slugify
from django.core.files.base import ContentFile
from asgiref.sync import sync_to_async
from apps.anime.models import Anime, Genre, Studio
import httpx
import asyncio
import json
from typing import Literal, Optional, List, Dict
from enum import Enum
from datetime import datetime
import os
import logging

AnimeType, AnimeStatus = Anime.AnimeType, Anime.AnimeStatus


class MediaSort(str, Enum):
    ID_DESC = "ID_DESC"
    SCORE = "SCORE_DESC"
    POPULARITY = "POPULARITY_DESC"
    TRENDING = "TRENDING_DESC"
    START_DATE = "START_DATE_DESC"


class MediaStatus(str, Enum):
    FINISHED = "FINISHED"
    RELEASING = "RELEASING"
    NOT_YET_RELEASED = "NOT_YET_RELEASED"
    CANCELLED = "CANCELLED"


class MediaFormat(str, Enum):
    TV = "TV"
    TV_SHORT = "TV_SHORT"
    MOVIE = "MOVIE"
    SPECIAL = "SPECIAL"
    OVA = "OVA"
    ONA = "ONA"
    MUSIC = "MUSIC"


class AniListScraper:
    BASE_URL = "https://graphql.anilist.co/"
    MAX_PER_PAGE = 50

    def __init__(self):
        self.client = httpx.AsyncClient(
            headers={"Content-Type": "application/json"}, timeout=15.0
        )

    async def _query(self, query: str, variables: dict) -> dict:
        try:
            response = await self.client.post(
                self.BASE_URL, json={"query": query, "variables": variables}
            )
            response.raise_for_status()
            data = response.json()
            if "errors" in data:
                logging.error(f"GraphQL Error: {data['errors'][0]['message']}")
                return {}
            return data.get("data", {})
        except httpx.HTTPError as e:
            logging.error(f"Request error: {e}")
            return {}

    async def download_image(self, url: str) -> Optional[bytes]:
        if not url:
            return None
        try:
            response = await self.client.get(url)
            response.raise_for_status()
            # Security: Consider limiting file size here!
            return response.content
        except httpx.HTTPError as e:
            logging.error(f"Error downloading image {url}: {e}")
            return None

    # --- Shared GraphQL query for DRYness ---
    @staticmethod
    def anime_query(include_season: bool = False) -> str:
        if include_season:
            return """
            query BySeason($season: MediaSeason, $year: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {
                Page(page: $page, perPage: $perPage) {
                    pageInfo { total currentPage lastPage hasNextPage }
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
        else:
            return """
            query GetAnime($page: Int, $perPage: Int, $sort: [MediaSort]) {
                Page(page: $page, perPage: $perPage) {
                    pageInfo { total currentPage lastPage hasNextPage }
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

    # --- Pagination-aware fetch ---
    async def _fetch_paginated(
        self, variables: dict, include_season: bool = False, limit: int = 50
    ) -> List[dict]:
        results = []
        page = 1
        per_page = min(limit, self.MAX_PER_PAGE)
        query = self.anime_query(include_season)
        while len(results) < limit:
            variables.update({"page": page, "perPage": per_page})
            data = await self._query(query, variables)
            page_data = data.get("Page", {})
            media = page_data.get("media", [])
            results.extend(media)
            page_info = page_data.get("pageInfo", {})
            if not page_info.get("hasNextPage") or not media:
                break
            page += 1
        return results[:limit]

    async def get_anime(
        self, limit: int = 50, sort: MediaSort = MediaSort.POPULARITY
    ) -> List[dict]:
        return await self._fetch_paginated(
            variables={"sort": [sort.value]}, include_season=False, limit=limit
        )

    async def get_by_season(
        self,
        season: Literal["WINTER", "SPRING", "SUMMER", "FALL"],
        year: int,
        limit: int = 50,
        sort: MediaSort = MediaSort.POPULARITY,
    ) -> List[dict]:
        return await self._fetch_paginated(
            variables={"season": season, "year": year, "sort": [sort.value]},
            include_season=True,
            limit=limit,
        )

    async def close(self):
        try:
            await self.client.aclose()
        except RuntimeError as e:
            if "Event loop is closed" not in str(e):
                raise


class Command(BaseCommand):
    help = "Import anime data from AniList API"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit", type=int, default=50, help="Number of anime to import"
        )
        parser.add_argument(
            "--season",
            type=str,
            choices=["WINTER", "SPRING", "SUMMER", "FALL"],
            help="Import specific season",
        )
        parser.add_argument("--year", type=int, help="Year for seasonal import")
        parser.add_argument(
            "--sort",
            type=str,
            default="POPULARITY",
            choices=["POPULARITY", "SCORE", "TRENDING", "START_DATE"],
            help="Sort method",
        )
        parser.add_argument(
            "--create-fixtures",
            action="store_true",
            help="Create JSON fixtures instead of importing to database",
        )
        parser.add_argument(
            "--update", action="store_true", help="Update existing anime if found"
        )
        parser.add_argument(
            "--skip-images", action="store_true", help="Skip downloading images"
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        sort = MediaSort[options["sort"]]
        create_fixtures = options["create_fixtures"]
        update_existing = options["update"]
        self.skip_images = options["skip_images"]
        self.stdout.write(
            self.style.NOTICE(f"Starting anime import (limit: {limit})...")
        )
        anime_data = asyncio.run(self._scrape_data(options, limit, sort))
        if not anime_data:
            self.stdout.write(self.style.ERROR("No data retrieved"))
            return
        if create_fixtures:
            self._create_fixtures(anime_data)
        else:
            asyncio.run(self._import_to_database_async(anime_data, update_existing))

    async def _scrape_data(self, options, limit, sort):
        scraper = AniListScraper()
        self.scraper = scraper
        try:
            if options["season"] and options["year"]:
                self.stdout.write(
                    f"Fetching {options['season']} {options['year']} anime..."
                )
                data = await scraper.get_by_season(
                    options["season"], options["year"], limit, sort
                )
            else:
                self.stdout.write("Fetching top anime...")
                data = await scraper.get_anime(limit, sort)
            return data
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Scraping error: {e}"))
            await scraper.close()
            return []

    async def _import_to_database_async(self, anime_data, update_existing):
        created_count = 0
        updated_count = 0
        skipped_count = 0
        for item in anime_data:
            try:
                title_romaji = item.get("title", {}).get("romaji", "")
                title_english = item.get("title", {}).get("english", "")
                title_native = item.get("title", {}).get("native", "")
                title = title_english or title_romaji
                slug = slugify(title)
                anime_data_dict = self._prepare_anime_data(
                    item, title, title_native, slug
                )
                anime, created = await self._get_or_create_anime(slug, anime_data_dict)
                if not created and update_existing:
                    await self._update_anime(anime, anime_data_dict)
                    updated_count += 1
                    self.stdout.write(self.style.WARNING(f"Updated: {title}"))
                elif created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"Created: {title}"))
                else:
                    skipped_count += 1
                    continue
                if created or update_existing:
                    await self._handle_relationships_async(anime, item)
                    if not self.skip_images:
                        await self._download_and_save_images(anime, item)
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(
                        f"Error importing {item.get('title', {})}: {str(e)}"
                    )
                )
        await self.scraper.close()
        self.stdout.write(self.style.SUCCESS(f"\n=== Import Summary ==="))
        self.stdout.write(f"Created: {created_count}")
        self.stdout.write(f"Updated: {updated_count}")
        self.stdout.write(f"Skipped: {skipped_count}")

    @sync_to_async
    def _get_or_create_anime(self, slug, anime_data_dict):
        return Anime.objects.get_or_create(slug=slug, defaults=anime_data_dict)

    @sync_to_async
    def _update_anime(self, anime, anime_data_dict):
        for key, value in anime_data_dict.items():
            setattr(anime, key, value)
        anime.save()

    async def _download_and_save_images(self, anime, item):
        try:
            cover_url = item.get("coverImage", {}).get("extraLarge") or item.get(
                "coverImage", {}
            ).get("large")
            banner_url = item.get("bannerImage")
            has_cover = await sync_to_async(lambda: bool(anime.cover_image))()
            has_banner = await sync_to_async(lambda: bool(anime.banner_image))()
            has_trailer = await sync_to_async(lambda: bool(anime.trailer_url))()
            if cover_url and not has_cover:
                self.stdout.write(f"  Downloading cover for {anime.title}...")
                cover_data = await self.scraper.download_image(cover_url)
                if cover_data:
                    filename = f"{anime.slug}_cover.jpg"
                    await self._save_image(anime, "cover_image", filename, cover_data)
                    self.stdout.write(self.style.SUCCESS(f"  ✓ Cover downloaded"))
            if banner_url and not has_banner:
                self.stdout.write(f"  Downloading banner for {anime.title}...")
                banner_data = await self.scraper.download_image(banner_url)
                if banner_data:
                    filename = f"{anime.slug}_banner.jpg"
                    await self._save_image(anime, "banner_image", filename, banner_data)
                    self.stdout.write(self.style.SUCCESS(f"  ✓ Banner downloaded"))
            if not has_trailer:
                trailer = item.get("trailer")
                if trailer:
                    trailer_id = trailer.get("id")
                    trailer_site = trailer.get("site")
                    if trailer_id and trailer_site:
                        trailer_url = None
                        if trailer_site.lower() == "youtube":
                            trailer_url = (
                                f"https://www.youtube.com/watch?v={trailer_id}"
                            )
                        elif trailer_site.lower() == "dailymotion":
                            trailer_url = (
                                f"https://www.dailymotion.com/video/{trailer_id}"
                            )
                        if trailer_url:
                            await self._save_trailer_url(anime, trailer_url)
                            self.stdout.write(
                                self.style.SUCCESS(f"  ✓ Trailer URL saved")
                            )
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"  Error downloading media: {str(e)}"))

    @sync_to_async
    def _save_image(self, anime, field_name, filename, image_data):
        field = getattr(anime, field_name)
        field.save(filename, ContentFile(image_data), save=True)

        # Queue thumbnail generation asynchronously to avoid blocking import
        # This runs in the background via Celery
        from apps.anime.tasks import generate_image_thumbnails

        generate_image_thumbnails.delay(anime.id)

    @sync_to_async
    def _save_trailer_url(self, anime, trailer_url):
        anime.trailer_url = trailer_url
        anime.save()

    @sync_to_async
    def _handle_relationships_async(self, anime, item):
        genres = item.get("genres", [])
        for genre_name in genres:
            genre, _ = Genre.objects.get_or_create(
                name=genre_name, defaults={"slug": slugify(genre_name)}
            )
            anime.genres.add(genre)
        studios = item.get("studios", {}).get("nodes", [])
        if studios and len(studios) > 0:
            studio_name = studios[0].get("name")
            if studio_name:
                studio, _ = Studio.objects.get_or_create(name=studio_name)
                anime.studio = studio
                anime.save()

    def _prepare_anime_data(self, item, title, title_native, slug):
        format_map = {
            "TV": AnimeType.tv,
            "TV_SHORT": AnimeType.tv,
            "MOVIE": AnimeType.movie,
            "OVA": AnimeType.ova,
            "ONA": AnimeType.special,
            "SPECIAL": AnimeType.special,
            "MUSIC": AnimeType.special,
        }
        anime_type = format_map.get(item.get("format", "TV"), AnimeType.tv)
        status_map = {
            "RELEASING": AnimeStatus.airing,
            "FINISHED": AnimeStatus.finished,
            "NOT_YET_RELEASED": AnimeStatus.upcoming,
            "CANCELLED": AnimeStatus.finished,
        }
        status = status_map.get(item.get("status", "FINISHED"), AnimeStatus.finished)
        start_date = self._parse_date(item.get("startDate", {}))
        end_date = self._parse_date(item.get("endDate", {}))
        avg_score = item.get("averageScore", 0)
        rating = round(avg_score / 10, 1) if avg_score else None
        description = item.get("description", "")
        if description:
            import re

            description = re.sub(r"<[^>]+>", "", description)
            description = description.strip()
        return {
            "title": title,
            "title_jp": title_native or "",
            "slug": slug,
            "synopsis": description or "No description available.",
            "anime_type": anime_type,
            "status": status,
            "episode_count": item.get("episodes", 0) or 0,
            "duration_minutes": item.get("duration", 24) or 24,
            "release_date": start_date,
            "end_date": end_date,
            "rating": rating,
            "meta_description": (description[:157] + "...")
            if description and len(description) > 160
            else description,
        }

    def _parse_date(self, date_obj):
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
        fixtures = []
        anime_id = 1
        genre_id = 1
        studio_id = 1
        genres_map = {}
        studios_map = {}
        for item in anime_data:
            try:
                title_romaji = item.get("title", {}).get("romaji", "")
                title_english = item.get("title", {}).get("english", "")
                title_native = item.get("title", {}).get("native", "")
                title = title_english or title_romaji
                genre_ids = []
                for genre_name in item.get("genres", []):
                    if genre_name not in genres_map:
                        genres_map[genre_name] = genre_id
                        fixtures.append(
                            {
                                "model": "anime.genre",
                                "pk": genre_id,
                                "fields": {
                                    "name": genre_name,
                                    "slug": slugify(genre_name),
                                    "description": "",
                                },
                            }
                        )
                        genre_id += 1
                    genre_ids.append(genres_map[genre_name])
                studio_pk = None
                studios = item.get("studios", {}).get("nodes", [])
                if studios and len(studios) > 0:
                    studio_name = studios[0].get("name")
                    if studio_name and studio_name not in studios_map:
                        studios_map[studio_name] = studio_id
                        fixtures.append(
                            {
                                "model": "anime.studio",
                                "pk": studio_id,
                                "fields": {
                                    "name": studio_name,
                                    "founded_date": None,
                                    "website": "",
                                },
                            }
                        )
                        studio_pk = studio_id
                        studio_id += 1
                    elif studio_name:
                        studio_pk = studios_map[studio_name]
                anime_data_dict = self._prepare_anime_data(
                    item, title, title_native, slugify(title)
                )
                if anime_data_dict.get("release_date"):
                    anime_data_dict["release_date"] = str(
                        anime_data_dict["release_date"]
                    )
                if anime_data_dict.get("end_date"):
                    anime_data_dict["end_date"] = str(anime_data_dict["end_date"])
                trailer_url = ""
                trailer = item.get("trailer")
                if trailer:
                    trailer_id = trailer.get("id")
                    trailer_site = trailer.get("site")
                    if trailer_id and trailer_site:
                        if trailer_site.lower() == "youtube":
                            trailer_url = (
                                f"https://www.youtube.com/watch?v={trailer_id}"
                            )
                        elif trailer_site.lower() == "dailymotion":
                            trailer_url = (
                                f"https://www.dailymotion.com/video/{trailer_id}"
                            )
                anime_fixture = {
                    "model": "anime.anime",
                    "pk": anime_id,
                    "fields": {
                        **anime_data_dict,
                        "cover_image": "",
                        "banner_image": "",
                        "trailer_url": trailer_url,
                        "studio": studio_pk,
                        "genres": genre_ids,
                    },
                }
                fixtures.append(anime_fixture)
                anime_id += 1
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"Error creating fixture: {str(e)}"))
        output_path = "anime/fixtures/anime_data.json"
        os.makedirs("anime/fixtures", exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(fixtures, f, indent=2, ensure_ascii=False)
        self.stdout.write(self.style.SUCCESS(f"\n✓ Fixtures created: {output_path}"))
        self.stdout.write(f"Total anime: {anime_id - 1}")
        self.stdout.write(f"Total genres: {genre_id - 1}")
        self.stdout.write(f"Total studios: {studio_id - 1}")
        self.stdout.write(f"\nLoad with: python manage.py loaddata anime_data.json")
