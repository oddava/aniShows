"""``AniListService``: the GraphQL client and persistence as one provider."""

from ....models import Anime
from . import mapper
from .client import AniListClient
from .persistence import AniListPersistence


class AniListService(AniListPersistence, AniListClient):
    """AniList provider: fetch (``AniListClient``), map (``mapper``), save (``AniListPersistence``)."""

    def resolve_media_for_anime(self, anime: Anime) -> dict | None:
        """Resolve the safest AniList media payload for an existing Anime row."""
        if anime.anilist_id:
            item = self.get_anime_by_id(anime.anilist_id)
            if item:
                return item

        if anime.mal_id:
            item = self.search_by_mal_id(anime.mal_id)
            if item:
                return item

        title = (anime.title or "").strip()
        if not title:
            if not self.last_error_code:
                self._set_last_error("not_found", "missing_title")
            return None

        results = self.search_anime(title)
        if not results:
            if not self.last_error_code:
                self._set_last_error("not_found", f"title:{title}")
            return None

        expected_titles = {title.casefold()}
        if anime.title_jp:
            expected_titles.add(anime.title_jp.casefold())

        for candidate in results:
            # If local IDs exist, never accept candidates with mismatched identity.
            if anime.anilist_id and candidate.get("id") != anime.anilist_id:
                continue
            if anime.mal_id and candidate.get("idMal") != anime.mal_id:
                continue
            if expected_titles.intersection(mapper.titles_casefolded(candidate)):
                return candidate

        if anime.anilist_id or anime.mal_id:
            for candidate in results:
                if anime.anilist_id and candidate.get("id") == anime.anilist_id:
                    return candidate
                if anime.mal_id and candidate.get("idMal") == anime.mal_id:
                    return candidate

        self._set_last_error("not_found", f"title:{title}")
        return None
