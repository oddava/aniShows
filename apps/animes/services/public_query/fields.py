"""Field lists and prefetches shared by the public anime querysets."""

from django.db.models import Count, IntegerField, OuterRef, Prefetch, Subquery

from ....users.models import UserAnimeList
from ...models import Genre, ThemeSong


class QueryFieldsMixin:
    DETAIL_DEFER_FIELDS = (
        "offline_db_payload",
        "provider_ids",
        "source_urls",
        "synonyms",
        "producers",
        "meta_description",
    )
    ACTION_ANIME_ONLY_FIELDS = (
        "id",
        "slug",
        "title",
        "episode_count",
        "updated_at",
        "mal_id",
        "anilist_id",
    )
    LIST_FIELDS = (
        "id",
        "title",
        "title_jp",
        "slug",
        "cover_image",
        "cover_image_external_url",
        "rating",
        "episode_count",
        "anime_type",
        "status",
        "release_date",
        "broadcast_day",
        "broadcast_time",
        "broadcast_timezone",
        "next_airing_episode",
        "next_airing_date",
    )
    SHELF_FIELDS = (
        *LIST_FIELDS,
        "synopsis",
        "banner_image",
        "banner_image_external_url",
    )
    GENRE_FIELDS = ("id", "name", "slug")
    THEME_SONG_FIELDS = (
        "id",
        "anime_id",
        "song_type",
        "track_number",
        "title",
        "artist",
        "episodes",
        "spotify_url",
        "youtube_url",
    )
    USER_LIST_FIELDS = (
        "id",
        "anime_id",
        "status",
        "score",
        "episodes_watched",
        "notes",
        "started_at",
        "finished_at",
        "total_rewatches",
        "is_rewatching",
    )

    @classmethod
    def _genre_prefetch(cls) -> Prefetch:
        return Prefetch(
            "genres",
            queryset=Genre.objects.only(*cls.GENRE_FIELDS).order_by("name"),
        )

    @classmethod
    def _theme_song_prefetch(cls) -> Prefetch:
        return Prefetch(
            "theme_songs",
            # Detail payloads only expose a small slice of theme-song fields.
            queryset=ThemeSong.objects.only(*cls.THEME_SONG_FIELDS).order_by(
                "song_type", "track_number"
            ),
        )

    @classmethod
    def _user_list_prefetch(cls, user) -> Prefetch:
        return Prefetch(
            "user_lists",
            # Keeping this narrow prevents browse pages from pulling the whole list table into memory.
            queryset=UserAnimeList.objects.filter(user=user).only(*cls.USER_LIST_FIELDS),
            to_attr="_user_list_entries",
        )

    @staticmethod
    def _count_subquery(model, anime_field: str = "anime_id") -> Subquery:
        queryset = (
            model.objects.filter(**{anime_field: OuterRef("pk")})
            .order_by()
            .values(anime_field)
            .annotate(total=Count("id"))
            .values("total")[:1]
        )
        return Subquery(queryset, output_field=IntegerField())
