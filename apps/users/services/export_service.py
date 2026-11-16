"""Export a user's data: everything as JSON, or the anime list as a MAL-compatible XML file."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from xml.sax.saxutils import escape

from django.contrib.auth import get_user_model
from django.utils import timezone

from ..models import UserAnimeList, UserProfile

User = get_user_model()

EXPORT_VERSION = "2"
MAL_STATUS = {
    UserAnimeList.UserAnimeStatus.watching: "Watching",
    UserAnimeList.UserAnimeStatus.completed: "Completed",
    UserAnimeList.UserAnimeStatus.on_hold: "On-Hold",
    UserAnimeList.UserAnimeStatus.dropped: "Dropped",
    UserAnimeList.UserAnimeStatus.plan_to_watch: "Plan to Watch",
}


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _anime_ref(anime) -> dict[str, Any]:
    return {
        "id": anime.id,
        "title": anime.title,
        "slug": anime.slug,
        "mal_id": anime.mal_id,
        "anilist_id": anime.anilist_id,
    }


class UserDataExporter:
    """Every piece of data the user owns, as one JSON-ready dict."""

    def __init__(self, user):
        self.user = user

    def export(self) -> dict[str, Any]:
        return {
            "export_metadata": {
                "version": EXPORT_VERSION,
                "exported_at": timezone.now().isoformat(),
                "username": self.user.username,
                "email": self.user.email,
            },
            "profile": self._export_profile(),
            "anime_list": self._export_anime_list(),
            "episode_ratings": self._export_episode_ratings(),
            "favorites": self._export_favorites(),
            "character_favorites": self._export_character_favorites(),
            "staff_favorites": self._export_staff_favorites(),
            "following": self._export_following(),
            "reviews": self._export_reviews(),
        }

    def export_json(self) -> str:
        return json.dumps(self.export(), indent=2, default=str)

    def _export_profile(self) -> dict[str, Any]:
        try:
            profile = self.user.userprofile
        except UserProfile.DoesNotExist:
            return {}
        return {
            "bio": profile.bio,
            "is_private": profile.is_private,
            "social_links": profile.social_links,
            "email_verified": profile.email_verified,
        }

    def _export_anime_list(self) -> list[dict[str, Any]]:
        return [
            {
                "anime": _anime_ref(entry.anime),
                "status": entry.status,
                "score": entry.score,
                "episodes_watched": entry.episodes_watched,
                "notes": entry.notes,
                "started_at": _iso(entry.started_at),
                "finished_at": _iso(entry.finished_at),
                "total_rewatches": entry.total_rewatches,
                "is_rewatching": entry.is_rewatching,
                "updated_at": _iso(entry.updated_at),
            }
            for entry in self.user.anime_lists.select_related("anime").order_by("id")
        ]

    def _export_episode_ratings(self) -> list[dict[str, Any]]:
        return [
            {
                "anime": _anime_ref(rating.anime),
                "episode_number": rating.episode_number,
                "rating": str(rating.rating),
                "updated_at": _iso(rating.updated_at),
            }
            for rating in self.user.episode_ratings.select_related("anime").order_by(
                "anime_id", "episode_number"
            )
        ]

    def _export_favorites(self) -> list[dict[str, Any]]:
        return [
            {"anime": _anime_ref(fav.anime), "added_at": _iso(fav.added_at), "order": fav.order}
            for fav in self.user.favorites.select_related("anime").all()
        ]

    def _export_character_favorites(self) -> list[dict[str, Any]]:
        return [
            {
                "character": {"name": fav.character.name, "anilist_id": fav.character.anilist_id},
                "added_at": _iso(fav.added_at),
            }
            for fav in self.user.favorite_characters.select_related("character")
        ]

    def _export_staff_favorites(self) -> list[dict[str, Any]]:
        return [
            {
                "staff": {"name": fav.staff.name, "anilist_id": fav.staff.anilist_id},
                "added_at": _iso(fav.added_at),
            }
            for fav in self.user.favorite_staff.select_related("staff")
        ]

    def _export_following(self) -> list[str]:
        return list(
            self.user.following.order_by("following__username").values_list(
                "following__username", flat=True
            )
        )

    def _export_reviews(self) -> list[dict[str, Any]]:
        return [
            {
                "anime": _anime_ref(review.anime),
                "rating": review.rating,
                "rating_story": review.rating_story,
                "rating_animation": review.rating_animation,
                "rating_music": review.rating_music,
                "rating_characters": review.rating_characters,
                "text": review.text,
                "has_spoilers": review.has_spoilers,
                "created_at": _iso(review.created_at),
                "updated_at": _iso(review.updated_at),
            }
            for review in self.user.reviews.select_related("anime").all()
        ]


def _cdata(text: str) -> str:
    """A CDATA section that stays valid whatever the text holds (``]]>`` is split)."""
    return "<![CDATA[" + (text or "").replace("]]>", "]]]]><![CDATA[>") + "]]>"


def _mal_date(value) -> str:
    return value.isoformat() if value else "0000-00-00"


class MALXMLExporter:
    """The anime list as a MyAnimeList export file, re-importable here and on MAL.

    Entries without a MAL id cannot be imported anywhere by id, so they are left out;
    ``skipped`` says how many, and the file says so in a comment.
    """

    def __init__(self, user):
        self.user = user
        self.skipped = 0

    def export(self) -> str:
        entries = list(self.user.anime_lists.select_related("anime").order_by("id"))
        exportable = [entry for entry in entries if entry.anime.mal_id]
        self.skipped = len(entries) - len(exportable)

        parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            "<myanimelist>",
            "  <myinfo>",
            f"    <user_id>{self.user.id}</user_id>",
            f"    <user_name>{escape(self.user.username)}</user_name>",
            "    <user_export_type>1</user_export_type>",
            f"    <user_total_anime>{len(exportable)}</user_total_anime>",
            "  </myinfo>",
        ]
        if self.skipped:
            parts.append(
                f"  <!-- {self.skipped} entries without a MyAnimeList id were not exported -->"
            )
        parts.extend(self._format_entry(entry) for entry in exportable)
        parts.append("</myanimelist>")
        return "\n".join(parts)

    def _format_entry(self, entry: UserAnimeList) -> str:
        anime = entry.anime
        lines = [
            "  <anime>",
            f"    <series_animedb_id>{anime.mal_id}</series_animedb_id>",
            f"    <series_title>{_cdata(anime.title)}</series_title>",
            f"    <series_type>{escape(anime.anime_type or '')}</series_type>",
            f"    <series_episodes>{anime.episode_count}</series_episodes>",
            "    <my_id>0</my_id>",
            f"    <my_watched_episodes>{entry.episodes_watched}</my_watched_episodes>",
            f"    <my_start_date>{_mal_date(entry.started_at)}</my_start_date>",
            f"    <my_finish_date>{_mal_date(entry.finished_at)}</my_finish_date>",
            "    <my_rated></my_rated>",
            f"    <my_score>{entry.score}</my_score>",
            "    <my_storage_value>0.00</my_storage_value>",
            f"    <my_status>{MAL_STATUS.get(entry.status, 'Plan to Watch')}</my_status>",
            f"    <my_comments>{_cdata(entry.notes)}</my_comments>",
            f"    <my_times_watched>{entry.total_rewatches}</my_times_watched>",
            "    <my_rewatch_value></my_rewatch_value>",
            "    <my_priority>Low</my_priority>",
            "    <my_tags></my_tags>",
            f"    <my_rewatching>{1 if entry.is_rewatching else 0}</my_rewatching>",
            "    <my_rewatching_ep>0</my_rewatching_ep>",
            "    <my_discuss>0</my_discuss>",
            "    <my_sns>default</my_sns>",
            "    <update_on_import>1</update_on_import>",
            "  </anime>",
        ]
        return "\n".join(lines)


@dataclass(slots=True)
class ExportFile:
    content: str
    content_type: str
    filename: str
    skipped: int = 0


class ExportService:
    """Entry points for the export view."""

    @staticmethod
    def export_user_data_object(user) -> dict[str, Any]:
        """The JSON export as a dict (``download=false`` previews it)."""
        return UserDataExporter(user).export()

    @staticmethod
    def export_user_data(user, format: str = "json") -> str:
        """The export as text: JSON, or MAL XML."""
        return ExportService.export_file(user, format).content

    @staticmethod
    def export_file(user, format: str) -> ExportFile:
        if format == "json":
            content, content_type, skipped = (
                UserDataExporter(user).export_json(),
                "application/json",
                0,
            )
        elif format == "xml":
            exporter = MALXMLExporter(user)
            content, content_type, skipped = exporter.export(), "application/xml", exporter.skipped
        else:
            raise ValueError(f"Unsupported export format: {format}")
        return ExportFile(
            content=content,
            content_type=content_type,
            filename=ExportService.get_export_filename(user, format),
            skipped=skipped,
        )

    @staticmethod
    def get_export_filename(user, format: str) -> str:
        timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
        return f"anishows_export_{user.username}_{timestamp}.{format}"
