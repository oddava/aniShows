# Feature revamp 2: Browse & discover
> Base: backend fix/anilist-only-and-fixes@17f082a, frontend feat/visual-ux-overhaul@ab5b3c2. Planning only.

Path prefixes: `SLIM/` = backend snapshot (`.../scratchpad/slim`), `WT/` = this worktree. Backend paths are `SLIM/apps/...` unless noted; frontend paths are `WT/frontend/src/...`.

## Summary
This group owns the public read path: Home shelves, Browse (filters, sort, view modes, URL state), search, the anime detail page and its tabs, character and staff pages, Schedule, personalised recommendations, the shared public cache and pagination, adult-content filtering on reads, and SEO for these pages.
The slim-down moved search to Postgres trigram with relevance ordering. The visuals branch gave the UI its polish. A few things fell through between the two:
1. Browse always sends `sort=popular`, so search results there are never ranked by relevance.
2. One user's list change clears every collection cache on the site.
3. Recommendations can include adult titles for users who did not opt in, and titles a user dismissed come back the next day.
4. AniList status counts come out as zeros.
5. The navbar still downloads 100 titles and runs fuse.js on them in the browser.
After fixing those, the group adds four cheap daily-use features: an "Up next" shelf for members, a "My list" filter on Schedule, better no-results states, and next/previous season buttons. None of them adds a service, a model, or an AniList call.

## Current state

### Endpoints (all in `apps/animes/urls.py`, router)
| Method + path | View | Cache | Notes |
|---|---|---|---|
| GET `/api/anime/` (`q`, `genre`, `tags`, `type`, `status`, `studio`, `season`+`year`, `min/max_*`, `source`, `exclude_ids`, `shelf`, `sort`, `page`, `page_size`≤200) | `AnimeViewSet.list` views/anime.py:94 | anonymous: `cache_list_payload` 300 s; signed-in: **uncached** (anime.py:95-110) | `NoCountPagination` (`count: null`) |
| GET `/api/anime/trending/`, `/top_rated/` | anime.py:137,145 → `_get_cached_shelf` :118 | 600 s, keyed by adult flag | `AnimeShelfSerializer` |
| GET `/api/anime/browse-rows/` | anime.py:215 | 600 s | 5 rows, IDs not repeated between rows (`shelves.py:131-152`) |
| GET `/api/anime/schedule/[?day=]` | anime.py:158 | 600 s per day×adult | server groups by Tokyo weekday; the frontend regroups |
| GET `/api/anime/{slug}/` | anime.py:75 → `get_detail_payload` public_anime_service.py:371 | 3600 s, keyed by slug only | 7 legacy cache keys are read on a miss (:308-319) |
| GET `/api/anime/{slug}/related/`, `/recommendations/` | anime.py:264,288 | 600 s; degraded results kept 60 s | recommendations call AniList (`REQUEST_BUDGET_INTERACTIVE`) on a cold key |
| GET `/api/anime/{slug}/characters/`, `/staff/` | anime.py:313,344 | Cache-Control only | `LargePagination` (COUNT + page) |
| GET `/api/genres/`, `/api/studios/` | anime.py:499,517 | 3600 s | studios: the whole table, unpaginated |
| GET `/api/characters/{id}/`, `/api/staff/{id}/` | views/characters.py:8, views/staff.py:8 | none | every role, unpaginated |
| GET `/api/recommendations/?limit=`, POST `refresh/`, POST `{anime_id}/dismiss/` | views/recommendations.py:44 | per-user key `user_recommendations:{id}`, 1 h | refresh runs synchronously (:89-112) |
Not this group's contract: `watch-episodes`, `episode-ratings` (G3), `reviews` (G5), `franchise/fetch` (superuser, used by G2's FranchiseSection).

### Services, models, tasks
- `AnimeQueryService` = `QueryFieldsMixin` + `ListFilterMixin` + `SortingMixin` + `ShelfMixin` (public_anime_service.py:82; `services/public_query/{fields,filters,sorting,shelves}.py`). Search is in `filters.py:376-414`, ranking in `:345-374`, `RankedSearchResults` in `:159-196`. The `ilike` lookups are in `lookups.py`.
- `AnimePublicPayloadService` (public_anime_service.py:274): cache version `v11`, a collection namespace that is bumped on invalidation (:551-567), and per-user enrichment after the cache (:443-535, 3 queries).
- `apps/shared/public_cache.py`: a lock plus a stale copy plus `Degraded`. Waiting for another builder lasts up to `PUBLIC_API_CACHE_WAIT_TIMEOUT_MS=30000` (`root/settings/base.py:96`), polled every 25 ms (public_cache.py:108-116).
- `UserRecommendation` (models/user_data.py:118): unique (user, anime), `is_dismissed`, indexes (user,-score), (user,is_dismissed). Engine: `ContentBasedRecommender` and `RecommendationService` (services/recommendations.py).
- Celery: `apps.animes.tasks.recommendations.generate_recommendations`. Beat entry `generate-recommendations-daily` runs at 05:00 on `low_priority` with kwargs `{"limit": 10}` (`root/settings/celery_schedule.py:63-68`, snapshot `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json:77-85`). Per-user runs are triggered on a list or favourite change, debounced 300 s (`user_list_side_effects.py:225-241`, G3), and 30 s after an import (`users/services/import_service/base.py:232-236`, G3).

### Frontend
| Surface | Files | Query keys |
|---|---|---|
| Home | `pages/Home.jsx`: member hero carousel (trending), Currently Watching :487 (G3 `userQueries.watching`), Trending, Recommended :518, Top Rated | `['anime','trending',variant]`, `['anime','top-rated']`, `['recommendations']` |
| Browse | `pages/Browse.jsx`, `components/browse/*`; filters stored in the URL (`useBrowseUrlFilters.js`); infinite grid/list/minimal (`useBrowseAnimeList.js`), or `BrowseRowMode` with no filters | `animeKeys.browseList(f)`, `['anime','browse-row',adult]`, `['genres']`, `['studios']` |
| Search | `navbar/{NavbarSearch,useNavbarSearch,useFuzzySearch,SearchSuggestionList}`, `home/HeroSearch.jsx` | `['navbarSearch','cache']` (top 100), `['navbarSearch','results',q]` |
| Detail | `pages/AnimeDetail.jsx`, `components/animeDetail/*`, `DetailTabs`, `detailTabs/*`, `FranchiseSection`, `MusicSection`, `InformationBox` | `['anime',slug,viewer]` and children |
| Character / staff | `pages/CharacterDetail.jsx`, `pages/VoiceActorDetail.jsx` | `['character',id]`, `['staff',id]` |
| Schedule | `pages/Schedule.jsx`, `utils/dateUtils.js:200` | `['schedule',isAuth,adult]` |

### Tests already present
Backend: `test_query_budgets.py`, `test_public_contract.py`, `test_query_sql_snapshot.py`, `test_search_trigram.py`, `test_schedule_cache.py`, `test_public_payload_caching.py`, `test_recommendations_service.py`, `test_recommendations_view_cache.py`, `test_quarantined_public_visibility.py`, `test_browse_backend.py`, `test_relation_links.py`, `test_anime_detail_*`, `test_top_rated_endpoint.py`.
Frontend: `pages/__tests__/{Home,AnimeDetail,Schedule}.test.jsx`, `navbar/__tests__/NavbarSearch.test.jsx`, `home/__tests__/HeroSearch.test.jsx`, `browse/__tests__/BrowseFilters.test.jsx`, `browse/BrowseRowMode.test.jsx`, `DetailTabs.test.jsx`, `InformationBox.test.jsx`, `common/AnimeMediaImage.test.jsx`, `utils/{dateUtils,imageUtils,realGenres,characterRoles}.test.js`, `api/queries/__tests__/queryKeys.test.js`.

## Problems found
| ID | Sev | Area | Problem | Evidence path:line | Fix ref |
|---|---|---|---|---|---|
| B1 | High | Search | Browse search is never ranked by relevance. `currentSort` defaults to `'popular'` and is always sent, and the backend ranks by relevance only when `sort` is `""` or `relevance`. A one-word query also matches synopses, so better-known shows that only mention the word in their synopsis come before the title the user typed. | WT `components/browse/useBrowseUrlFilters.js:21`, `useBrowseAnimeList.js:82`, `browseFilterOptions.js:3-8`; SLIM `services/public_query/filters.py:136,329-342` | P0-1 |
| B2 | High | Cache | Any list-status change clears every collection cache. `update_anime_status_distribution` calls `anime.save(update_fields=["status_distribution"])`. The `post_save` receiver then bumps the global collection namespace and deletes about 40 keys. The new keys start with no stale copy, so the next readers rebuild or wait up to 30 s. Catalog sync saves fire the same receiver row by row. | `services/user_list_side_effects.py:88-90,256-258`; `signals.py:46-75,135-137`; `public_anime_service.py:559-567`; `shared/public_cache.py:108-116`; `root/settings/base.py:96` | P0-2 |
| B3 | High | Recs / adult | Personalised recommendations ignore `is_adult`. The candidate, fallback and relaxed querysets all use `Anime.public_queryset()` without the adult filter, and the read path doesn't filter either. | `services/recommendations.py:322-331,509-517,575-583,638-642`; `models/anime.py:340-342` | P0-3 |
| B4 | High | Recs data | Dismissed recommendations come back. `generate_for_user` deletes every row for the user, dismissed ones included, and candidates never exclude dismissed IDs. The next daily or on-change run shows them again. | `services/recommendations.py:611-627,695-703` | P0-3 |
| B5 | High | Security | `POST /recommendations/refresh/` rebuilds synchronously in the web worker: the whole list, up to 800 candidates and Python scoring. The only throttle is the default `user` 150/min, so one account can keep workers busy. | `views/recommendations.py:89-112`; `root/settings/base.py:521-541` (`strict_user` rate exists, unused) | P0-4 |
| B6 | High | Detail data | AniList status counts are lost. The mapper stores AniList keys (`CURRENT`, `PLANNING`, `PAUSED`…). The serializer keeps only lowercase local keys, so the payload has zeros. The local recount (G3) also overwrites AniList's numbers with site counts, and the next sync overwrites those again. | `services/providers/base.py:214-229,308` (frozen); `serializers/anime.py:366-384`; `user_list_side_effects.py:52-90`; WT `utils/statusDistribution.js:9-19` already maps the aliases | P0-5 |
| B7 | Med | Schedule | Shows are grouped by weekday, not by calendar date. A stale `next_airing_date` (last Sunday) or one more than 7 days out (hiatus) lands on the strip's next matching weekday, labelled with the wrong date. The backend doesn't limit the time window either. | WT `utils/dateUtils.js:206-223`, `pages/Schedule.jsx:202-215,272-276`; SLIM `public_anime_service.py:141-161` | P0-6 |
| B8 | Med | Search | Typing one character in the navbar fires `?q=a`. The backend ignores queries under 2 characters (`MIN_SEARCH_LENGTH`), returns the default popular page, and the dropdown shows those 10 titles as matches. | WT `navbar/useNavbarSearch.js:282,309-312`; SLIM `filters.py:131,216-219` | P1-1 |
| B9 | Med | Weight | fuse.js is now redundant. Every navbar mount fetches 100 titles with `staleTime: 0`; for members this is the uncached signed-in list path. The fuzzy matches are then merged in after the server's ranked results. The hero search already uses server results only. | WT `navbar/useNavbarSearch.js:137,146-161,333-338`, `api/queries/anime.js:217-221`, `navbar/useFuzzySearch.js`, `package.json:24`, `home/HeroSearch.jsx:32-38` | P1-1 |
| B10 | Med | Cache | Signed-in `list` requests skip the shared cache entirely, although the payload depends only on the parameters and the adult flag; user fields are added after the page. This covers Browse grids, search and the navbar for every member. | `views/anime.py:95-110`; `public_anime_service.py:341-343`; `filters.py:213-214` | P1-2 |
| B11 | Med | Security | The list cache key hashes every query parameter, unknown ones included. `?x=<random>` creates a new Redis entry (300 s, plus 900 s stale) each time. `exclude_ids` has no length limit, and neither does `page`, so a deep OFFSET is possible. | `public_anime_service.py:345-350`; `filters.py:281-284`; `shared/pagination.py:21-41` | P1-2 |
| B12 | Med | Cache | `Cache-Control: public, max-age=300` with no `Vary: Authorization`. After a guest logs in, the browser may reuse the guest response from its HTTP cache (same URL, no user fields), so cards show no In-List state for up to 5 min (unverified in a browser). | `views/anime.py:47-53` | P1-2 |
| B13 | Med | Recs | GET regenerates synchronously when recommendations are stale (>24 h) or missing. An empty result is never cached (`cached_data and`), so a user with no candidates recomputes on every request. | `services/recommendations.py:645-652`; `views/recommendations.py:62-76` | P1-3 |
| B14 | Med | Recs cost | The daily batch walks every user with any list or favourite and fully loads each list with `select_related("anime")`: whole Anime rows including `offline_db_payload` and `tags` JSON. It then loads 500+300 full candidate rows per user and re-queries the same candidate pool for each user. `limit` is ignored, and a failure retries the whole batch (`retry_policy="long"`). | `services/recommendations.py:70-74,90-94,361-390,662-693`; `tasks/recommendations.py:111-145,148-153` | P1-3 |
| B15 | Med | Character / staff | No `public_queryset()`, no adult filter, no `.only()`. `select_related("anime")` pulls full Anime rows for every role, there's no cache, and a prolific voice actor returns hundreds of roles in one payload that renders as one grid. | `views/characters.py:15-22`; `views/staff.py:17-30`; WT `pages/VoiceActorDetail.jsx:230-275` | P1-4 |
| B16 | Med | Adult | A detail page, and its related, recommendation, character and staff actions, opens by direct link for viewers who haven't opted in. The detail cache is keyed by slug and has no adult flag, and the payload has no `is_adult`. | `public_anime_service.py:371-441`; `views/anime.py:88-92`; `serializers/anime.py:270-323` | P1-5 (policy: see Risks) |
| B17 | Med | Tests | Query budgets don't cover `top_rated` (listed in `PUBLIC_ENDPOINTS` but missing from `BUDGETS`), `related`, `recommendations`, `characters`, `staff`, character/staff detail, `/recommendations/`, genres or studios. | `tests/test_query_budgets.py:36-50`; `tests/catalog_fixtures.py:38-56` | P1-6 |
| B18 | Med | Detail cost | The Overview tab fetches the 4-episode preview and also prefetches the 50-episode Watch page on every visit, which means two watch-episode requests per view. The sidebar also asks for recommendations on every view, which on a cold key is one interactive AniList call per title (crawlers render JS). | WT `animeDetail/useAnimeDetailTabData.js:48-54,79-82,117-126`; SLIM `public_anime_service.py:217-226` | P1-7 |
| B19 | Med | UX | Recommended for You has no dismiss control, so `dismiss`/`refresh` are never called from the UI. Cards can't be removed. | WT `pages/Home.jsx:518-565`; `api/modules/user.js:41-45` | P1-8 |
| B20 | Med | UX / state | A list change in AnimeCard invalidates all of `['anime']` (every grid, shelf and detail refetches) plus a key nothing reads (`seasonalKeys`). Schedule (`['schedule']`) is not refreshed, so its In-List state stays stale. | WT `components/AnimeCard.jsx:134-137`; `api/queries/anime.js:137-138` | P1-9 (G3 contract) |
| B21 | Med | SEO | The detail page writes meta through `SEOHelmet`, which mutates the DOM directly. It has no canonical, sets `og:image` to a URL that may be relative (`/media/...`), uses `meta_description`, which the payload defers and doesn't serialize, and declares `TVSeries` even for movies. Character/staff pages have no canonical or og tags and use the lowercase "aniShows" brand. NotFound is indexable, with canonical `/notFound`. | WT `components/SEOHelmet.jsx:13,34,50`, `components/SEO.jsx:66`, `pages/NotFound.jsx:7`, `pages/CharacterDetail.jsx:171-177`, `pages/VoiceActorDetail.jsx:135-138`; SLIM `public_query/fields.py:16`, `serializers_mixins.py:20-21` | P1-10 |
| B22 | Low | SEO | The static sitemap lists `/seasonal` (a redirect), `/login` and `/register`, and no title pages. Browse also sets `document.title` by hand alongside `<SEO>`. | WT `public/sitemap.xml:19,33,39`, `app/routes.jsx:102`, `pages/Browse.jsx:226,259` | P2-5 (integrator) |
| B23 | Low | Search UX | The hero search shows nothing when there are no results. Browse's no-results state offers only "Clear filters", not "search without filters". The "Exact" badge comes from fuse only. | WT `home/HeroSearch.jsx:42-43`, `browse/EmptyState.jsx:36-45`, `navbar/SearchSuggestionList.jsx:90-94` | P1-1 |
| B24 | Low | Browse | The type options lack ONA and Music, although the backend accepts them; ONA is common on AniList. `VALID_STATUSES` has `not_yet_aired`, which matches no stored value (`Airing`/`Finished`/`Upcoming`/`Unknown`). | WT `browse/browseFilterOptions.js:10-15`; SLIM `filters.py:127`, `models/anime.py:46-50` | P2-1 |
| B25 | Low | Browse cost | `/studios/` returns the whole Studio table, including studios with no public anime, as a single select. | `views/anime.py:517-532` | P2-2 |
| B26 | Low | Recs quality | No franchise awareness: Season 3 of a show the user never started can be recommended, and several seasons of one franchise can take the whole shelf. | `services/recommendations.py:322-331,451-493` | P2-3 |
| B27 | Low | Dead code (FE) | `CharacterModal.jsx` (266 lines), `StaffModal.jsx` (156), `browse/TrendingCarousel.jsx` (100), `common/HorizontalCarousel.jsx` (89) and `hooks/useColorExtraction.js` (187) have no importers; only `AnimeDetail.test.jsx:66-70` mocks the modals. `seasonalKeys` is dead. Browse's `activeTab` only feeds analytics, and `isTabSwitching` is never set to true, so its 500 ms and 6 s timers never fire. `localStorage` reads have no try/catch. | WT `pages/Browse.jsx:49-51,162-186`; `browse/useBrowseAnimeList.js:38,110-144` | P2-4 |
| B28 | Low | Dead code (BE) | Unused code: `AnimeQueryService.get_action_anime` (the views use their own), `recommendations_queryset` (a wrapper), the legacy detail keys v2–v6 and the unversioned key (up to 7 Redis GETs on a miss, plus 7 deletes on each invalidation; nothing is deployed). `user_review` is always null, because `_user_review` is never set. The task's `algorithm` parameter does nothing. `AnimeMinimalSerializer` duplicates `AnimeListSerializer` (G3 consumes it). | `public_anime_service.py:186-195,308-319`; `signals.py:55-61`; `serializers/anime.py:56-106,361-364`; `tasks/recommendations.py:47-68` | P2-4 |
| B29 | Low | Jikan/MAL remnants | BE: recommendation exclusion is keyed on MAL IDs (`_relation_mal_ids`, an extra query per call). The external-links heuristic drops a lone "MyAnimeList" link (Jikan era). Relations expose `mal_id`, and the model comment reads "Rows from before D1 (Jikan) may have only mal_id". FE: `FranchiseSection.jsx:10-11` comment and the `mal-` fallback key, and the `mal_id` path of `fetchFranchise`. No Typesense or Mongo references remain in G2 files in either tree. | `public_query/shelves.py:181-207`; `public_anime_service.py:236-252`; `serializers/anime.py:457-458,476-477`; `models/anime.py:186-188` (frozen); WT `components/FranchiseSection.jsx:10-11`, `api/modules/anime.js:19-23` | P2-6 |
| B30 | Low | Security | The voice-actor description parser renders `href={url}` for any scheme. React 19 blocks `javascript:` URLs, but `data:` and other schemes pass. | WT `pages/VoiceActorDetail.jsx:13-35` | P1-4 |
| B31 | High | Search | **Smoke-test finding S-1.** "one pice" finds nothing. A multi-word query ANDs one title condition per word. "pice" can match only by word similarity, and `word_similarity('pice','One Piece') = 0.40`, below the 0.5 threshold (measured on Postgres 18 on `revamp/base`), so the AND drops One Piece. The whole phrase would match: `word_similarity('one pice','One Piece') = 0.667`, `similarity = 0.583`. Any short misspelt word in a multi-word query has the same problem. | `apps/animes/services/public_query/filters.py:277-286` (`search_words` loop), `_title_match`; `root/settings/base.py` `SEARCH_WORD_SIMILARITY_THRESHOLD` | P0-7 |
| B32 | Med | Requests | **Smoke-test finding S-2.** The app retries 404s. The QueryClient default is `retry: 1` and no query overrides it for 4xx, so a missing anime/character/staff slug, a private profile or any other 404 is fetched twice before NotFound renders. That costs a cold backend request each time, and the NotFound state is late. | `frontend/src/app/providers.jsx:18`; `api/queries/anime.js` (`animeQueries.detail` and friends set no `retry`) | P1-13 |

## Proposed scope

### P0
1. **Rank Browse search by relevance** (B1). Size S. In `useBrowseUrlFilters.js`, set `currentSort = params.sort || (q ? 'relevance' : 'popular')`. Add `{value:'relevance', label:'Best match'}` to `SORT_OPTIONS`, shown only while `q` is set (`TopFilterBar.jsx`). Send `sort=relevance`, which the backend accepts (`filters.py:136`). If the user picks a sort explicitly, keep it. Selecting "Best match" removes `sort` from the URL. Files: `browse/{useBrowseUrlFilters,browseFilterOptions,TopFilterBar,useBrowseAnimeList}.js(x)`, `hooks/usePrefetchAnime.js`.
2. **Stop list-status changes from clearing every cache** (B2). Size M.
   - Split invalidation in `signals.py::invalidate_anime_detail_cache`, which this group claims (see Cross-group contracts):
     - When `update_fields` is a subset of `DETAIL_ONLY_FIELDS = {"status_distribution", "synopsis", "external_links", "trailer_url", "theme_songs", "meta_description"}`, drop only that slug's detail key.
     - When the save changes card fields, bump the namespace.
     - Run both inside `transaction.on_commit`.
   - Add a public helper `invalidate_anime_detail(slug)` in `public_anime_service.py` for other groups to call.
   - In `public_cache.py`, cap the lock-wait at `min(setting, 3000 ms)` and fall through to a rebuild after that, instead of polling for 30 s.
   - Optional: when the namespace bumps, carry each key's last stale copy across so the next readers get stale data instead of a cold rebuild. The new namespace key can read through to the previous namespace's stale entry; this needs only the previous namespace id, kept in Redis.
   - Files: `signals.py` (anime/genre/studio cache receivers only), `public_anime_service.py`, `shared/public_cache.py`. Request G3: write `status_distribution` with `QuerySet.update()` plus `invalidate_anime_detail(slug)`, or stop overwriting AniList data (see P0-5).
3. **Recommendation integrity** (B3, B4). Size M.
   - `_base_candidate_queryset`, the fallback and the relaxed querysets take `can_view_adult` from `AnimeQueryService.can_view_adult_content(user)` and apply `.filter(is_adult=False)` when it is false. The read path also excludes `anime__is_adult=True` for viewers who haven't opted in, which covers users who switch adult content off after recommendations were generated.
   - Regeneration deletes only `is_dismissed=False` rows. Candidates exclude dismissed IDs, and `bulk_create(ignore_conflicts=True)` keeps the dismissed rows.
   - Files: `services/recommendations.py`.
4. **Throttle refresh and make it async** (B5). Size S. `refresh` gets `ScopedRateThrottle` with scope `strict_user` (10/min, already in settings). It enqueues `generate_recommendations.apply_async(kwargs={"user_id": ...})`, reusing the debounce key `reco_pending:{id}` through the G3 helper, and returns `202 {"queued": true}`. Files: `views/recommendations.py`.
5. **Status counts** (B6). Size S. `get_status_distribution` normalizes AniList keys with the alias table the frontend already uses (current/repeating→watching, planning→plan_to_watch, paused→on_hold) and returns the same five-key shape. Contract snapshot unchanged. Request G3 to stop recounting into the provider field; see Cross-group contracts. Files: `serializers/anime.py`, `tests/test_anime_detail_status_distribution.py`.
6. **Schedule by calendar date** (B7). Size M.
   - Frontend: replace weekday bucketing with a date offset from `getZonedCalendarToday(tz)`.
     - Items airing in `[today, today+7)` go to offset 0–6. Each strip column is now "a date", and its label and count come from the same offset.
     - Items aired earlier today stay under today, marked "Aired".
     - Items before today or 7 or more days ahead are left out, and a quiet "N more air later" note is shown.
     - Items without `next_airing_date` but with a `broadcast_day` go into that weekday's column with "Time TBA".
     - `?day=` keeps weekday names, so existing links keep working.
   - Backend: `schedule_queryset` limits the window to `next_airing_date` within `[now-1d, now+8d]`, or no date with a broadcast day, so stale rows and hiatus rows never ship. The cache key gets a day stamp (`:d:{YYYYMMDD UTC}`) so the window rolls over.
   - Files: `utils/dateUtils.js`, `pages/Schedule.jsx`, `public_anime_service.py`.
7. **Multi-word typo search finds the title** (B31, smoke finding S-1). Size S.
   - In the multi-word branch, keep today's per-word AND, and OR it with a whole-phrase match on the full search
     string: `Q(<AND of per-word _title_match>) | Q(title__trigram_word_similar=search) | Q(title_jp__trigram_word_similar=search)`
     (the same `<%` lookup `_title_match` uses, so the existing trigram GIN indexes serve it; use the lookup names
     `filters.py` already uses).
   - Relevance ordering is unchanged. `search_rank` already scores the whole phrase, so a phrase-only hit ranks by its similarity.
   - Do not lower `SEARCH_WORD_SIMILARITY_THRESHOLD` (frozen setting, and it would add noise to every one-word search).
   - Tests:
     - `test_search_trigram.py::test_typos_still_find_the_title` gains "one pice" → One Piece, plus a three-word case
       with one typo (e.g. "attack on titn").
     - A negative case: "one zzzz" does not return One Piece.
     - The EXPLAIN index-usage test covers the multi-word query and still shows the trigram index.
     - Regenerate `snapshots/query_sql.json` for the search entries only, and call it out in the council packet.
   - Files: `services/public_query/filters.py`, `tests/test_search_trigram.py`, `tests/test_query_sql_snapshot.py` (+ snapshot).

### P1
1. **One server-side search for the navbar and hero** (B8, B9, B23). Size M.
   - New `components/navbar/useAnimeSearchSuggestions.js` holds the shared logic: trim; minimum 2 characters (matches `MIN_SEARCH_LENGTH`); 200 ms debounce; a `useQuery` on `navbarSearchQueries.results(q)`, which now passes `signal` so an outdated request is aborted; `keepPreviousData`; `staleTime` 60 s.
   - `useNavbarSearch` and `HeroSearch` both use it.
   - Delete `useFuzzySearch.js`, `navbarSearchQueries.cache`, the fuse import and the "Exact" badge. Request the integrator to remove `fuse.js` from `package.json`.
   - Empty states:
     - Navbar and hero: "No matches for 'x'. Try the English or Japanese title", plus "Search all anime" (Browse with `q`).
     - Browse with `q` and filters: add a "Search all anime for 'x'" button that keeps `q` and drops the filters.
     - Browse with `q` alone: show the trending row link.
   - The suggestion key stays outside `['anime']`, but it includes the adult flag, so turning adult content on or off doesn't leave stale suggestions.
   - Files: `navbar/*` (own), `home/HeroSearch.jsx`, `browse/EmptyState.jsx`, `api/queries/anime.js`.
2. **Shared list cache for members, a hardened cache key and Vary** (B10, B11, B12). Size M.
   - Signed-in `list` builds the same cached payload as anonymous, keyed by the normalized parameters plus `adult:{0|1}`, then calls `enrich_collection_payload_for_user`.
   - The key uses a whitelist of known parameters (each `getlist` value sorted and normalized). Unknown parameters are ignored.
   - `exclude_ids` keeps at most 100 entries. `NoCountPagination` returns 404 past page 500 (`max_page = 500`).
   - Add `Vary: Authorization, Cookie` to every response that goes through `_with_public_cache_control` or `_with_cache_status_header`.
   - Expected budgets: `list_authenticated` and `search_signed_in` drop to the anonymous count + 3 on a cold cache, and to 3 when warm.
   - Files: `views/anime.py`, `public_anime_service.py`, `shared/pagination.py`.
3. **Cheaper, quieter recommendations** (B13, B14). Size M.
   - GET: rows exist (fresh or stale) → serve them; if stale, also enqueue a debounced task. No rows → enqueue a task and return the cached generic fallback built from the trending shelf (`reason=trending`), so the response stays fast. Empty results are cached for 10 min.
   - Batch:
     - Build the candidate pool once per run with `values()`, carrying only id, type, rating, member_count, the three ranks, genre IDs and studio IDs. Two queries, about 800 rows, held in memory once.
     - Per user, read the list with `values_list("anime_id","status","score")` plus favourite IDs and score in Python. Anchor features come from the shared pool, or from a single `values()` query for anchors outside it.
     - Process only users with `last_login` or a list update in the last 30 days and recommendations older than 7 days, using `.iterator(chunk_size=200)`.
     - On a per-user failure, log it and continue. Never retry the whole batch: `retry_policy` becomes `"none"` for batch mode (the per-user path keeps its retry).
     - After writing, delete the user's `user_recommendations:{id}` cache key.
   - The beat entry and its kwargs stay as they are, so the snapshot is unchanged.
   - Files: `services/recommendations.py`, `tasks/recommendations.py`, `views/recommendations.py`.
4. **Character and staff pages** (B15, B30). Size M.
   - Roles use `Prefetch(..., AnimeCharacter.objects.filter(anime__in=Anime.public_queryset()))`, plus an `is_adult=False` filter for viewers who haven't opted in, with `.only()` on the fields the serializers read (anime id, slug, title, release date, cover fields).
   - A cache keyed `character:{id}:adult:{flag}` (600 s, public_cache), with `is_favorite` added per user.
   - The frontend shows the first 60 roles, then a "Show all N" button, and groups roles by anime so one anime appears once with its voice actors. `parseMarkdownLinks` and the character parser accept only `http(s):` links.
   - Files: `views/{characters,staff}.py`, `serializers/base.py`, `pages/{CharacterDetail,VoiceActorDetail}.jsx`.
5. **Adult titles on direct links** (B16). Size S. Add `is_adult` to `AnimeDetailSerializer` (contract snapshot updated on purpose). `retrieve` and the `_get_action_anime` actions return `404 anime_not_found` for viewers who haven't opted in. That is the default and needs owner sign-off. The decision reads the flag from the cached base payload, which costs no extra query. `AnimeDetail.jsx` keeps its NotFound state. Files: `views/anime.py`, `public_anime_service.py`, `serializers/anime.py`.
6. **Query budget coverage** (B17). Size S. Add these endpoints to `test_query_budgets.py`, in a separate `EXTRA_ENDPOINTS` dict so `PUBLIC_ENDPOINTS` and the contract snapshot stay unchanged: `top_rated`, `related`, `recommendations` (AniList patched), `characters`, `staff`, `character_detail`, `staff_detail`, `user_recommendations` (signed in), `genres` and `studios`. Each also gets the same check that the count doesn't grow with the number of rows.
7. **Lighter detail page** (B18). Size S.
   - Remove the 50-episode prefetch on Overview (`useAnimeDetailTabData.js:117-126`); the Watch tab still loads it on demand.
   - Fetch recommendations only once the sidebar is about to show (an IntersectionObserver on the `RecommendationsSidebar` container), or after the main payload with `staleTime` 30 min.
   - Backend: store non-degraded `anime_recommendations` for 24 h; degraded stays at 60 s.
   - Files: `animeDetail/*`, `views/anime.py`.
8. **Dismiss on Recommended cards** (B19). Size S. A small "Not interested" icon button on each Recommended card (keyboard reachable, `aria-label="Not interested in {title}"`, 44 px hit area on phones). It removes the card optimistically through `setQueryData(['recommendations'])` and calls `dismiss`, rolling back on error. Remove `refetchIntervalInBackground`. Files: `pages/Home.jsx`, `api/modules/recommendations.js`, `api/queries/recommendations.js` (requested in seams).
9. **Precise cache updates after list changes** (B20). Size S. `api/queries/anime.js` exports `patchAnimeListStatus(queryClient, animeId, userListStatus)`, which runs `setQueriesData` over `['anime']` and `['schedule']` and replaces `user_list_status` wherever `id === animeId` (lists, infinite pages, browse rows, the detail payload, the schedule days map). G3's hook calls it instead of `invalidateQueries(['anime'])`. Remove `seasonalKeys`.
10. **SEO** (B21). Size S. `AnimeDetail.jsx` stops using `SEOHelmet` and renders `<SEO customTitle customDescription canonical={`https://anishows.com/anime/${slug}`} ogImage={absolute(cover)} ogType={movie ? 'video.movie' : 'video.tv_show'} />` plus its own `<Helmet><script type="application/ld+json">` (`Movie` or `TVSeries`). Description: the first 160 characters of the synopsis with tags stripped. Character and staff pages use `<SEO>` with canonical and og tags. `NotFound` passes `noIndex`. An `absoluteMediaUrl()` helper goes in `utils/imageUtils.js`.
11. **Up next shelf (members)**. Size S. Justification: it's the most-used daily question ("what airs next from my list"), and it costs nothing new, because it reuses the cached and enriched schedule payload, which is 3 per-user queries. On Home, above Currently Watching: entries from `scheduleQueries.week` where `user_list_status.status === 'Watching'` and the next episode airs within 7 days, sorted by `next_airing_date`, at most 6, each showing "EP n · in 3h". The shelf is hidden when empty; there's no empty placeholder. Files: `pages/Home.jsx`, `api/queries/anime.js`.
13. **Don't retry client errors** (B32, smoke finding S-2). Size S.
    - New `frontend/src/api/queries/retry.js` (G2) exports `retryUnlessClientError(failureCount, error)`. It returns
      `false` for any HTTP 4xx (`error.response?.status` between 400 and 499; 408 and 429 excepted, since they are
      worth one retry), and `failureCount < 1` otherwise. The latter keeps today's single retry for network errors and 5xx.
    - Set it as `defaultOptions.queries.retry` in `app/providers.jsx`. Overview amendment 16 gives G2 that one option;
      the rest of the file is frozen.
    - Queries that set their own `retry` keep it: `BrowseRowMode` `retry: 1`, and G1's `MiniProfileHoverCard`/profile queries (A27).
    - Mutations are unaffected (TanStack's mutation default is no retry).
    - Tests:
      - `api/queries/__tests__/retry.test.js`: 404, 403, 400 → no retry; 500 and network → one retry; 429 → one retry.
      - Plus one rendering test: `AnimeDetail` for a missing slug calls the API exactly once before NotFound
        (mock `animeApi.getBySlug` rejecting with a 404).
    - Files: `api/queries/retry.js` (new), `app/providers.jsx` (that option only), tests.
14. **My list filter on Schedule** (was 12). Size S. Members only. A "My list" toggle button (`aria-pressed`) stored in the URL as `?mine=1`. It filters client-side to entries with `user_list_status` whose status isn't Dropped or Completed, and the day counts follow the filter. Justification: the payload already carries `user_list_status`, so there's no backend change. Files: `pages/Schedule.jsx`.

### P2
1. Type options add ONA and Music. Drop `not_yet_aired` from `VALID_STATUSES` (no SQL change for valid values; regenerate the SQL snapshot only if a key changes). Size S.
2. `/studios/`: only studios with at least one public, non-adult anime (an `Exists` subquery), cached 1 h. Browse's studio picker filters as you type inside `CustomSelect`. Size S.
3. Franchise-aware recommendations. A candidate whose PREQUEL relation (`relation_type` compared case-insensitively; values unverified) points to a local anime not in the user's Completed list is skipped. When that prequel *is* Completed, the candidate is boosted with the reason "Next in {title}" (`BECAUSE_YOU_LIKED`, `source_anime`). This is one `values_list` query over the candidate IDs. At most 2 picks per franchise. Size M.
4. Remove dead code (B27, B28):
   - Frontend: the five files, `seasonalKeys`, Browse `activeTab` (keep the analytics call when the sort changes), `isTabSwitching`, and try/catch around `localStorage`.
   - Backend: `get_action_anime`, `recommendations_queryset`, the legacy detail keys in the service and in the `signals.py` invalidation, the `algorithm` parameter (keep it accepted, ignore it, and log a deprecation once).
   - `user_review`: stays null until G5 confirms, then is removed.
   - Size S.
5. Request the integrator to fix the sitemap and robots: drop `/seasonal`, `/login` and `/register`, and add `Disallow: /notifications`. Optional: a dynamic `sitemap-anime.xml` (see Risks). Size S.
6. Remove Jikan/MAL remnants (B29):
   - Exclude relations by `to_anime_id` and `target_anilist_id` only. Drop `_relation_mal_ids`, which saves one query per recommendations or related call.
   - Remove the "MyAnimeList-only" link heuristic.
   - Update the `FranchiseSection` comment to "AniList ID in `id`; `mal_id` is AniList's `idMal`".
   - Keep `mal_id` as a secondary key in the AniList recommendation matching, because AniList returns `idMal`.
   - Size S.
7. Next/previous season buttons. When season and year are both set, ‹ › buttons next to the season chip step through seasons (fall → winter rolls the year), and the Browse header shows "Fall 2026". Justification: one click instead of two selects, all on the frontend. Size S.

### Out of scope
Catalog ingestion, provider mapping and the `Anime` model's fields (frozen); collaborative filtering; any search service; server-side rendering or prerendering; changes to the watch-episodes provider path; review or favourite behaviour (G5); list mutations themselves (G3); notification of new episodes (G4).

## File ownership
Post-seams paths. All backend paths are under `apps/`.

**Prep commit (`revamp/base`), see overview section 4a.** These now exist and are G2's:
- `apps/animes/models/recommendations.py` (UserRecommendation)
- `apps/users/serializers/recommendations.py`
- `root/settings/features/browse.py`
- `_recommendation_entries()` in `celery_schedule.py`
- `frontend/src/api/modules/recommendations.js` and `frontend/src/api/queries/recommendations.js` (Integrator request (a) is done)
- `frontend/src/app/routes/browse.jsx`
- `defaultOptions.queries.retry` in `app/providers.jsx` (B32 only)
- New `frontend/src/api/queries/retry.js`
- Contract stubs (keep the signatures): `invalidate_anime_detail(slug)`/`invalidate_public_collections()` at the end of
  `public_anime_service.py` (+ `tests/test_public_cache_contract.py`). Today they do exactly what an `Anime` save does,
  namespace bump included; P0-2 narrows them.
- Contract stub: `patchAnimeListStatus(queryClient, animeId, userListStatus)` in `api/queries/anime.js` (today: the two
  invalidations AnimeCard makes; P1-9 makes it a precise patch).
- Migration space: `animes` `0058` (the fallback index only, if EXPLAIN demands it; overview section 7).

Integrator request (c) `PUBLIC_API_CACHE_WAIT_TIMEOUT_MS`: G2 may set it in `features/browse.py` once D-10's condition
holds (G3 merged). (b) is confirmed: the Anime/Genre/Studio cache receivers in `signals.py` are G2's (function-level,
overview amendment 15).

**Adult rule (overview section 11):** G2 must not edit `apps/animes/adult_content.py`, the provider query or
`reconcile_adult_flags`. `is_adult` stays as computed today (`ADULT_RULE="legacy"` is the owner-gated proposal, ⚑).
- **Backend (may change):** `animes/views/{anime,characters,staff,recommendations}.py` (minus the G3/G5 actions, whose bodies stay as they are); `animes/services/{public_anime_service,recommendations,relation_links}.py`; `animes/services/public_query/*`; `animes/serializers/{anime,base}.py`; `animes/serializers_mixins.py` (UserStatusMixin shape frozen, see contracts); `animes/lookups.py`; `animes/tasks/recommendations.py`; `users/serializers/recommendations.py` (`UserRecommendationSerializer`, after the seams split; `users/serializers/users.py` keeps re-exporting it); `shared/{public_cache,pagination}.py`; in `animes/signals.py`, only `_invalidate_anime_public_caches`, `invalidate_anime_detail_cache`, `invalidate_deleted_anime_detail_cache`, `_invalidate_browse_filter_cache`, `invalidate_genre_cache` and `invalidate_studio_cache` (pending integrator confirmation).
- **Backend tests (may change or create):** `animes/tests/{test_query_budgets,test_public_contract,test_query_sql_snapshot,test_search_trigram,test_schedule_cache,test_public_payload_caching,test_recommendations_service,test_recommendations_view_cache,test_anime_detail_status_distribution,test_quarantined_public_visibility,test_browse_backend,test_top_rated_endpoint}.py` and `snapshots/{public_contract,query_sql}.json` (only regenerated deliberately). New: `test_public_cache_invalidation.py`, `test_list_cache_key.py`, `test_recommendations_view.py`, `test_recommendations_batch.py`, `test_schedule_window.py`, `test_character_staff_detail.py`, `test_adult_detail_gate.py`. `catalog_fixtures.py`: helper additions only; `PUBLIC_ENDPOINTS` stays unchanged.
- **Frontend (may change):** `pages/{Home,Browse,AnimeDetail,CharacterDetail,VoiceActorDetail,Schedule,NotFound}.jsx`; `components/AnimeCard.jsx`; `components/VirtualizedAnimeList.jsx` (overview amendment 4); `components/browse/*`; `components/home/*`; `components/animeDetail/*` except `ReviewsSection.jsx` and `useAnimeReviews.js`; `components/{DetailTabs,FranchiseSection,MusicSection,LazyYouTube,InformationBox,OptimizedImage}.jsx`; `components/detailTabs/*`; `components/common/AnimeMediaImage.jsx`; `components/skeletons/*`; `components/navbar/{NavbarSearch,SearchSuggestionList,useNavbarSearch}` plus new `useAnimeSearchSuggestions.js`; `api/modules/anime.js`; `api/modules/recommendations.js` (post-seams); `api/queries/anime.js`; `api/queries/recommendations.js` (requested in seams); `hooks/{usePrefetchAnime,useAnimeAccentColor,useScrollFade}.js`; `utils/{characterRoles,realGenres,imageUtils,dateUtils}.js` and their tests; tests under `pages/__tests__/`, `components/{browse,home,navbar}/__tests__/` for these files.
- **Frontend deletes:** `components/{CharacterModal,StaffModal}.jsx`, `components/browse/TrendingCarousel.jsx`, `components/common/HorizontalCarousel.jsx`, `hooks/useColorExtraction.js`, `components/navbar/useFuzzySearch.js`. Also remove the matching `vi.mock` lines in `pages/__tests__/AnimeDetail.test.jsx`.
- **Precedence (prep commit):** where this list names a file or directory that the *Prep commit* block above grants (a `root/settings/features/` module, a `celery_schedule.py` function, an `app/routes/` file, `boot.js`, a split module), the grant wins; everything else in this list stays forbidden. The frozen shells and shims (overview section 4) stay forbidden.
- **Must not touch:**
  - Anything FROZEN: `root/settings/*`, `root/urls.py`, `components/{SEO,SEOHelmet,Layout,Navbar}.jsx`, `components/common/{Pagination,ErrorState,SectionHeader,CustomSelect,...}`, `index.css`, `styles/components/*`, `package.json`, `public/*`, `app/routes.jsx`, `api/client.js`, `api/pagination.js`.
  - Provider and catalog services, `adult_content.py`, `Anime` model fields.
  - `user_list_side_effects.py` (G3), the UserAnimeList, review and favourite receivers in `signals.py`.
  - `components/StatusDistribution.jsx` and `utils/statusDistribution.js` (G3), `ReviewsSection` and `useAnimeReviews` (G5), `components/navbar/UserMenu.jsx` (G1).

## Cross-group contracts
**Provided (frozen shapes):**
- `user_list_status` on every card and detail payload: `{id,status,score,episodes_watched,notes,started_at,finished_at,total_rewatches,is_rewatching,progress}` (`public_anime_service.py:56-73`). `is_favorite: bool`. The shape is unchanged. G3's mutations must keep `UserAnimeList` as the only source.
- `AnimeListSerializer`, `AnimeMinimalSerializer` (consumed by G3's `UserAnimeListSerializer`, `users/serializers/users.py:548`) and `AnimeCompactSerializer` (`:740`): fields unchanged. The detail payload gains only `is_adult` (P1-5). `user_review` stays `null` until G5 signs off.
- New: `invalidate_anime_detail(slug)` and `invalidate_public_collections()` in `public_anime_service.py`; `patchAnimeListStatus(queryClient, animeId, status)` in `api/queries/anime.js`. The `generate_recommendations(user_id=None, limit=10, algorithm=...)` signature doesn't change.
- `UserRecommendationSerializer` (`id, anime, score, reason, reason_text, reason_metadata, created_at`): unchanged. `refresh` now returns 202 `{queued: true}`; it has no frontend callers today.

**Consumed:** `UserProfile.show_adult_content` and `preferred_timezone` (G1, read-only, via `can_view_adult_content` and `user.preferred_timezone`); `authApi.updateProfile` for the adult toggle on Browse and Schedule (G1); `listApi`, G3's list hook, `userQueries.watching` (G3); `schedule_recommendations_debounced` (G3).

**Requests:**
- **G3:**
  - (a) Stop `update_anime_status_distribution` from calling `anime.save()` on the catalog row. Either drop the local recount, since AniList's counts are the meaningful ones and B6 shows them, or write it with `Anime.objects.filter(pk=...).update(...)` followed by `invalidate_anime_detail(slug)`. The integrator has to choose between those two.
  - (b) AnimeCard's list menu (G3 hook) calls `patchAnimeListStatus` instead of `invalidateQueries(['anime'])` and `seasonalKeys`.
  - (c) Keep the `reco_pending:{id}` debounce helper's signature.
- **G5:** confirm that `useAnimeReviews.js:57` can stop reading `anime.user_review`, so the field can then be removed. Review create, update and delete must call `invalidate_anime_detail(slug)`, because `review_count` and `avg_rating` live in the detail cache.
- **Integrator:**
  - (a) Seams: add `api/queries/recommendations.js` (`recommendationKeys`, `recommendationQueries`) to the `api/queries/user.js` split, owned by G2.
  - (b) Confirm G2 owns the Anime, Genre and Studio cache receivers in `animes/signals.py` (unassigned in the matrix).
  - (c) Lower `PUBLIC_API_CACHE_WAIT_TIMEOUT_MS` to 3000 in `root/settings/base.py`. The code cap in P0-2 covers this anyway.
  - (d) Remove `fuse.js` from `package.json` once P1-1 lands.
  - (e) `public/sitemap.xml` and `robots.txt` edits (P2-5).
  - (f) Delete `components/SEOHelmet.jsx` once AnimeDetail stops importing it.
  - (g) Frozen mapper: consider storing AniList's distribution under the five local keys (`providers/base.py:214-229`). G2's serializer normalizes either way.
- **G4:** none. The schedule payload fields (`next_airing_episode`, `next_airing_date`) are unchanged.

**Avoiding collisions:**
- Do signals edits as one isolated commit touching only the six named receivers.
- The contract snapshot is regenerated once, in the PR that adds `is_adult`.
- `test_query_budgets.py` changes are additive (new dict).
- `AnimeCard.jsx` is shared with G3's hook call. G2 lands the `patchAnimeListStatus` export first; G3 rebases onto it.

## Acceptance criteria and test plan
**Checklist**
- [ ] `/anime/?q=one%20pice` returns One Piece (and "attack on titn" finds Attack on Titan); "one zzzz" does not return One Piece; the multi-word query still uses the trigram index (S-1).
- [ ] A 404 query (missing anime slug) is requested once, not twice; a 500 is retried once (S-2).
- [ ] `/browse?q=frieren` lists the title "Frieren..." first; the sort select shows "Best match"; picking "Highest Rated" keeps `sort=rating` (vitest and backend `test_search_trigram.py::test_relevance_sort_param`).
- [ ] Saving a `UserAnimeList` doesn't change `anime_collection_ns:v11`, and a cached `anime_list:*` key survives. Saving `Anime.title` bumps the namespace on commit (`test_public_cache_invalidation.py`).
- [ ] The lock-wait never exceeds 3 s. Test: hold the lock in the test, measure with patched `time.monotonic`.
- [ ] A non-opted user's generated and served recommendations contain no `is_adult=True` titles. A dismissed anime is still dismissed and missing from the results after `generate_for_user` (`test_recommendations_service.py`).
- [ ] The 11th `refresh` within a minute returns 429. `refresh` returns 202 and enqueues exactly one task, the second call being debounced (`test_recommendations_view.py`).
- [ ] The detail payload shows AniList counts when the stored keys are uppercase AniList keys.
- [ ] The schedule payload excludes `next_airing_date` older than 1 day or more than 8 days ahead (`test_schedule_window.py`). On the frontend, an item 10 days out isn't in the strip; one 2 days out sits under the date 2 days out, also at UTC+14 and UTC-12 and across Saturday→Sunday (`utils/dateUtils.test.js`).
- [ ] The navbar sends no request for 1 character and never requests `page_size=100`. Typing "fr" then "fri" quickly aborts the first request (`NavbarSearch.test.jsx`).
- [ ] Signed-in `/anime/?q=x` is served from the shared cache with per-user fields, and the guest response has no user fields (`test_list_cache_key.py`). Unknown parameters produce the same key. `exclude_ids` is capped at 100. `page=501` returns 404. Responses carry `Vary: Authorization`.
- [ ] Character and staff detail exclude quarantined and adult roles for non-opted viewers, never load `offline_db_payload` (assert via `CaptureQueriesContext` that the SQL lacks the column), and stay within budget.
- [ ] `/anime/<adult-slug>/` returns 404 for guests, and 200 with `is_adult: true` for opted-in members.
- [ ] Recommended cards can be dismissed by keyboard; the card leaves the list and rolls back on a 500.
- [ ] The Up next shelf shows only Watching entries airing within 7 days, sorted, and is hidden for guests and when empty. The Schedule `?mine=1` filter changes the counts.
- [ ] The detail page `<head>` has a canonical, an absolute `og:image` and JSON-LD of the right `@type`. NotFound has `noindex`.

**Query budgets (cold cache, no growth from 3 to 6 rows).** Starting values to measure and pin:
- Lowered: `list_authenticated` ≤ 7, which becomes `list` + 3 because it shares the cache.
- New: `top_rated` 4, `related` ≤ 5, `recommendations` ≤ 6 with AniList patched, `characters` 3, `staff` 3, `character_detail` ≤ 4, `staff_detail` ≤ 5, `user_recommendations` ≤ 6, `genres` 1, `studios` 1.
- Warm-cache variants of the signed-in endpoints: exactly 3.
- `browse_rows` and `schedule` unchanged. `detail` is unchanged, or 7 if `_relation_mal_ids` is removed from the related/recommendations paths (not detail).
- Record the measured numbers in the test docstring.

**Frontend vitest (new or extended):** `browse/__tests__/useBrowseUrlFilters.test.jsx`, `browse/__tests__/EmptyState.test.jsx`, `navbar/__tests__/NavbarSearch.test.jsx`, `home/__tests__/HeroSearch.test.jsx` (shared hook, empty state), `utils/dateUtils.test.js`, `pages/__tests__/Schedule.test.jsx` (date buckets, My list, TBA), `pages/__tests__/Home.test.jsx` (Up next, dismiss), `pages/__tests__/AnimeDetail.test.jsx` (no 50-episode prefetch on Overview, SEO props), `pages/__tests__/VoiceActorDetail.test.jsx` (link scheme, show all), `api/queries/__tests__/queryKeys.test.js` (remove `seasonalKeys`, add `patchAnimeListStatus`).

**Manual QA (phone 390×844 and desktop 1440)**
1. Logged out: on Home, hero search for "frie" shows a suggestion list. "zzqx" shows the no-matches state. Enter opens Browse with "Best match".
2. On Browse, filter Fall 2026, step › to Winter 2027, add genre Action, search for an impossible title, then press "Search all anime for…".
3. Log in. On Home, Up next appears for a Watching airing show. Dismiss a Recommended card by keyboard.
4. Add a show to Watching from a Browse card. The card updates immediately with no full refetch (check the network panel). Schedule shows it under My list.
5. On Schedule, set the timezone to Pacific/Kiritimati in Settings and check the strip dates against the times on the cards. Check "Time TBA" items.
6. Open a detail page: Overview makes one watch-episodes request, the sidebar loads when scrolled into view, and View Source/Helmet shows the canonical. Characters and Staff tabs page correctly.
7. Open a voice actor with more than 100 roles: 60 render, then "Show all".
8. With adult content off, open an adult slug and get NotFound. Turn it on and the page opens.
9. Check 16 px gutters on phones, visible focus everywhere, and that reduced motion stops the hero carousel.

**Gates:** `ruff check`, `ruff format --check`, `makemigrations --check --dry-run` (expects no migration), `pytest -n auto --cov` (all guard tests green; snapshots changed only in the `is_adult` PR), `npm run lint`, `npm run test:run`, `npm run build`. The beat snapshot must be unchanged.

## Migration plan
None. Every change is in code or caching. Keeping dismissed recommendations needs no schema change, because the unique (user, anime) constraint plus `ignore_conflicts=True` already preserves dismissed rows. The existing indexes (`UserRecommendation` (user,-score), (user,is_dismissed); `anime_schedule_day_idx`; the trigram GIN indexes; the FK indexes on `AnimeCharacter.character` and `AnimeStaff.staff`) cover the new queries. If measurement later shows the schedule window query not using `anime_schedule_day_idx`, the fallback is `0058_browse_schedule_airing_idx.py` (reserved number, overview section 7; depends on `0057`): `AddIndex(Index(fields=["next_airing_date"], condition=Q(status="Airing"), name="anime_airing_next_idx"))`, reversible, no data. It is not proposed up front.

## Risks and open questions
- **Adult detail policy (P1-5).** The default is a 404 for viewers who haven't opted in. Alternative: serve the page but blur the cover with a notice. Owner decision needed before implementation. It affects crawlers, since adult pages drop out of the index, which is probably desirable.
- **status_distribution semantics.** If G3 keeps a local recount, the field mixes "site members" with "AniList members". Recommendation: AniList counts only, labelled "AniList users" in InformationBox. The label change belongs to G3's `StatusDistribution`.
- **Namespace carry-over** (optional in P0-2) adds one Redis GET per miss. Leave it out if the receiver split alone keeps hit rates healthy. Measure `X-Cache-Status` miss/stale ratios under a list-editing script.
- **Daily batch filter.** "Active in 30 days" needs `last_login` or a recent list update. If `last_login` isn't maintained with JWT logins (unverified: SimpleJWT doesn't update it by default), use `UserAnimeList.updated_at` as the activity signal.
- **Recommendation fallback** on a cold first GET returns trending for one request. Acceptable, but the subtitle must not say "Based on your love for…" when the reason is trending (Home.jsx:551-555).
- **AniList budget.** P1-7 caps per-title recommendation calls at one per 24 h per adult flag. A crawler sweeping titles can still spend roughly one call per title per day. If that's too much, the integrator could move AniList recommendations into the frozen sync (store them as relations) and make this endpoint purely local.
- **Dynamic sitemap** (P2-5, optional) needs `root/urls.py` and Caddy routing (both frozen). Defer unless SEO is a priority; the SPA has no SSR, so title pages index only through rendered JS anyway.
- **Relevance tie-breaks.** With `sort=relevance` on a two-letter query the backend uses popular order (`filters.py:352-353`). The "Best match" label is still honest.
- **Schedule day-stamp key** adds 16 keys a day, with TTLs; they expire on their own.
