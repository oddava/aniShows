"""``AniListService``: the GraphQL client and persistence as one provider."""

from collections.abc import Iterable
from typing import Literal

from ....models import Anime
from . import mapper
from .client import AniListClient
from .persistence import AniListPersistence


class AniListService(AniListPersistence, AniListClient):
    """AniList provider: fetch (``AniListClient``), map (``mapper``), save (``AniListPersistence``)."""

    def __init__(
        self,
        enable_caching: bool = True,
        enable_rate_limiting: bool = True,
        *,
        request_budget: Literal["default", "interactive"] = "default",
    ):
        super().__init__(
            enable_caching=enable_caching,
            enable_rate_limiting=enable_rate_limiting,
            request_budget=request_budget,
        )
        # Airing payloads fetched in bulk by ``prefetch_airing``, by ("anilist"|"mal", id).
        self._airing_payloads: dict[tuple[str, int], dict] = {}

    def resolve_media_for_anime(self, anime: Anime) -> dict | None:
        """Resolve the safest AniList media payload for an existing Anime row.

        By AniList ID, then MAL ID; a title search is the last resort, and for
        a row without IDs it only accepts one candidate from about the same
        year, since the winner's data overwrites the row (remakes and reboots
        share titles: "Hunter x Hunter" 1999 and 2011).
        """
        if anime.anilist_id:
            item = self.get_anime_by_id(anime.anilist_id)
            if item:
                return item

        if anime.mal_id:
            item = self.search_by_mal_id(anime.mal_id)
            if item:
                return item

        if self.last_error_code in {"rate_limited", "transport_error"}:
            # Not "unknown to AniList": a title search would just fail the same way.
            return None

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

        matches = []
        for candidate in results:
            # If local IDs exist, never accept candidates with mismatched identity.
            if anime.anilist_id and candidate.get("id") != anime.anilist_id:
                continue
            if anime.mal_id and candidate.get("idMal") != anime.mal_id:
                continue
            if expected_titles.intersection(mapper.titles_casefolded(candidate)):
                matches.append(candidate)

        if not (anime.anilist_id or anime.mal_id):
            matches = [c for c in matches if self._release_years_compatible(anime, c)]
            if len(matches) > 1:
                self._set_last_error("not_found", f"ambiguous_title:{title}")
                return None

        if matches:
            return matches[0]

        if anime.anilist_id or anime.mal_id:
            for candidate in results:
                if anime.anilist_id and candidate.get("id") == anime.anilist_id:
                    return candidate
                if anime.mal_id and candidate.get("idMal") == anime.mal_id:
                    return candidate

        self._set_last_error("not_found", f"title:{title}")
        return None

    @staticmethod
    def _release_years_compatible(anime: Anime, candidate: dict) -> bool:
        anime_year = anime.season_year or (anime.release_date.year if anime.release_date else None)
        candidate_year = candidate.get("seasonYear") or (candidate.get("startDate") or {}).get(
            "year"
        )
        if not anime_year or not candidate_year:
            return True
        return abs(int(anime_year) - int(candidate_year)) <= 1

    def prefetch_airing(self, animes: Iterable[Anime]) -> int:
        """Fetch airing payloads for many rows at once (50 per request).

        ``resolve_airing_media_for_anime`` then answers from these, so a refresh
        of every airing show costs a few requests instead of one per show.
        Returns how many payloads were fetched.
        """
        animes = list(animes)
        anilist_ids = [anime.anilist_id for anime in animes if anime.anilist_id]
        mal_ids = [anime.mal_id for anime in animes if not anime.anilist_id and anime.mal_id]
        payloads = self.get_airing_by_ids(anilist_ids=anilist_ids, mal_ids=mal_ids)
        for payload in payloads:
            if payload.get("id"):
                self._airing_payloads[("anilist", payload["id"])] = payload
            if payload.get("idMal"):
                self._airing_payloads.setdefault(("mal", payload["idMal"]), payload)
        return len(payloads)

    def resolve_airing_media_for_anime(self, anime: Anime) -> dict | None:
        """The airing payload for a row: prefetched, else fetched, else a full resolve."""
        for kind, value in (("anilist", anime.anilist_id), ("mal", anime.mal_id)):
            if value and (kind, value) in self._airing_payloads:
                return self._airing_payloads[(kind, value)]

        if anime.anilist_id or anime.mal_id:
            item = self.get_airing_anime(anilist_id=anime.anilist_id, mal_id=anime.mal_id)
            if item:
                return item
            if self.last_error_code in {"rate_limited", "transport_error"}:
                return None

        return self.resolve_media_for_anime(anime)
