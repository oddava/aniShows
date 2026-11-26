# Catalog engine rebuild: audit and plan (2026-11-26)

Status: **implemented** on branch `t3/catalog-engine` (decisions: JP only, music videos
dropped, out-of-scope rows hidden, not deleted).

## What was built (and where it differs from the plan below)

- `apps/animes/catalog/`: `scope` (the rule), `queries`, `lanes` (seasons, delta, trending,
  airing, hydrate, seed), `runner` (lock + `CatalogRun` + lane queues), `hooks` (bulk-write
  switch, `request_hydrate`), `overview`. Celery entry point: `tasks.catalog.run_catalog_lane`.
  CLI: `manage.py catalog status|run <lane> [--restart] [--async]|rescope`.
- The scope rule is enforced in `AniListPersistence.save_anime_to_db` itself, so *every*
  write path (lanes, list imports, franchise imports, admin refresh) refuses to create an
  out-of-scope title (`OutOfCatalogScopeError`) and hides a stored one.
- `Anime.public_queryset()` filters on `catalog_excluded`; the detail page and list actions
  use `reachable_queryset()` so a hidden title on someone's list still opens. Rows the old
  pipeline quarantined carry `legacy:quarantined` (migration 0064), a reason the rule never
  clears.
- Bulk lane writes skip the per-row create hooks (metadata enrichment and episode sync used
  to fire one AniList call per new row). A row created one at a time asks the details lane.
- Production runs one Celery process, so lane runs are short (sweep and delta: 4 minutes),
  and the sweep queues its next slice behind whatever is waiting.
- Images: only hydrated rows get their own copies (`heal_missing_anime_media` filters on
  `hydrated_at`); everything else is served from AniList's CDN URLs.
- List imports: out-of-scope entries are reported as `outside_catalog` (counted as skipped,
  listed by name under "left out"), unknown titles are fetched as lean pages of 50 and queue
  their details. **Not built:** parked entries and the preview/confirm step (§4.2, §4.4). Once
  the sweep has run, nearly every entry resolves locally, so they were left for later.
- Scope is configured in settings (`CATALOG_COUNTRIES`, `CATALOG_EXCLUDED_FORMATS`), not
  in the admin. `manage.py catalog rescope` re-applies it to stored rows.
- Removed: the offline-database import and reconcile pipeline, `sync_anime_catalog` and its
  five beat entries, `admin_import_jobs_service`, the offline-sync admin API, the
  `sync_anime`/`import_anime` commands, and the admin Catalog imports and Sync health pages
  (both redirect to `/admin/catalog-sync`). Migration 0065 also drops the theme columns
  0055 left behind.

After deploy everything starts on its own: the sweep's hourly entry begins the first sweep
within the hour, and the delta lane runs within 15 minutes. To fill the Browse shelves right
away, open **Admin → Catalog sync** and press **Run now** on Seasons (about 10 requests).
The sweep fills the whole catalog in about an hour of short slices.

## 1. What is actually wrong

Every claim here was checked against the code on `main` (014e38afd2) and the live AniList API
on 2026-11-26.

### 1.1 Why there are only 205 anime after two days

Nothing in the system imports the catalog. Rows only show up as a side effect of other work:

| Path | What it really does |
|---|---|
| `sync-trending-hourly` | Saves AniList's top 50 trending. It is almost the same 50 every hour, so it adds a few rows a day. This is the only scheduled job that creates anime. |
| `sync-seasonal-daily`, `sync-upcoming-weekly` | **No-ops.** `SyncAnimeCatalogTask._run_sync` calls `CatalogSyncService.get_seasonal_anime_ids`, which reads IDs from the local table and returns them. Nothing is fetched or written. |
| `derive-airing-hourly`, `sync-popular-weekly` | **No-ops**, the same way (`get_airing_anime_ids`). These are the "Anime Model Fields · Airing" rows that fill the admin jobs page every hour. |
| `reconcile-offline-catalog-sync-hourly` | Re-enriches rows that already exist, one AniList request per anime. It never adds a row. These are the "Offline Sync Reconcile" rows. |
| User list imports | Every title on a user's list that we don't have is fetched from AniList and **created**, up to 500 per import (`BaseImporter.MAX_UNKNOWN_FETCHES`), with no scope check. This is the main way the catalog grows today. |
| "Anime offline database" import | Manual only, and it was never run in prod: the jobs list has no run of it. If it were run, it would insert about 40k raw rows (music videos, CMs, PVs, donghua, all of it). Each row then needs one AniList request to enrich (`OfflineSyncService._run_metadata_stage`), which is about 22 hours at 30 requests a minute. |

### 1.2 Why "Upcoming next season" is nearly empty

The shelf is a local query: `season = next season` on the `Anime` table. Nothing ever asks AniList
what is airing next season (see the no-ops above), so the shelf only shows the 3 rows that happened
to arrive through trending or a user import. AniList currently lists **87 non-adult titles for
Winter 2027** (checked live). "Popular this season" has the same problem, with less visible damage.

### 1.3 Where the "manhwa" comes from

- The code never imports manga. Every list and media query uses `type: ANIME`, and relation edges
  are filtered to `ANIME` (`relation_links.py:26`).
- What does get in is **animation from China, Korea and Taiwan** (donghua and aeni; AniList tags them
  `countryOfOrigin: CN/KR/TW`), plus anything else that was on someone's list. User imports and
  trending call `save_anime_to_db` with no scope policy. Nothing in the backend reads
  `countryOfOrigin`, and the field isn't even requested.
- Watch out: a Japanese anime *adapted from* a manhwa is still anime. Omniscient Reader is
  `countryOfOrigin: JP` on AniList, and so is Solo Leveling. A country filter removes donghua and
  aeni, not these. If the complaint is about titles like these, it is a different decision (see §7).

### 1.4 Why the admin jobs page is a mess

- The page lists raw `CeleryTaskResult` rows for 4 task names. About 75 of them a day are the hourly
  no-ops above.
- "New import" offers 4 sources with internal knobs (release tag, batch size, enrichment chunk,
  resume) that no admin can judge. "AniList catalog slice" offers `seasonal / next_season / airing /
  full_catalog`, which are the no-ops again.
- Three tracking systems overlap: `OfflineCatalogImport`, `OfflineAnimeSyncState` (with
  quarantine), and `CeleryTaskResult` plus `admin_import_jobs_service` (586 lines) gluing them back
  together by time windows (`find_matching_offline_run`).

### 1.5 Hard limits found while checking AniList (these shape the design)

- **Rate limit: 30 requests/min** (`X-RateLimit-Limit: 30`, the API is officially "degraded").
- **Paging stops at 5,000 results** per query: "Page depth exceeds maximum allowed for API requests
  (5000 entries)". `pageInfo.total` is fake (always 5000). So "page through everything" cannot work.
- There is no `id_greater`. There are `startDate_greater/lesser`, `countryOfOrigin`,
  `countryOfOrigin_in/not_in`, `format_in/not_in` and `isAdult`, plus sorts `ID` and
  `UPDATED_AT_DESC`, and a `Media.updatedAt` field. Bulk edits on AniList give many rows the same
  `updatedAt`.

### 1.6 What is good and stays

The user-list merge in `apps/users/services/import_service/base.py` is solid. It is
non-destructive, timestamp-aware, batched, resumable and cancel-safe, and it has a real
incremental AniList sync with a cursor. The rebuild changes how titles are *resolved*, not how
entries are *merged*.

## 2. How comparable sites do it

- **AniChart / LiveChart**: the season is the main object. Every announced title for the current
  and next seasons is shown, and refreshed often. Users judge the site by the upcoming season more
  than by the back catalog.
- **Trackers built on AniList (Seanime, Hayase, MAL-Sync, Taiga)**: they never mirror the long tail
  in detail. They hold a light index of every title and fetch details when a title is opened or
  becomes relevant.
- **Simkl / Kitsu / AniList's own MAL import**: list import is a two-step flow: preview, then
  confirm, with a conflict rule ("keep mine" / "overwrite"), plus a clear unmatched report. Titles
  that are not in the catalog are never invented from the user's list. They are queued, and the
  entry is applied once the catalog has them.
- **Everyone** keeps a source-ID index (AniList ↔ MAL) as the matching key. AniList already returns
  `idMal`, so for us the manami offline database is redundant.

## 3. The design: one catalog engine, one source, five lanes

AniList becomes the only catalog source. Everything goes through one `CatalogEngine` with a **scope
policy**, a **budgeted request scheduler**, and **lanes** that each own one kind of freshness.

### 3.1 Scope policy (one function, used by every write path)

```python
# apps/animes/catalog/scope.py
def in_scope(media) -> ScopeVerdict:
    # type == ANIME
    # countryOfOrigin in settings.CATALOG_COUNTRIES   (default {"JP"})
    # format not in settings.CATALOG_EXCLUDED_FORMATS (default {"MUSIC"})
    # isAdult handled by the existing adult gate (stored, hidden by default)
```

The same check runs inside the AniList queries (`countryOfOrigin_in`, `format_not_in`), so we never
spend requests on titles we would throw away. Rows already stored that fail the policy get
`Anime.catalog_excluded = <reason>` and drop out of `public_queryset()`. Nothing is deleted, so
users' list entries keep working. This replaces `offline_sync_state.quarantined`.

### 3.2 Lanes

| Lane | Query | Cost | Schedule |
|---|---|---|---|
| **Seed** (backfill everything in scope) | `media(countryOfOrigin_in, format_not_in, startDate_greater:Y0000, startDate_lesser:Y+10000, sort:ID)`, one window per year (each well under the 5,000 cap), plus one `status: NOT_YET_RELEASED` pass for titles with no date yet. Lean fields only, 50 per page. | ~18–20k titles ≈ 400–450 requests ≈ **15–20 min** at 25 req/min | Once, then a weekly re-sweep that resumes year by year |
| **Delta** (anything AniList edited) | `sort: UPDATED_AT_DESC`, stop at cursor − 1h overlap; dedupe by id | Usually 1–3 requests | Every 15 min |
| **Seasons** | Previous, current and next season, every page, lean fields | ~6–10 requests | Every 6 h, and on demand |
| **Airing** | Existing `get_airing_by_ids` (50 per request) for status=airing | ~3 requests | Hourly (already works) |
| **Trending / popular ranks** | Top 100 `TRENDING_DESC` and `POPULARITY_DESC` ids → rank columns only | 4 requests | Hourly |
| **Hydrate** (details) | Full payload: characters, staff, relations, recommendations, 25 per request by `id_in` | Per demand | Queue: titles opened by users, titles added to lists, top 2,000 by popularity, new seasonal titles |

"Lean fields" means ids, titles, synonyms, format, status, episodes, duration, dates,
season/year, genres, top tags, main studio, description, cover/banner URLs, averageScore,
popularity, isAdult, countryOfOrigin, nextAiringEpisode, updatedAt, and relation edges as id+type
only. These are the fields every card, shelf, filter and the schedule need. Detail-only fields come
from the hydrate lane.

### 3.3 One request scheduler, one budget

A single token bucket in Redis at 25 req/min (5 kept back for interactive detail fetches), shared by
every lane and by user imports. Lanes take slots by priority: interactive > airing > seasons >
user-import resolution > delta > hydrate > seed. `Retry-After` and `X-RateLimit-Remaining` drive
the bucket (most of this exists in `AniListRateLimiter` already). The two private copies of the
AniList HTTP code (the user-import `AniListFetcher` and the catalog client) merge into the one client.

### 3.4 Images

Covers and banners are served from the stored AniList CDN URLs (`cover_image_external_url` exists
already). Mirroring to MinIO moves from "every saved row" to "hydrated rows". Otherwise a seed of
20k titles would queue around 40k downloads. To verify in phase 1: the frontend's fallback when a
mirrored image is missing.

### 3.5 Data model (fewer tables, not more)

- **New `CatalogRun`**: lane, trigger (`schedule` / `admin` / `import`), status, started/finished,
  requests used, created/updated/excluded counts, cursor in/out, error. One row per lane run. This is
  what the admin page lists.
- **New `CatalogCursor`**: one row per lane (seed year in progress, delta `updatedAt` cursor, last
  season sweep).
- **New on `Anime`**: `country_of_origin`, `anilist_updated_at`, `hydrated_at`, `catalog_excluded`.
- **Deleted**: `OfflineCatalogImport`, `OfflineAnimeSyncState`, `Anime.offline_db_payload`,
  `offline_db_last_seen_at`, `offline_db_last_update`, `source_urls`, `metadata_checked_at` (replaced
  by `hydrated_at`).

## 4. User list import v2

1. **Resolve against the full catalog.** Once the seed has run, nearly every list entry matches
   locally by `anilist_id` or `mal_id` without any request. The 500 inline fetches go away.
2. **Never create catalog rows from a user's list.** An unknown id goes to the hydrate queue with
   high priority, and the entry is **parked** (a new `ParkedListEntry` row holding the
   `ImportedEntry` payload). When the hydrate lane saves that title, parked entries for it are merged
   with the same `merge()`. The user sees "12 titles are being added to the catalog; they'll appear
   in your list shortly" instead of a failure.
3. **Out-of-scope entries** (donghua, music videos) are skipped with reason `outside_catalog` and
   listed in the report by name, so nothing silently disappears and nothing pollutes the catalog.
4. **Preview, then confirm.** Step 1 loads and resolves the list (no writes) and shows: *642 found ·
   598 new · 31 updates · 9 conflicts · 4 being added to catalog · 0 skipped*. Step 2 picks the
   conflict rule (**newest wins** (default, today's behaviour) / **keep mine** / **take theirs**) and
   writes. The preview is cached on the job, so confirming doesn't re-fetch.
5. Sources stay AniList (username, with linked incremental sync), MAL API (username) and MAL XML.
   The per-source parsers in `entries.py` stay as they are.

## 5. Admin: one "Catalog" page instead of "Catalog imports"

- **Health header**: *18,412 titles · Winter 2027: 87/87 · Fall 2026: 142/142 · last change from
  AniList 6 min ago · AniList budget 25/min, 3 used*. Season coverage compares our count with
  AniList's for the same scoped query, so a gap shows up as a number.
- **Lanes**: one row each with last run, next run, result, and a "Run now" button. No batch sizes,
  release tags or chunk knobs.
- **Run log**: `CatalogRun` rows only. No-op runs (delta found nothing) collapse into one line, "no
  changes since 14:15", so the log shows events, not heartbeats.
- **Scope settings**: countries and excluded formats, with a preview of how many stored rows would
  be hidden before saving.
- **Title tools** (already partly there): re-hydrate one title, exclude or include one title by hand.

## 6. What gets deleted

About 4,500 lines of backend code plus their tests (≈2,500 test lines):
`services/offline_catalog*.py` (4 files, ~1,650), `offline_sync.py` + `offline_sync_policy.py`
(~780), `tasks/offline_catalog.py` (445), `catalog_sync.py` (221),
`tasks/sync.py` slice types, `tasks/metadata.py` backfill mode,
`core/services/admin_import_jobs_service.py` (586) + `admin_import_jobs.py` view,
`users/services/import_service/anilist_fetch.py` (folded into the shared client),
`management/commands/sync_anime.py` (455, replaced by a `catalog` command with `seed|delta|seasons|hydrate`),
and the five dead beat entries. Replaced by `apps/animes/catalog/` (scope, scheduler, lanes, runs),
estimated at ~1,200 lines.

## 7. Decisions needed before building

1. **Scope countries**: JP only (recommended), or JP + an opt-in toggle for CN/KR? Do you want to
   name a specific title that bothered you? If it is a JP-made manhwa adaptation (Omniscient Reader,
   Solo Leveling), a country filter will *not* remove it, and filtering on `source` would wrongly drop
   real anime.
2. **Formats**: drop `MUSIC` only (recommended), or also hide `SPECIAL`/`OVA` from shelves (kept in
   the catalog and on franchise pages)?
3. **Existing out-of-scope rows**: hide them (recommended; users' list entries stay intact) or
   delete them?

## 8. Rollout

- **Phase 0 (hotfix, one small PR, before the rebuild)**: make `seasonal` and `next_season` fetch
  from AniList (`get_by_season`, all pages, with the country filter) instead of reading the local
  table, and add the scope check to `save_anime_to_db` callers. This fills "Upcoming next season" and
  stops new donghua the same day.
- **Phase 1 – engine core**: scope, scheduler, `CatalogRun`/`CatalogCursor`, the seasons, trending
  and airing lanes, migrations for the new `Anime` fields, and a backfill of `country_of_origin` for
  existing rows (205 rows, 5 requests).
- **Phase 2 – seed + delta**: year-window seed, `UPDATED_AT_DESC` delta, weekly re-sweep, lean
  mapper. Run the seed once in prod (~20 min).
- **Phase 3 – hydrate + images**: hydrate queue and triggers, image mirroring only for hydrated rows.
- **Phase 4 – user import v2**: catalog-first resolution, parked entries, `outside_catalog`, the
  preview/confirm API, and the `ImportPage` UI.
- **Phase 5 – admin Catalog page**, then delete the offline DB pipeline, the reconcile job, dead
  beat entries, `admin_import_jobs_service`, and the old models (data migration first).

Each phase is shippable on its own, and the site keeps working between them.
