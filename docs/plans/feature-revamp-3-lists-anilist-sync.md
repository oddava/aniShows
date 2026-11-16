# Feature revamp 3: Lists & AniList sync
> Base: backend fix/anilist-only-and-fixes@17f082a, frontend feat/visual-ux-overhaul@ab5b3c2. Planning only.
> Note: `fix/anilist-only-and-fixes` has since moved to 4fa2d14 (separate web/background AniList counters in
> `rate_limiting.py`, animes migration 0057). Implement on the latest tip; nothing below depends on 4fa2d14.
> WT's backend is pre-slim (still imports `JikanService` in `apps/users/services/{celery_tasks,import_service/base}.py`);
> SLIM is the backend truth.

## Summary
The list is the app's daily core (add, +1 episode, score, finish), and today it is truncated: the profile list tab,
Overview genre sidebar and Insights read only the first 20 rows per status, the activity filter returns nothing, the
JSON preview on /export crashes, and every list save rewrites the `Anime` row, which flushes the public collection
cache. Imports drop dates, rewatches and notes, mis-scale AniList scores, overwrite local edits, can't actually be
cancelled, and are killed by the 600 s Celery default without being marked failed. This group: (1) makes the list API
complete (server-side paging/search/sort, a single summary endpoint, upsert-on-create, consistent status transitions
with auto dates, DB constraints); (2) moves list writes in the frontend onto one shared mutation hook with honest
errors and undo; (3) makes imports correct, bounded, batched against the AniList budget, cancellable and resumable;
(4) adds a pull-only "Linked AniList" sync (manual Sync now + opt-in daily), and defers push-to-AniList.

## Current state

### Models (SLIM)
| Model | File | Notes |
|---|---|---|
| `UserAnimeList` | `apps/users/models.py:77-112` | status stored as display strings (`"Plan to Watch"`, `:78-83`); `score` int, `episodes_watched`, `notes` Text, `started_at`/`finished_at` Date, `total_rewatches`, `is_rewatching`, `updated_at auto_now`; `unique_together(user, anime)` `:98`; 8 indexes `:100-109`; no CHECK constraints |
| `UserActivity` | `apps/users/models.py:115-147` | types added/status_change/progress/score/completed/removed/rewatching/notes_update; old/new status/episodes/score, notes |
| `UserImportJob` | `apps/users/models.py:150-190` | status pending/processing/completed/failed (no cancelled); counters; `errors` JSON list; `source_identifier` |
| `UserStats` | `apps/users/models.py:211-244` | materialized counters incl. follow/favorite/review counts (G5 domains, computed here) |
| `EpisodeRating` | `apps/animes/models/user_data.py:92-115` | 0.5–5.0 decimal, unique (user, anime, episode_number) |
| `UserHistory` | `apps/animes/models/user_data.py:75-89` | **no writer anywhere**; read only by `admin_api/services/dashboard_service.py:102` and `animes/admin.py:542` |

### Endpoints (all under `/api/v1/`, `apps/users/urls.py`; post-seams: `apps/users/urlconf/{lists,imports}.py`)
| Method + path | View | Service |
|---|---|---|
| GET/POST `lists/`, GET/PATCH/PUT/DELETE `lists/{id}/` (`?username=&status=`) | `views/lists.py:17` `UserAnimeListViewSet` | `services/list_service.py:82-140`; serializer `serializers/users.py:458-542` (post-seams `serializers/lists.py`) |
| GET `activity/` (`?username=&type=`), GET `activity/heatmap/` | `views/activity.py:9` | `services/activity_service.py:48-121` |
| GET `users/me/stats/` | `views/users.py:113` (G1) | `services/user_stats_service.py:20-38` |
| POST `import/mal/`, `import/mal/xml/`, `import/anilist/` | `views/import_export.py:56-160` | `services/import_job_service.py:108-165` |
| GET `import/jobs/`, `import/jobs/{id}/`, POST `import/jobs/{id}/cancel/` | `views/import_export.py:186-215` | `import_job_service.py:168-184`; serializer `animes/serializers/imports.py` |
| GET `export/?type=json|xml&download=`, GET `export/json/` | `views/import_export.py:162-183` | `services/export_service.py` |
| GET `anime/{slug}/episode-ratings/`, PUT/PATCH/DELETE `anime/{slug}/episode-ratings/{n}/`, GET `anime/{slug}/watch-episodes/` | `animes/views/anime.py:369-445` (G2 view, G3 contract) | `animes/services/episode_ratings.py` |

### Signals / side effects
`apps/animes/signals.py:220-259`: pre_save snapshot (1 SELECT), post_save activity log (on_commit, 2 s exact-match dedupe
`user_list_side_effects.py:93-126`), post_save/delete → `handle_user_anime_list_change` (`:244-258`): stats refresh
(countdown 2, deduped by `cache.add`, `users/tasks.py:25-56`), recommendations debounce 300 s (`:225-241`), and
on_commit `update_anime_status_distribution` (`:52-90`) which does `anime.save(update_fields=["status_distribution"])`.
Imports set `_skip_activity` (`import_service/base.py:209,218`), which also skips the distribution/stats/cache path.

### Celery
`process_import_job` (`users/tasks.py:82-96`, queue `critical` `root/celery.py:56`, no time-limit preset → global
600/540 s `root/celery.py:152-153`); `fetch_anime_by_external_id` (`tasks.py:99-122`; **never called**);
`update_user_stats` (quick preset), `update_all_user_stats` (beat `update-user-stats-hourly`,
`root/settings/celery_schedule.py:101-105`); `run_user_maintenance_workflow` (beat `user-maintenance-daily` 07:00,
`:89-99`) → `cleanup_old_import_jobs`, `cleanup_unverified_accounts` (G1). Snapshot: `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json:220-240`.

### Import pipeline
`ImportService.create_importer` (`import_service/__init__.py:12-34`) → `AniListImporter` (`anilist.py`, raw `requests`
+ private throttle keys `:23-25,60-97`), `MyAnimeListAPIImporter` (`mal_api.py`, `requests`, `MAL_CLIENT_ID` env),
`MyAnimeListXMLImporter` (`mal_xml.py`, `defusedxml`). Per entry: local lookup mal_id → anilist_id → `title__iexact`
(`base.py:90-109`), else one AniList call (`get_anime_by_id` / `search_by_mal_id`, `base.py:126-142`) + full
`save_anime_to_db` (cast, relations, image downloads, `providers/anilist/persistence.py:519-574`); missing IDs cached 6 h.
`save_entry` (`base.py:186-227`) writes status/score/episodes only. Limits: 1 active job, 5/day, XML ≤ 10 MB
(`import_export.py:25`), ≤ 5000 entries (`settings/base.py:484`), task payload ≤ 512 KB (`:485`).

### Frontend (WT)
| Piece | File | Query keys |
|---|---|---|
| List API | `api/modules/user.js:19-29,47-68` (post-seams `api/modules/{lists,activity,imports}.js`) | — |
| Queries | `api/queries/user.js:67-71,80-91,123-218` (post-seams `api/queries/lists.js`) | `['lists',u,status]`, `['lists',u,status,'overview']`, `['user','list','watching']`, `['activity-heatmap',u]`, `['activity-feed',u,type,size]`, `['profile-insights-lists',u]`, `['insights-lists',u]`, `['insights-reviews',u]` |
| Import jobs | `api/queries/importJobs.js` (2 s polling while active) | `['importJobs',uid,...]` |
| List writers | `StatusSelector.jsx` (detail page), `ListEntryEditModal.jsx`, `AnimeCard.jsx:205-292` (G2), `pages/Home.jsx:101`, `pages/AnimeDetail.jsx:131` | each calls `listApi` and invalidates differently |
| Profile list tab | `pages/Profile.jsx:210-217` (G1) → `components/profile/ProfileContent.jsx:203-468` `AnimeListContent` | `listQueries.byStatus` |
| Activity / heatmap / insights | `components/profile/ActivityFeed.jsx`, `ActivityHeatmap.jsx`, `ProfileInsights.jsx`, `profile/OverviewTab.jsx:223-240` (G1 shell, G3 data) | |
| Episodes | `components/EpisodesTab.jsx` via `animeDetail/AnimeDetailTabContent.jsx` (G2) | `animeKeys.watchEpisodes`, `episodeRatings` |
| Import/Export | `pages/ImportPage.jsx`, `pages/ExportPage.jsx` | |
| Dead | `components/ProfileAnimeCard.jsx` (no importer), `profile/ProfileStats.jsx` (imported `ProfileContent.jsx:7`, never rendered) | |

### Tests
Backend: `users/tests/test_list_entries.py` (4 list tests), `test_activity_tracking.py` (activity + heatmap + feed),
`test_import_service.py` (rate-limit retries, missing cache, limits, token redaction, retries),
`animes/tests/test_episode_tracking.py`, `test_episode_ratings.py`. `test_concurrency.py` covers follows/refresh only.
No query budget covers `/lists/`, `/activity/`, imports. Frontend: `StatusSelector.test.jsx`, `ListEntryEditModal.test.jsx`,
`EpisodesTab.test.jsx`, `StatusDistribution.test.jsx`, `api/queries/__tests__/importJobs.test.js`.

## Problems found
| ID | Sev | Area | Problem | Evidence path:line | Fix ref |
|---|---|---|---|---|---|
| L1 | High | List UI | Profile list tab shows only page 1 (20 rows) per status; "N Anime in X" and client-side search operate on those 20 | `api/queries/user.js:132-135`; `apps/shared/pagination.py:7-10`; `ProfileContent.jsx:215-222,272-273` | P0-1 |
| L2 | High | Insights | Overview genre sidebar and Insights compute from 5× page-1 full payloads | `api/queries/user.js:182-213`; `OverviewTab.jsx:223-240`; `ProfileInsights.jsx:121` | P1-1 |
| L3 | High | Perf/cache | Every list save runs an aggregate and `anime.save()`; Anime post_save bumps the global collection cache namespace + ~20 deletes and a pre_save SELECT, so any user's list edit flushes trending/top/browse caches | `user_list_side_effects.py:52-90,256-258`; `animes/signals.py:83-104,134-136,49-53` | P0-2 |
| L4 | High | Data | `Anime.status_distribution` has two writers with different keys: AniList sync writes `{"CURRENT":n,...}` (`providers/base.py:308`, asserted in `test_anime_persistence.py:97`), list side effects write site counts; the serializer only reads lowercase keys, so after any catalog sync the page shows 0 members until the next local edit, then flips to site counts | `providers/base.py:213-227,308`; `serializers/anime.py:366-382`; `user_list_side_effects.py:88-90` | P0-2 |
| L5 | High | Imports | Hard time limit 600 s; soft limit (SoftTimeLimitExceeded is an `Exception`) is swallowed by the per-entry `except Exception`, then SIGKILL leaves job `processing` forever, which blocks all future imports (1 active job) and cleanup never deletes it | `users/tasks.py:82`; `root/celery.py:152-153`; `anilist.py:305-308`; `mal_api.py:217-220`; `import_job_service.py:43-54`; `celery_tasks.py:188-193` | P0-3 |
| L6 | High | Imports | Cancel only flips status to failed; the running loop never checks it, then sets `completed` and overwrites `errors` (drops "Cancelled by user") | `import_job_service.py:168-180`; `base.py:254-269`; `anilist.py:317-319` | P0-3 |
| L7 | High | Imports | AniList score mapping: `score>10 → //10` keeps POINT_100 values 1–10 as-is (5/100 → 5/10) and leaves POINT_5/POINT_3 unscaled; decimals truncated | `anilist.py:37,254-257` | P0-4 |
| L8 | High | Imports | Import silently overwrites existing local entries (status/score/episodes) regardless of which side is newer; score 0 from source wipes local score | `base.py:218-223` | P0-4 |
| L9 | Med | Imports | Dates, rewatch count/flag and notes not requested or saved (AniList query, MAL fields, XML tags) | `anilist.py:28-53`; `mal_api.py:49`; `mal_xml.py:26-32`; `base.py:186-208` | P0-4 |
| L10 | Med | Imports | Unknown titles fetched one AniList request each, with full cast + image download, serially through the background budget (~25 req/min at 30); a 1,000-unknown list ≈ 40 min, past the time limit | `base.py:126-152`; `rate_limiting.py:28-49`; `persistence.py:563-567` | P1-3 |
| L11 | Med | Imports | AniList list fetch bypasses the shared limiter/breaker/metrics (own `requests` client + `import:anilist:list:*` keys), so it is invisible to the catalog budget though AniList limits per IP | `anilist.py:5,60-97,121`; `rate_limiting.py:28` | P1-3 |
| L12 | Med | Imports | Title fallback `Anime.objects.get(title__iexact=)` runs even when stable IDs exist: can bind a remake/sequel with the same title; `MultipleObjectsReturned` uncaught | `base.py:104-109` | P0-4 |
| L13 | Med | Imports | XML > 512 KB rejected as "payload too large" though the UI/server say 10 MB; ~700-entry MAL exports fail. XML is carried in the broker message; admin/autoretry requeue of an XML job has no content | `import_export.py:25,99-105`; `import_job_service.py:67-74,130,139`; `__init__.py:287-295` | P1-4 |
| L14 | Med | Imports | MAL exports are `.xml.gz`; only `.xml` accepted (front and back) | `import_export.py:92`; `ImportPage.jsx:205` | P1-4 |
| L15 | Med | Imports | AniList custom lists repeat entries in `MediaListCollection` (AniList behaviour, unverified here); importer flattens all lists without dedupe → double processing and inflated totals | `anilist.py:222-236` | P0-4 |
| L16 | Med | Imports | After import: no profile-cache/heatmap invalidation, no distribution refresh, frontend does not invalidate list queries | `base.py:229-242`; `user_list_side_effects.py:245`; `ImportPage.jsx:128` | P1-4 |
| L17 | Med | Imports UX | Failure toast shows `errors[0]` (oldest entry error), while the fatal reason is appended last | `ImportPage.jsx:122`; `anilist.py:330` | P1-4 |
| L18 | Med | Security | `access_token` accepted by the API and carried in plaintext in the Redis broker message (redacted only in result backend); UI never sends it | `import_export.py:131,148-155`; `import_job_service.py:161`; `ImportPage.jsx:189` | P0-5 |
| L19 | High | Export | JSON preview always throws: `/export/json/` defaults `download=true` → raw JSON body; page does `JSON.parse(response.data.data)` | `import_export.py:166,176-183`; `ExportPage.jsx:89-90` | P0-6 |
| L20 | Med | Export | MAL XML: title in CDATA unescaped (`]]>` breaks file), dates always `0000-00-00`, comments/times_watched/rewatching dropped, `series_animedb_id 0` for non-MAL anime (unimportable elsewhere) | `export_service.py:175-193` | P1-6 |
| L21 | Low | Export | JSON export omits episode ratings, character/staff favorites, follows; naive `datetime.now()` | `export_service.py:20-33,25,230` | P1-6 |
| L22 | Med | Activity | Feed filter sends `type=<status>` (watching/plan_to_watch) but backend filters `activity_type`, so every non-"All" filter returns empty pages | `ActivityFeed.jsx:20-26,296`; `activity_service.py:59-61` | P0-7 |
| L23 | Low | Activity | Binge +1 clicks create one row per episode (by design, `test_activity_tracking.py:119`); feed noise. `SCORE_CHANGE`/`NOTES_UPDATE` never produced; `_old_score`/`_old_notes` captured unused | `user_list_side_effects.py:184-193`; `signals.py:227-229` | P1-7 |
| L24 | Low | Heatmap | Day bucketing in UTC, not the user's timezone | `activity_service.py:90` | P2-3 |
| L25 | Med | Validation | No DB constraints (score 0–10, non-negative counts, date order) (AUDIT item 7); `notes` unbounded | `models.py:85-93`; `docs/AUDIT.md:187`; `serializers/users.py:470` | P0-8 |
| L26 | Med | Validation | Transitions inconsistent across layers: backend auto-completes on full progress but never sets dates, never un-completes on lower progress, never handles rewatch completion; frontend StatusSelector zeroes progress on Plan to Watch and flips Completed→Watching itself; edit modal silently saves `cap-1` when status≠Completed | `serializers/users.py:503-512`; `StatusSelector.jsx:175-179,236-240`; `ListEntryEditModal.jsx:147-149` | P0-8 |
| L27 | Med | Concurrency | POST for an existing entry (stale card without `listId`) → 400 "already in your list"; UI only logs it | `list_service.py:109-115`; `AnimeCard.jsx:218-223`; `StatusSelector.jsx:197-199` | P0-8 |
| L28 | Med | UX/a11y | StatusSelector: no `aria-expanded`/`aria-haspopup`, no Escape, ±1 buttons unlabeled, episode input unlabeled, errors only `logger.error`, "Completed" icon `opacity-0` until hover (invisible on touch), glow shadows, viewport check not reactive | `StatusSelector.jsx:71,197-199,346-360,353,465-506,516-518` | P1-2 |
| L29 | Med | Perf (FE) | AnimeCard list actions invalidate `animeKeys.all` + `seasonalKeys.all` (every anime query on the page refetches); +1 has no cap/auto-complete | `AnimeCard.jsx:134-137,226-228,264-292` | P1-2 |
| L30 | Low | UI | Profile status tabs carry emoji icons (unused but present), no `aria-pressed`; `rewatch` cannot be started from any UI (`is_rewatching` unused in frontend) | `ProfileContent.jsx:20-26,227-238` | P1-1 |
| L31 | Low | API | Home "continue watching" sends `sort`/`limit` that the API ignores → 20 full rows instead of 6 | `api/queries/user.js:124-128`; `list_service.py:82-106` | P1-1 |
| L32 | Med | Stats | Two divergent implementations: inline fallback uses duration default 24 and skips follow counts; task uses 0 | `stats_service.py:87-94,136-162`; `celery_tasks.py:283-297` | P1-5 |
| L33 | Low | Episodes | Episode tab has no watched state or "watched through EP n" action; rating route `\d+` with unknown episode count accepts any int (overflow → DB error, unverified) | `EpisodesTab.jsx:69-166`; `episode_ratings.py:97-103`; `animes/views/anime.py:413,418` | P1-8 |
| L34 | Low | Dead code | `fetch_anime_by_external_id` task + service + route never called; `remove_duplicate_lists` redundant with `unique_together`; `invalidate_user_anime_caches`/`invalidate_anime_detail_cache` delete keys nothing writes; `UserHistory` never written; `ProfileAnimeCard.jsx`, `ProfileStats.jsx`; cancel's `except DoesNotExist` unreachable | `tasks.py:99-122`; `celery_tasks.py:147-183`; `root/celery.py:71`; `management/commands/remove_duplicate_lists.py`; `services/cache.py:67-85`; `user_data.py:75`; `import_export.py:201-208` | P1-9 |
| L35 | Low | Deps | `requests` used only by importers (+ G1 social_auth); retry classifier only knows httpx | `anilist.py:5`; `mal_api.py:5`; `users/tasks.py:64-73` | P1-3 |
| L36 | Low | Cache | Recommendation debounce `get`+`set` is not atomic (double schedule under concurrency) | `user_list_side_effects.py:225-235` | P1-7 |
| L37 | Low | Tests | No query budget for `/lists/`, `/activity/`, imports; no list concurrency test; no export tests | `animes/tests/test_query_budgets.py`; `users/tests/test_concurrency.py` | Test plan |
| L38 | Info | Jikan | No Jikan/Mongo/Typesense references remain in G3 files on SLIM (grep of `apps/users`, G3 animes files, G3 frontend files). WT backend still has `JikanService` in `users/services/{celery_tasks,import_service/base}.py` (pre-slim base) | `git diff d961659 17f082a -- apps/users` | Base on SLIM |

## Proposed scope

### P0 (bugs, data integrity, security)
- **P0-1 Complete list paging + server search/sort (M).** `get_user_anime_list_queryset` accepts `q` (icontains on
  `anime__title`, `anime__title_english`, `anime__title_jp`; user lists are small so no trigram needed), `ordering`
  in {`-updated_at`(default), `title`, `-score`, `-progress`, `started_at`, `-finished_at`} (progress = annotated
  `episodes_watched*100/NULLIF(episode_count,0)`), and validates `status` against choices (400 on unknown). Frontend
  list tab becomes `useInfiniteQuery` (page_size 50) with debounced server search, sort `CustomSelect`, count from
  `count`, "Load more" via `Pagination`-style button. Files: `list_service.py`, `views/lists.py`,
  `api/modules/lists.js`, `api/queries/lists.js`, `components/profile/tabs/AnimeListTab.jsx` (+ request G1 to pass
  `username` only, see contracts).
- **P0-2 Stop writing `Anime` on list changes (M).** Delete `update_anime_status_distribution`'s `anime.save()` path.
  New `apps/animes/services/user_list_side_effects.py::site_status_counts(anime_id)` = one aggregate on
  `UserAnimeList(anime_id, status)` (index exists `models.py:103`), cached at `site_status:v1:{anime_id}` 10 min,
  deleted on_commit by the list receivers (one `cache.delete`, no namespace bump). `Anime.status_distribution` is left
  to the provider (AniList global counts). Request G2 to expose `site_status_distribution` from this service and to
  normalize AniList keys for `status_distribution` (see contracts). Files: `user_list_side_effects.py`, `animes/signals.py` (UserAnimeList receivers only).
- **P0-3 Import jobs that end (M).** `process_import_job` gets `time_limit_preset="long"` (3600/3300). Importers
  re-raise `SoftTimeLimitExceeded` (catch it before the per-entry `except Exception`) and mark the job failed with
  `failure_reason="Took too long; N of M processed. Run it again to continue."`. New status `cancelled`; cancel is
  `UserImportJob.objects.filter(pk, status__in=active).update(status=cancelled)`; importers check
  `refresh_from_db(fields=["status"])` on every progress flush and stop, never writing `completed` over `cancelled`
  (final save is a conditional `update(... ).filter(status=processing)`). `heartbeat_at` updated on each flush;
  `cleanup_old_import_jobs` also marks `processing` jobs with `heartbeat_at` older than 2 h as failed ("worker
  stopped"), and deletes `cancelled` after 30 days. Files: `users/tasks.py`, `celery_tasks.py`, `import_service/*`,
  `import_job_service.py`, `models.py`.
- **P0-4 Correct, non-destructive entry mapping (M).** One `ImportedEntry` dataclass (status, score_10, progress,
  started, finished, repeat, notes, remote_updated_at, ids) produced by each source; AniList query requests
  `score(format: POINT_100)` → `round(x/10)`, `startedAt`, `completedAt`, `repeat`, `notes`, `updatedAt`, `private`,
  and skips `isCustomList` lists / dedupes by `mediaId` (verify field names against the AniList schema); MAL API
  `list_status{status,score,num_episodes_watched,start_date,finish_date,num_times_rewatched,is_rewatching,comments,updated_at}`;
  XML `my_start_date`, `my_finish_date` (`0000-00-00` → None), `my_times_watched`, `my_rewatching`, `my_comments`.
  Merge policy (default): create missing entries; for existing entries apply the remote only if
  `remote_updated_at > local.updated_at` (XML has no timestamp → only fill empty local fields); never zero a local
  score with a remote 0; clamp progress to known `episode_count`; run the same transition normalizer as the API
  (P0-8). No title matching when a stable ID exists; title match only via `filter(...).first()` when no IDs at all.
  Files: `import_service/{base,anilist,mal_api,mal_xml}.py`, new `import_service/entries.py`.
- **P0-5 Drop the AniList access token from imports (S).** Remove `access_token` from view, job service, importer and
  `api/modules/imports.js`; private AniList lists get a clear message ("Make your AniList list public, or ... ").
  No credential ever enters the broker. Files: `import_export.py`, `import_job_service.py`, `import_service/__init__.py`, `anilist.py`, test `test_anilist_token_is_sent_to_worker_but_not_stored` replaced by "token field rejected/ignored".
- **P0-6 Export preview works (S).** `exportDataJSON` calls `/export/?type=json&download=false`; backend returns
  `{"data": <object>}` (not a JSON string); `ExportPage` reads it directly. Files: `import_export.py:176-177`,
  `export_service.py` (`export()` returns dict), `api/modules/imports.js`, `pages/ExportPage.jsx`.
- **P0-7 Activity filter returns rows (S).** Backend `build_activity_queryset` accepts `status=<display status>`
  (filters `new_status`, or `old_status` for `removed`) next to `type`; validate both against choices.
  `ActivityFeed` sends `status`, drops its client-side refilter. Files: `activity_service.py`, `ActivityFeed.jsx`.
- **P0-8 One transition normalizer + constraints + upsert (M).** New `services/list_rules.py::normalize_entry(instance_or_none, attrs, anime, today)` used by `UserAnimeListSerializer.validate` and the importers:
  - progress == known total and status ≠ Completed → Completed; status → Completed → progress = total (if known), `finished_at ||= today`, and if `is_rewatching`: `total_rewatches += 1`, `is_rewatching = False`.
  - status → Watching (or progress > 0 while Plan to Watch and status not sent) → Watching, `started_at ||= today`.
  - progress lowered below total on a Completed entry with no status in payload → Watching.
  - "Rewatch" = `is_rewatching=True` → status Watching, progress 0 (old progress kept in activity).
  - Plan to Watch keeps progress (no silent zeroing); frontend stops zeroing.
  - `today` = `timezone.localdate()` in `request.user.userprofile.timezone` when set (read-only use of a G1 field).
  - Bounds: `notes` ≤ 5,000 chars; dates ≤ today+1 and ≥ 1960-01-01; `episodes_watched` ≤ 10,000 when total unknown.
  - POST for an existing (user, anime) updates it and returns 200 (idempotent), with `select_for_update` in a
    savepoint; first-insert race handled by catching `IntegrityError` inside `transaction.atomic()` and retrying as update.
  - DB `CheckConstraint`s (migration below). Files: `serializers/lists.py`, `list_service.py`, new `list_rules.py`.

### P1 (daily-use UX, correctness, tests)
- **P1-1 Lists summary endpoint + profile tabs on it (M).** `GET /api/v1/lists/summary/?username=` (privacy as list):
  `{counts: {status: n}, total, episodes_watched, minutes, mean_score, score_histogram: {1..10}, top_genres: [{name, slug, count}] (≤12), updated_at}`
  — 3 aggregate queries, cached `lists_summary:v1:{user_id}` 10 min, deleted on list change and after import.
  Overview genre sidebar, Insights and status-tab counts use it; Insights keeps only its charts. Status tabs: plain
  text labels (remove emoji), `aria-pressed`, counts in tabs. Home "continue watching" uses `page_size: 6`.
  List view rows show progress for all statuses and (own profile) an inline +1. Files: `views/lists.py` (`@action summary`),
  `list_service.py`, `api/queries/lists.js`, `components/ProfileInsights.jsx`, `components/profile/tabs/{AnimeListTab,InsightsTab}.jsx`, request G1 for OverviewTab sidebar call-site.
- **P1-2 Shared list mutation hook (M).** New `frontend/src/hooks/useListEntryMutation.js`:
  `useListEntryMutation({ anime: {id, slug, episode_count}, entry })` → `{ entry, setStatus, setProgress, increment, save, remove, startRewatch, isPending }`.
  Optimistic update, rollback, `react-hot-toast` error with server message, "Removed · Undo" toast (re-POST with the
  previous payload), +1 capped at total. Invalidates narrowly: `['lists']`, `profileKeys.own`, `['user','list','watching']`,
  `lists-summary` and own activity/heatmap keys, `animeKeys.bySlug(slug)` prefix — never `animeKeys.all`/`seasonalKeys.all`;
  patches `user_list_status` in cached anime lists via `setQueriesData` on `['anime']` entries whose items contain the id.
  StatusSelector rebuilt on it: disclosure button with `aria-expanded`/`aria-controls`, Escape + focus-out close (as
  the visuals branch's menus), labeled ±1 and `inputMode="numeric"` progress input, icons always visible, no glow
  shadows, `useMediaQuery` for the sheet, reduced-motion respected. ListEntryEditModal: title names the anime,
  rewatch toggle, notes counter (5,000), no silent clamp (server normalizer decides; modal shows the result).
- **P1-3 Batched, budget-aware catalog resolution for imports (M).** Pre-resolve in bulk: `Anime.objects.filter(anilist_id__in=)`,
  `filter(mal_id__in=)`, and the user's existing entries in one query; unknown IDs fetched in pages of 25
  (`FULL_MEDIA_PER_PAGE`, `client.py:112`) via `id_in` / `idMal_in` through the shared `AniListClient` (background
  budget, breaker, metrics) — requires integrator method (contracts); fallback if refused: G3 module uses
  `AniListRateLimiter().acquire()` + httpx. Persist without image download (images left to `heal_missing_anime_media`)
  if the integrator adds that flag. Cap `MAX_IMPORT_UNKNOWN_FETCHES = 500` per job (module constant); beyond it,
  entries are reported as `unmatched` with reason `not_in_catalog_yet`. Writes: `bulk_create` new entries and
  `bulk_update` changed ones in batches of 500 (no per-row signals; side effects done once, P1-4). Importers use httpx;
  drop the private `import:anilist:list:*` throttle. Files: `import_service/*`.
- **P1-4 Import UX + post-import refresh (M).** XML parsed once in the view into compact `ImportedEntry` dicts stored in
  `UserImportJob.payload` (cleared on finish), so the 512 KB broker cap no longer applies and requeue works; accept
  `.xml` and `.xml.gz` (stream-decompress with a 20 MB decompressed cap → 400 on overflow; defusedxml stays). One
  `MAX_IMPORT_XML_ENTRIES` cap (5,000) applied to all sources. Job stores `failure_reason` and up to 200 structured
  `unmatched` items (`{title, mal_id, anilist_id, reason}`). After import: one `invalidate_user_caches`, heatmap and
  summary cache delete, `site_status` cache deletes for touched anime, stats refresh, recommendations debounce.
  ImportPage: per-job card with progress bar, Cancel, `cancelled` state, failure reason, collapsible unmatched list,
  "Run again" (merge mode), file input `accept=".xml,.gz,application/xml,application/gzip"` with client-side 10 MB
  check; invalidates `['lists']`, summary, `profileKeys.own` when a job completes. Files: `import_export.py`,
  `import_job_service.py`, `animes/serializers/imports.py`, `pages/ImportPage.jsx`, `api/queries/importJobs.js`.
- **P1-5 One stats implementation (S).** `stats_service.compute_user_stats(user_ids) -> dict[user_id, data]` used by
  the task, inline fallback, `create_or_update_user_stats` and `populate_user_stats`; duration fallback 24 for
  `duration_minutes=0`; follow counts included everywhere. Files: `stats_service.py`, `celery_tasks.py`, `user_stats_service.py`, command.
- **P1-6 Export completeness (S).** JSON: add `episode_ratings`, `character_favorites`, `staff_favorites`,
  `following` (usernames), `export_metadata.version="2"`, aware timestamps. XML: escape titles (split `]]>`), real
  dates, `my_comments` (CDATA, escaped), `my_times_watched`, `my_rewatching`; entries without `mal_id` are skipped
  and counted in an XML comment and in the page copy. Files: `export_service.py`, `pages/ExportPage.jsx`.
- **P1-7 Activity hygiene (S).** Coalesce PROGRESS: if the user's latest activity for that anime is PROGRESS, created
  < 30 min ago and on the same UTC date, update its `new_episodes` instead of inserting (heatmap math unchanged).
  `select_for_update` on that row; dedupe via `exists()` kept for other types. Recommendations debounce via `cache.add`.
  Update `test_rapid_distinct_progress_updates_not_deduped` to assert coalescing. Files: `user_list_side_effects.py`.
- **P1-8 Episode tracking in the Episodes tab (S).** EpisodesTab receives `listEntry` and uses the hook: episodes ≤
  `episodes_watched` get a "Watched" marker (text + icon, not colour only); each row gets "Watched through here"
  (sets progress = n, normalizer may complete the entry); rating rejects `episode_number > 10000` when the count is
  unknown. Files: `EpisodesTab.jsx`, `episode_ratings.py`.
- **P1-9 Dead code removal (S).** Delete `fetch_anime_by_external_id` task + service method (request route removal),
  `remove_duplicate_lists` command, `ProfileAnimeCard.jsx`, `ProfileStats.jsx` (request G1 to drop the index.js export
  and import), stop calling the dead cache helpers (request G1 to delete them), cancel's unreachable `except`.
- **P1-10 AniList link + pull sync (M).** See "AniList sync design" below.

### P2 (nice-to-have)
- P2-1 Accept snake_case status aliases on input (`plan_to_watch` → "Plan to Watch"); API output unchanged (S).
- P2-2 One `imported` activity row per finished import ("Imported 312 entries from AniList") (S; adds a choice).
- P2-3 Heatmap buckets by the profile timezone (`TruncDate(..., tzinfo=)`) (S).
- P2-4 Drop redundant `UserAnimeList` indexes (`-updated_at`, `status,anime`, `anime,user`) after `pg_stat_user_indexes` on prod data (S).
- P2-5 Decide `UserHistory`: write it on detail views ("recently viewed") or delete it with G6 (S).
- P2-6 Export throttle (`ScopedRateThrottle` 10/h) — needs a rate in frozen settings; or a cache-based guard in the view (S).

### AniList sync design (P1-10) and recommendation
**Budget facts.** AniList limits per IP (`rate_limiting.py:28`: "90 requests per minute per IP", running degraded at
30). A user's own OAuth token does **not** give the server a separate budget: every request from the VPS, token or
not, counts against the same IP limit and our shared Redis counter. (The code holds no token path today besides the
import's optional header, `anilist.py:112-113`.) So any server-side sync must go through `AniListRateLimiter`'s
background budget (≈25 of 27 slots/min after 4fa2d14's web reserve).

**(a) Pull from a linked AniList username — build it.**
- Link: `PUT /api/v1/import/anilist/link/ {username, auto_sync}` validates the name (same regex), stores the link, and
  queues a full import (existing job pipeline, `mode=full`). `GET` returns `{username, auto_sync, last_synced_at, last_job}`;
  `DELETE` unlinks (keeps list data).
- "Sync now": `POST /api/v1/import/anilist/sync/` → `UserImportJob(source=anilist, mode=incremental)`; per-user
  cooldown 15 min (cache key), plus existing active/daily limits.
- Incremental fetch: `Page(page, perPage: 50) { pageInfo { hasNextPage } mediaList(userName, type: ANIME, sort: UPDATED_TIME_DESC) { ...entry fields } }`
  and stop at the first `updatedAt <= cursor` (store `cursor_updated_at` = max seen). Typical day: 1 request per
  user; unknown media batched 25/request (P1-3). (Verify `Page.mediaList` sort support against the schema.)
- Daily: no new beat entry. `run_user_maintenance_workflow` gains a step (default on, kwargs unchanged so the beat
  snapshot is unchanged) that queues `sync_linked_anilist_lists` on `low_priority`: links with `auto_sync=True`,
  owner `last_login` within 14 days, `consecutive_failures < 5`, processed sequentially with the background limiter,
  hard cap `ANILIST_DAILY_SYNC_MAX_LINKS = 300` per run (module constant), "long" time preset.
- Conflict policy: AniList wins for entries not edited locally since `last_synced_at`; if both changed, newer
  timestamp wins (`updatedAt` vs `updated_at`); never delete local entries (removals on AniList are not visible
  incrementally); counts of applied/kept-local reported on the job. Sync rows set `_skip_activity`; one summary
  activity if P2-2 lands.
- Failure: AniList 404 / private list → link `last_error`, `consecutive_failures += 1`, shown on ImportPage; 5 strikes
  disable auto-sync until the user re-saves the link.
- UI: an "AniList" card on ImportPage: linked username, last sync time, "Sync now" (disabled with reason during
  cooldown/active job), auto-sync toggle (a `role="switch"` button), unlink.

**(b) Push local edits to AniList (`SaveMediaListEntry`) — defer.** Reasons: it is per-user fan-out from the hottest
write path (+1 clicks) into the shared per-IP budget, needing a coalescing outbox (queue + debounce per entry) to be
safe; it needs OAuth (client registration, redirect route in frozen `routes.jsx`/`root/urls.py`) and storage of
long-lived bearer tokens — AniList access tokens are long-lived with no refresh and no fine-grained scopes (per
AniList docs, unverified in this repo), i.e. full-account credentials; at rest they would need Fernet encryption with
a key outside the DB (`cryptography` is already a dependency, `pyproject.toml:16`), revocation on unlink/account
delete, and log/Sentry scrubbing; plus two-way conflict resolution. If ever built, prefer a browser-side push (the
SPA calls AniList with an implicit-grant token held in memory, so requests count against the user's IP, and no token
reaches our server), with server-side outbox only as a later step.

**Recommendation:** ship (a) as P1-10 with manual "Sync now" + opt-in daily; explicitly out of scope: (b).

### Out of scope
Push sync / OAuth (above); MAL two-way sync; changing stored status strings to enum keys (contract churn across G2/G5,
data migration of every row; P2-1 covers input); per-episode watch history table; Anime model fields; catalog
provider internals; notifications for friends' activity (G4); review/favorite domain (G5).

## File ownership
Backend (SLIM paths; post-seams):
- `apps/users/models.py`: `UserAnimeList`, `UserActivity`, `UserImportJob`, `UserStats` (+ new `UserListLink`, pending approval)
- `apps/users/views/{lists,activity,import_export}.py`
- `apps/users/serializers/lists.py` (post-seams home of `UserAnimeListSerializer`, `UserActivitySerializer`); `apps/animes/serializers/imports.py`
- `apps/users/urlconf/{lists,imports}.py`
- `apps/users/services/{list_service,activity_service,import_job_service,export_service,stats_service,user_stats_service,celery_tasks}.py`, `services/import_service/*` (+ new `entries.py`, `anilist_sync.py`), new `services/list_rules.py`
- `apps/animes/services/{user_list_side_effects,episode_ratings}.py`; UserAnimeList receivers in `apps/animes/signals.py` (lines 220-259 only)
- `apps/users/tasks.py`: `process_import_job`, `fetch_anime_by_external_id` (delete), `cleanup_old_import_jobs`, `run_user_maintenance_workflow`, `update_user_stats`, `update_all_user_stats`, new `sync_linked_anilist_lists`
- `apps/users/management/commands/{remove_duplicate_lists (delete),populate_user_stats}.py`
- Migrations: `apps/users/migrations/0038_lists_entry_constraints_import_job.py`, `0039_lists_anilist_link.py`
- Tests: `apps/users/tests/{test_list_entries,test_activity_tracking,test_import_service}.py` (extend), new
  `test_list_rules.py`, `test_list_api_budgets.py`, `test_list_concurrency.py`, `test_anilist_sync.py`,
  `test_export_service.py`, `test_user_stats.py`; `apps/animes/tests/{test_episode_tracking,test_episode_ratings}.py`
  (extend), new `apps/animes/tests/test_user_list_side_effects.py`

Frontend (`frontend/src`, post-seams):
- `components/{StatusSelector,ListEntryEditModal,EpisodesTab,ProfileInsights,StatusDistribution,StatsTab,ActivityHeatmap,VirtualizedAnimeList}.jsx`; delete `ProfileAnimeCard.jsx`, `profile/ProfileStats.jsx`
- `components/profile/ActivityFeed.jsx`; `components/profile/tabs/{AnimeListTab,ActivityTab,InsightsTab}.jsx`
- `pages/{ImportPage,ExportPage}.jsx`
- `api/modules/{lists,activity,imports}.js`; `api/queries/{lists,importJobs}.js`; `utils/statusDistribution.js`
- New `hooks/useListEntryMutation.js`
- Tests: `components/{StatusSelector,ListEntryEditModal,EpisodesTab,StatusDistribution}.test.jsx`, new
  `hooks/__tests__/useListEntryMutation.test.jsx`, `components/profile/tabs/__tests__/AnimeListTab.test.jsx`,
  `components/profile/__tests__/ActivityFeed.test.jsx`, `pages/__tests__/{ImportPage,ExportPage}.test.jsx`, `api/queries/__tests__/importJobs.test.js`

Must not touch: `apps/users/services/cache.py`, `views/users.py`, `serializers/{accounts,social,...}.py` (G1/G5),
`apps/animes/serializers/anime.py`, `serializers_mixins.py`, `services/public_anime_service.py` (G2),
`apps/animes/services/providers/**`, `rate_limiting.py`, `anilist.py` shim (frozen), `root/**`, `apps/shared/**`,
`components/AnimeCard.jsx`, `animeDetail/*`, `pages/{Home,AnimeDetail,Profile}.jsx`, `profile/{OverviewTab,ProfileContent,index}.js(x)` (G1/G2),
`app/routes.jsx`, `api/client.js`, design tokens, `package.json`.

## Cross-group contracts
**Consumes (read-only):** `build_user_list_status_payload` + `UserStatusMixin` shape (G2, `public_anime_service.py:56-73`)
— unchanged; `AnimeListSerializer`/`AnimeMinimalSerializer` (G2) nested in list/activity payloads; `UserProfile.is_private`,
`UserProfile.timezone` (G1); `invalidate_user_caches` (G1 `services/cache.py`); `animeKeys`, `seasonalKeys` (G2);
`AniListClient`/`AniListService`, `AniListRateLimiter` (frozen); `Anime.status_distribution` written only by the provider after P0-2.

**Provides (frozen interfaces after merge):**
- REST: `lists/` (+ `q`, `ordering`, validated `status`; POST upsert returns 200/201), `lists/summary/`, `activity/` (+ `status`),
  `import/*` (no `access_token`; jobs gain `status=cancelled`, `failure_reason`, `unmatched`, `mode`), `import/anilist/link/`, `import/anilist/sync/`, `export/`.
- List entry JSON shape unchanged (`id, anime, status, score, episodes_watched, notes, started_at, finished_at, total_rewatches, is_rewatching, progress, updated_at`); status strings unchanged.
- `useListEntryMutation({ anime, entry })` (G2's AnimeCard, Home, AnimeDetail, G1's profile shell call it; signature frozen once merged).
- `site_status_counts(anime_id) -> {watching, completed, on_hold, dropped, plan_to_watch}` (cached) for G2's serializer.
- Query keys: `listKeys.*`, `listSummaryKeys.byUser(u) = ['lists', u, 'summary']` (under `['lists']` so existing `listKeys.all` invalidation still covers it), `activityKeys.*`.

**Requests:**
- **Integrator (seams):** put `UserAnimeListSerializer`/`UserActivitySerializer` in `serializers/lists.py`; `lists/`, `activity/` in `urlconf/lists.py`; `import/*`, `export/*` in `urlconf/imports.py`; `userQueries.watching`, `listQueries`, `activityKeys`, `insightsKeys`, `activityQueries`, `insightsQueries` in `api/queries/lists.js`; profile tab bodies `tabs/{AnimeListTab,ActivityTab,InsightsTab}.jsx` owned by G3.
- **Integrator (frozen catalog):** (1) public `AniListClient.get_media_by_ids(*, anilist_ids=(), mal_ids=()) -> list[dict]` (full `MEDIA_FIELDS`, pages of `FULL_MEDIA_PER_PAGE`, background budget); (2) public `AniListClient.run_query(query, variables, *, use_cache=False) -> dict` with `last_error_code` semantics, for list fetches; (3) `save_anime_to_db(item, *, download_images=True)` flag; (4) remove the `fetch_anime_by_external_id` route (`root/celery.py:71`); (5) optional: drop `"status_distribution"` from `_prepare_anime_data` only if G2 prefers site counts as the single source (default plan keeps AniList's).
- **Integrator (matrix):** approve new model `UserListLink` (users app) in G3's migration space, or G3 falls back to storing link state on a sentinel `UserImportJob` row (worse; not recommended).
- **G2:** in `AnimeDetailSerializer`, (a) map AniList keys (`CURRENT/REPEATING→watching, PLANNING→plan_to_watch, PAUSED→on_hold, COMPLETED, DROPPED`) in `get_status_distribution` (`serializers/anime.py:366-382`) and (b) add `site_status_distribution` from `site_status_counts`; label it "On aniShows" vs "On AniList" in StatsTab (G3 owns the component, G2 passes the prop). Replace the three list call sites in `AnimeCard.jsx:205-292`, `Home.jsx:101`, `AnimeDetail.jsx:131` with `useListEntryMutation`; pass `listEntry={anime.user_list_status}` to `EpisodesTab` via `AnimeDetailTabContent.jsx`. Home "continue watching" uses `userQueries.watching` (fixed in G3).
- **G1:** `Profile.jsx` list tab hands only `{username, isOwnProfile}` to `tabs/AnimeListTab` (the tab owns its query/search/sort state); OverviewTab genre sidebar reads `listQueries.summary(username)`; remove `ProfileStats` from `components/profile/index.js` and `ProfileContent.jsx:7`; delete `invalidate_user_anime_caches` and `invalidate_anime_detail_cache` from `services/cache.py` after G3 stops calling them.
- **G5 (optional):** expose `export_forum_data(user) -> dict` for the JSON export; G3 includes it if present.
- **G6:** none required; admin `UserImportJob` list should show `cancelled` (admin.py is G6's).

**Collision avoidance:** G3 edits only `animes/signals.py:220-259` (UserAnimeList receivers); G5 edits review/favorite receivers in the same file — keep hunks disjoint. `users/models.py` is shared with G1/G5: G3 touches only its four model classes and appends `UserListLink` at the end of the file. Migrations numbered after the users leaf at merge time.

## Acceptance criteria and test plan
Checklist:
- [ ] A user with 120 Watching entries sees all 120 (3 pages of 50) with correct count; server search finds an entry on page 3; sort by score works.
- [ ] Overview genre sidebar, Insights and tab counts match `lists/summary/`; one request per profile view for these.
- [ ] A list save performs no `UPDATE anime_anime` and does not change `AnimePublicPayloadService` collection namespace.
- [ ] Detail page member counts no longer drop to 0 after a catalog sync (G2 part).
- [ ] An import cancelled mid-run ends `cancelled` within one flush (≤ 10 entries) and never becomes `completed`.
- [ ] A job hitting the soft time limit ends `failed` with `failure_reason`; a `processing` job without heartbeat for 2 h is failed by cleanup.
- [ ] AniList POINT_100 score 75 → 8, POINT_5 4 → 8 (via `score(format: POINT_100)`), custom-list duplicates processed once.
- [ ] Dates, rewatches, notes survive import from all three sources and export → re-import round trip (XML).
- [ ] Re-running an import does not overwrite entries edited locally after the remote `updatedAt`.
- [ ] A 3 MB MAL XML (`.xml` or `.xml.gz`) imports; a 30 MB decompressed gzip is rejected with 400.
- [ ] No `access_token` reaches Celery kwargs (assert on `apply_async` call).
- [ ] Export JSON preview renders; XML with a `]]>` title parses with defusedxml.
- [ ] Activity filter "Completed" returns completed rows from the server.
- [ ] Status transitions follow P0-8 rules identically from API, modal, StatusSelector, AnimeCard and imports.
- [ ] Linking AniList runs a full import; "Sync now" fetches only changed entries (1 request for < 50 changes); daily step respects cap and failures.
- [ ] Beat snapshot `beat_schedule_and_jazzmin.json` unchanged.

Backend tests (pytest):
- `users/tests/test_list_rules.py`: each transition rule, rewatch completion increments `total_rewatches`, dates in profile timezone, bounds, PTW keeps progress.
- `users/tests/test_list_entries.py`: `q`/`ordering`/invalid status 400, POST upsert 200, constraint violations surface as 400 not 500, private profile still empty.
- `users/tests/test_list_concurrency.py` (pattern of `test_concurrency.py`): two concurrent POSTs → one row, both 2xx.
- `users/tests/test_list_api_budgets.py`: `GET lists/?username=&page_size=50` ≤ 8 queries independent of row count (10 vs 50 rows equal); `GET activity/` ≤ 7; `GET lists/summary/` ≤ 5 cold, ≤ 2 warm; `PATCH lists/{id}/` ≤ 12 and contains no `UPDATE "anime_anime"` (assert on captured SQL).
- `animes/tests/test_user_list_side_effects.py`: no Anime save, namespace unchanged, `site_status` cache invalidated on create/update/delete.
- `users/tests/test_import_service.py`: score formats, dedupe, merge policy, title fallback only without IDs, batch resolution (fake client: 60 unknown IDs → 3 calls), unknown cap → `unmatched`, cancel stops loop, `SoftTimeLimitExceeded` re-raised and job failed, payload stored + requeue works, gzip bomb rejected, import of 100 known entries ≤ 15 queries, post-import invalidation calls.
- `users/tests/test_anilist_sync.py`: link CRUD + validation, cursor stop, conflict policy both directions, cooldown, daily step filters/cap/strike-out, beat kwargs unchanged.
- `users/tests/test_export_service.py`: JSON sections + `download=false` shape, XML escaping/dates/skip-without-mal_id.
- `users/tests/test_user_stats.py`: task and inline paths return identical numbers (duration 0 → 24).
- `users/tests/test_activity_tracking.py`: `status` filter; PROGRESS coalescing (replaces the "not deduped" test); heatmap totals unchanged by coalescing.
- `animes/tests/test_episode_ratings.py`: episode > 10000 with unknown count → 400.

Frontend (vitest):
- `hooks/__tests__/useListEntryMutation.test.jsx`: optimistic + rollback, toast on error, undo re-adds, invalidated keys exclude `['anime']` root, +1 cap.
- `StatusSelector.test.jsx`: `aria-expanded` toggles, Escape closes and returns focus, labeled controls, error toast.
- `ListEntryEditModal.test.jsx`: rewatch toggle payload, notes counter, no clamp.
- `EpisodesTab.test.jsx`: watched markers ≤ progress, "Watched through here" calls `setProgress(n)`.
- `tabs/__tests__/AnimeListTab.test.jsx`: loads next page, server search param, count from API, no emoji.
- `profile/__tests__/ActivityFeed.test.jsx`: filter sends `status`.
- `pages/__tests__/ImportPage.test.jsx`: cancelled state, failure reason, `.gz` accepted, list keys invalidated on completion; `ExportPage.test.jsx`: preview renders `{data}`.

Manual QA (phone 390 px and desktop 1440 px, keyboard-only pass on desktop):
1. Add an anime from a Browse card, +1 to completion; confirm Completed, finish date today, no full-page refetch flash.
2. Detail page: status sheet on phone (swipe/escape/back), progress input with numeric keypad, error case (airplane mode) shows toast and rolls back.
3. Profile: 60+ entries list, search, sort, load more; Overview sidebar and Insights numbers match.
4. Import MAL XML `.gz`, cancel midway, re-run; AniList username import; link AniList, edit on AniList, Sync now.
5. Export JSON preview + download, XML download re-imported into a fresh account.
6. Activity tab filters; heatmap reflects binge (single coalesced row).
Gates: `ruff check`, `ruff format --check`, `makemigrations --check --dry-run`, `pytest -n auto --cov`, `npm run lint`, `npm run test:run`, `npm run build`; existing `test_query_budgets.py`, `test_public_contract.py`, `test_query_sql_snapshot.py`, beat snapshot pass unchanged.

## Migration plan
`users` (numbers relative to SLIM leaf 0037; renumber at integration):
1. `0038_lists_entry_constraints_import_job.py`
   - `RunPython` (batched by pk ranges of 2,000): clamp `score` to 0..10, negative `episodes_watched`/`total_rewatches` → 0, `finished_at < started_at` → `finished_at = NULL`; reverse = noop.
   - `AddConstraint` on `UserAnimeList`: `lists_score_0_10` (`score__gte=0, score__lte=10`), `lists_episodes_nonneg`, `lists_rewatches_nonneg`, `lists_dates_ordered` (`Q(started_at__isnull=True) | Q(finished_at__isnull=True) | Q(finished_at__gte=F("started_at"))`).
   - `AlterField UserImportJob.status` (+ `cancelled`); `AddField UserImportJob.mode` (Char 12, choices full/incremental, default full); `failure_reason` (Text, blank); `unmatched` (JSON, default list); `payload` (JSON, null); `heartbeat_at` (DateTime, null).
   - Only if P2-2 ships: `AlterField UserActivity.activity_type` (+ `imported`).
   - Reversible (RemoveConstraint/RemoveField auto-reverse; choices revert); `cancelled` rows would violate nothing on reverse.
2. `0039_lists_anilist_link.py` (pending matrix approval): `CreateModel UserListLink` — `user` OneToOne CASCADE `related_name="list_link"`, `provider` Char(16) default `anilist`, `external_username` Char(50), `external_user_id` Int null, `auto_sync` Bool default False, `cursor_updated_at` BigInt null, `last_synced_at` DateTime null, `last_error` Char(255) blank, `consecutive_failures` SmallInt default 0, `created_at`/`updated_at`; index (`auto_sync`, `last_synced_at`). Reversible.
`animes`: none (EpisodeRating/UserHistory unchanged; P2-5 would add one).
Rollout: nothing deployed; constraints validate on an empty/small table. Run `populate_user_stats --all` after P1-5 once.

## Risks and open questions
- AniList schema details (custom-list `isCustomList`, `score(format:)`, `Page.mediaList(sort: UPDATED_TIME_DESC)`, `MediaListCollection` size for 5k-entry users) are from memory: verify with one smoke query (the `anilist_smoke` command pattern) before coding P0-4/P1-10.
- Integrator may refuse public client methods (P1-3); the fallback (own httpx + `AniListRateLimiter.acquire()`) works but skips breaker/metrics.
- Matrix: `UserListLink` is a new model outside G3's listed migration space; needs approval.
- Product decision with G2: show AniList global counts, site counts, or both (plan: both, labelled).
- Coalescing progress activity changes an asserted behaviour (`test_activity_tracking.py:119`); confirm the owner wants fewer feed rows.
- Auto-dates use the profile timezone; profiles without one get UTC dates (off by one near midnight in UTC+5).
- `UserStats` carries G5 counters (followers, reviews, resonance); P1-5 keeps computing them here — G5 must not add a second writer.
- Large first imports remain slow when many titles are missing from the catalog (25 per request at ≈25 req/min ≈ 600 titles/min best case, minus catalog sync load); the 500-unknown cap keeps a job bounded and "Run again" resolves the rest later.
- Daily sync of up to 300 links ≈ 300+ background requests at 07:00; if the catalog sync runs then, stagger the step (e.g. countdown spread over 60 min).
