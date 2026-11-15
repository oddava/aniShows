# D1: AniList-only catalog, and trigram search (November 2026)

Branch `fix/anilist-only-and-fixes`. Local only: no push, no PR, no deploy.

## Starting point (measured 2026-11-16)

- **AniList is switched off at runtime.** `AniListClient._query` raises
  ("runtime anime data fetches must go through the self-hosted Jikan
  instance"); the April 2026 commit `172b5e8` moved every fetch to Jikan.
  So D1 is not only deletion: it needs a working AniList client, and every
  Jikan consumer re-pointed at it.
- `apps/animes/services/jikan.py` is 2,237 lines; 53 backend files mention Jikan
  (30 non-test). Consumers: trending sync, airing workflow, metadata
  enrichment, franchise sync and import, offline-catalog reconcile (metadata,
  franchise, themes stages), watch episodes, detail recommendations, image
  banner fallback, user list imports, theme-song sync, two management
  commands, admin import jobs, celery admin, frontend admin import page.
- Typesense and MongoDB have **no Python references**: they exist only as the
  Jikan container's own backing services.
- Prod compose runs `jikan`, `jikan_mongodb`, `jikan_typesense` with 768 + 512 +
  512 MiB limits (1.79 GiB reserved). Idle RSS measured locally:
  jikan 613 MiB, mongo 186 MiB, typesense 81 MiB (≈880 MiB), 4–6 % CPU at idle.
  Images on disk: 969 MB + 1.19 GB + 876 MB.
- Search uses `icontains`, which Django compiles to `UPPER(col) LIKE UPPER(...)`:
  the GIN `gin_trgm_ops` indexes are on `col`, not `UPPER(col)`, so they are
  never used. `django.contrib.postgres` is not installed, so the trigram
  lookups are not registered either.

## Decisions

1. **AniList is the only provider.** Theme songs: AniList has no theme data
   (the `openings`/`endings` fields in `MEDIA_FIELDS_WITH_THEMES` do not exist
   in its schema). Theme-song *sync* is removed; stored `ThemeSong` rows and the
   YouTube-link backfill (YouTube Data API, not a catalog source) stay. A theme
   source (e.g. AnimeThemes) is a follow-up decision, not part of D1.
2. **The offline-catalog import stays** (a one-file GitHub release used as a
   seed index, no service), but its enrichment runs through AniList. Its
   themes stage is dropped, with a migration removing the dead columns.
3. **Rate limit:** AniList's documented limit is 90 req/min but it has run
   degraded at 30 req/min; the limiter defaults to 30 (`ANILIST_RATE_LIMIT_PER_MINUTE`)
   and honours `Retry-After`/`X-RateLimit-*`. Batch queries (`id_in`, 50 per
   call) keep the hourly airing refresh at a handful of requests instead of
   one per show.
4. **Cast:** AniList payloads carry a 10-person preview, so stored cast links
   are never deleted for being absent from it. Jikan wrote people under
   synthetic IDs (1.6e9+/1.7e9+ offsets); when the same person (by name)
   arrives from AniList, the old link is retired and the person's favourites
   move to the AniList row. The old rows stay (unlinked, harmless).
5. **Schedule:** AniList has no broadcast day/time; it is derived from
   `nextAiringEpisode.airingAt` in Asia/Tokyo, which is what the schedule's
   fallback already assumes.

## Step 2 (D1) work list

1. Client (`providers/anilist/client.py`): a real synchronous `_query`
   (httpx POST, shared limiter, response cache with a stable key — today's
   `hash()` key differs per process — circuit breaker, retries/backoff on 429,
   5xx and transport errors, GraphQL error codes, metrics under
   `service="anilist"`, interactive request budget). Add batch fetch by IDs,
   an airing-only query, an episode-schedule query, recommendations by AniList
   or MAL ID; `idMal` on relation nodes; drop the fake themes fields.
2. Service facade (`providers/anilist/service.py`): the methods consumers call
   (`resolve_airing_media_for_anime`, `update_airing_fields`,
   `refresh_anime_metadata`, `prefetch`) so call sites change their import,
   not their logic.
3. Re-point consumers: `tasks/{sync,airing,metadata,franchises,images,offline_catalog}`,
   `services/{offline_sync,watch_episodes,public_anime_service,franchise_import,
   offline_catalog_parsing,relation_links}`, `serializers/anime.py`, user
   imports, admin import jobs, celery admin, `management/commands/backfill_external_urls.py`.
4. Delete: `services/jikan.py`, `tasks/themes.py` theme sync (keep the YouTube
   backfill), `management/commands/populate_themes.py`, the themes stage,
   `Anime.themes_checked_at`, beat entries and routes for theme sync,
   `JIKAN_BASE_URL`, Jikan ruff ignores, Jikan tests.
5. Infra/config: remove the three services and two volumes from both compose
   files, Jikan steps from `deploy-prod.sh`, env vars from `.env.example`;
   update README, makefile, `docs/`, frontend admin import page.
6. Migration: drop `themes_status`, `themes_attempt_count`, their index and
   `themes_checked_at`. Reversible.
7. Tests: delete Jikan suites, port the rest to AniList payloads through
   `httpx.MockTransport`, add client tests (retry, 429, GraphQL errors,
   breaker, batch), keep query budgets and contract snapshots unchanged.

Gate after each step: `ruff check`, `ruff format --check`,
`makemigrations --check`, full pytest, mypy count not above the 178-error
baseline, frontend lint + vitest for the admin page change.

## Step 3: trigram search

- Install `django.contrib.postgres` (registers `trigram_word_similar` etc.).
- Matching per field: `ILIKE '%q%'` (served by `gin_trgm_ops`, via a small
  custom `ilike` lookup, because `icontains` wraps the column in `UPPER()`)
  **or** `q <% title` / `q <% title_jp` (word similarity, typo-tolerant, also
  served by the index). Synopsis keeps substring-only matching (fuzzy matching
  on long text is noise). Multi-word queries keep their per-word AND.
- Relevance: annotate `search_rank` (word similarity, exact/prefix boost) and
  put it first when the user did not ask for a sort.
- Proof: EXPLAIN (ANALYZE, BUFFERS) on the seeded 40k catalog showing Bitmap
  Index Scans on `anime_title_trgm_gin` / `anime_title_jp_trgm_gin`, before vs
  after timing, and a test that fails if the planner stops using the indexes.

## Step 4: review

Council of exactly two reviewers (Claude Opus 5.5, GPT 6.1 Sol at high
effort); fix and re-review until both approve.

## Rollout (after the council review)

- Migration 0055 removes the theme fields from Django's state only; the
  columns stay (with database defaults) so the old replicas keep working
  while `deploy-prod.sh` rolls the web containers. **Next release:** add a
  migration that drops `anime_anime.themes_checked_at`,
  `anime_offlineanimesyncstate.themes_status` and `.themes_attempt_count`,
  and delete the retired `sync_theme_songs` task stub.
- `deploy-prod.sh` removes the orphaned Jikan containers only after the new
  web and workers serve, runs `manage.py check --deploy` (shows `core.W001`
  when the Safe Browsing key is missing), and prints the
  `docker volume rm` command for the unused `*_jikan_mongodb_data` and
  `*_jikan_typesense_data` volumes (~2 GB); it does not delete data itself.
