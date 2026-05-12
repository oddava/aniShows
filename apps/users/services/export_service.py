"""Export service for user data."""

import json
from datetime import datetime
from typing import Any, Dict

from django.contrib.auth import get_user_model

from ..models import UserAnimeList, UserProfile

User = get_user_model()

class UserDataExporter:
    """Export all user data in a structured format"""

    def __init__(self, user: User):
        self.user = user

    def export(self) -> Dict[str, Any]:
        """Export all user data"""
        return {
            "export_metadata": {
                "version": "1.0",
                "exported_at": datetime.now().isoformat(),
                "username": self.user.username,
                "email": self.user.email,
            },
            "profile": self._export_profile(),
            "anime_list": self._export_anime_list(),
            "favorites": self._export_favorites(),
            "reviews": self._export_reviews(),
        }

    def export_json(self) -> str:
        """Export user data as JSON string"""
        data = self.export()
        return json.dumps(data, indent=2, default=str)

    def _export_profile(self) -> Dict[str, Any]:
        """Export user profile data"""
        try:
            profile = self.user.userprofile
            return {
                "bio": profile.bio,
                "is_private": profile.is_private,
                "social_links": profile.social_links,
                "email_verified": profile.email_verified,
            }
        except UserProfile.DoesNotExist:
            return {}

    def _export_anime_list(self) -> list:
        """Export user's anime list"""
        entries = []

        for entry in self.user.anime_lists.select_related("anime").all():
            entries.append(
                {
                    "anime": {
                        "id": entry.anime.id,
                        "title": entry.anime.title,
                        "slug": entry.anime.slug,
                        "mal_id": entry.anime.mal_id,
                        "anilist_id": entry.anime.anilist_id,
                    },
                    "status": entry.status,
                    "score": entry.score,
                    "episodes_watched": entry.episodes_watched,
                    "notes": entry.notes,
                    "started_at": entry.started_at.isoformat() if entry.started_at else None,
                    "finished_at": entry.finished_at.isoformat() if entry.finished_at else None,
                    "total_rewatches": entry.total_rewatches,
                    "is_rewatching": entry.is_rewatching,
                    "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
                }
            )

        return entries

    def _export_favorites(self) -> list:
        """Export user's favorites"""
        favorites = []

        for fav in self.user.favorites.select_related("anime").all():
            favorites.append(
                {
                    "anime": {
                        "id": fav.anime.id,
                        "title": fav.anime.title,
                        "slug": fav.anime.slug,
                        "mal_id": fav.anime.mal_id,
                        "anilist_id": fav.anime.anilist_id,
                    },
                    "added_at": fav.added_at.isoformat() if fav.added_at else None,
                    "order": fav.order,
                }
            )

        return favorites

    def _export_reviews(self) -> list:
        """Export user's reviews"""
        reviews = []

        for review in self.user.reviews.select_related("anime").all():
            reviews.append(
                {
                    "anime": {
                        "id": review.anime.id,
                        "title": review.anime.title,
                        "slug": review.anime.slug,
                        "mal_id": review.anime.mal_id,
                        "anilist_id": review.anime.anilist_id,
                    },
                    "rating": review.rating,
                    "rating_story": review.rating_story,
                    "rating_animation": review.rating_animation,
                    "rating_music": review.rating_music,
                    "rating_characters": review.rating_characters,
                    "text": review.text,
                    "has_spoilers": review.has_spoilers,
                    "created_at": review.created_at.isoformat() if review.created_at else None,
                    "updated_at": review.updated_at.isoformat() if review.updated_at else None,
                }
            )

        return reviews

class MALXMLExporter:
    """Export user anime list to MyAnimeList XML format"""

    def __init__(self, user: User):
        self.user = user

    def export(self) -> str:
        """Export anime list as MAL-compatible XML"""
        entries = list(self.user.anime_lists.select_related("anime").all())

        # Build XML
        xml_parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            "<myanimelist>",
            "  <myinfo>",
            f"    <user_id>{self.user.id}</user_id>",
            f"    <user_name>{self.user.username}</user_name>",
            "    <user_export_type>1</user_export_type>",
            f"    <user_total_anime>{len(entries)}</user_total_anime>",
            "  </myinfo>",
        ]

        for entry in entries:
            xml_parts.append(self._format_entry(entry))

        xml_parts.append("</myanimelist>")

        return "\n".join(xml_parts)

    def _format_entry(self, entry: UserAnimeList) -> str:
        """Format a single entry as XML"""
        # Map status back to MAL format
        status_map = {
            UserAnimeList.UserAnimeStatus.watching: "Watching",
            UserAnimeList.UserAnimeStatus.completed: "Completed",
            UserAnimeList.UserAnimeStatus.on_hold: "On-Hold",
            UserAnimeList.UserAnimeStatus.dropped: "Dropped",
            UserAnimeList.UserAnimeStatus.plan_to_watch: "Plan to Watch",
        }

        mal_status = status_map.get(entry.status, "Plan to Watch")

        lines = [
            "  <anime>",
            f"    <series_animedb_id>{entry.anime.mal_id or 0}</series_animedb_id>",
            f"    <series_title><![CDATA[{entry.anime.title}]]></series_title>",
            f"    <series_type>{entry.anime.anime_type}</series_type>",
            f"    <series_episodes>{entry.anime.episode_count}</series_episodes>",
            "    <my_id>0</my_id>",
            f"    <my_watched_episodes>{entry.episodes_watched}</my_watched_episodes>",
            "    <my_start_date>0000-00-00</my_start_date>",
            "    <my_finish_date>0000-00-00</my_finish_date>",
            "    <my_rated></my_rated>",
            f"    <my_score>{entry.score}</my_score>",
            "    <my_storage_value>0.00</my_storage_value>",
            f"    <my_status>{mal_status}</my_status>",
            "    <my_comments></my_comments>",
            "    <my_times_watched>0</my_times_watched>",
            "    <my_rewatch_value></my_rewatch_value>",
            "    <my_priority>Low</my_priority>",
            "    <my_tags></my_tags>",
            "    <my_rewatching>0</my_rewatching>",
            "    <my_rewatching_ep>0</my_rewatching_ep>",
            "    <my_discuss>0</my_discuss>",
            "    <my_sns>default</my_sns>",
            "    <update_on_import>1</update_on_import>",
            "  </anime>",
        ]

        return "\n".join(lines)

class ExportService:
    """Service for handling all export operations"""

    @staticmethod
    def export_user_data(user: User, format: str = "json") -> str:
        """
        Export user data in specified format

        Args:
            user: The user to export data for
            format: Export format ("json", "xml")

        Returns:
            Exported data as string
        """
        if format == "json":
            exporter = UserDataExporter(user)
            return exporter.export_json()
        elif format == "xml":
            exporter = MALXMLExporter(user)
            return exporter.export()
        else:
            raise ValueError(f"Unsupported export format: {format}")

    @staticmethod
    def get_export_filename(user: User, format: str) -> str:
        """Generate export filename"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"anishows_export_{user.username}_{timestamp}.{format}"
