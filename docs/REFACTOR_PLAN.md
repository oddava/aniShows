# AniShows refactoring and optimization plan (November 2026)

Status: **proposal, awaiting approval.** No source code was changed to produce it.

This plan builds on `docs/AUDIT.md` (October 2026). Much of that audit has since
been fixed (see §1.3), so this plan only covers what is still open, and it is
based on measurements taken on 2026-11-09 from branch `codex/sync-main-changes`
(commit `677caa1`).

---

## 0. How this was done, and baseline numbers

What I did: read the settings, middleware, service layer, tasks, providers,
views, frontend routing and API layer, and the compose and CI files. I ran the
full backend suite with coverage, the frontend lint, tests and production
build, ruff (with extra rule sets turned on for measurement), the ruff
complexity rules and vulture. I also checked three framework facts against
official docs (§6).

| Metric (measured 2026-11-09) | Value |
|---|---|
| Backend tests | **730 passed**, 0 failed, 79 s (xdist, 3 workers) |
| Backend line coverage | **65%** (19,940 statements). Weak spots: `anilist.py` 33%, `url_validator.py` 56%, `jikan.py` 61%, `notification_service.py` 67%, `core/celery_admin.py` 0% |
| `ruff check` | passes, but **35 rules are ignored** in `pyproject.toml` |
| `ruff format --check` | **160 of 323 files** would be reformatted |
| Frontend ESLint | clean |
| Frontend tests | **109 passed** (29 files) |
| Frontend build | 37 s. JS total 2.13 MB raw / **587 KB gzip** |
| Largest chunks (raw / gzip) | recharts 368 / 97 KB · MarkdownRenderer 276 / 86 KB · **App 267 / 86 KB (loaded for every visitor)** · index 195 / 61 KB · AnimeDetail 126 / 31 KB |
| `except Exception` (non-test code) | **218** |
| `logger.error/warning(f"...")` | 92. Only 84 calls log with `exc_info` or use `logger.exception` |
| Ruff complexity violations | 51 × C901 (complexity >10), 26 × too-many-branches, 16 × too-many-statements |
| Files over 1,000 lines | backend 5, frontend 5 |

**Not measured (stack was not running): live endpoint latency.** Phase 0
records it before any performance work starts. The figures in AUDIT.md (cold
list ~1.0 s, then ~0.37 s after the Phase 3 data-model work) are historical.

---

## 1. Current architecture assessment

### 1.1 Backend
- **Django 5.2 + DRF**, Channels for WebSockets (served by uvicorn), and Celery
  with **27 beat entries**. The apps are `animes`, `users`, `core`, `forums`,
  `admin_api` and `shared`.
- **A real service layer exists** (`apps/*/services/`), and views are mostly
  ViewSets (35 ViewSet classes against 10 APIView/generics). This structure is
  sound. The problems are the *size* of some services and how errors are
  handled, not the layering.
- **Provider integration** is the most complex area: `jikan.py` (2,169 lines),
  `anilist.py` (1,281), `offline_catalog.py` (1,465) and `offline_sync.py`
  (878). The providers hold `httpx.AsyncClient`s, wrap ORM calls in
  `sync_to_async`, and are entered from Celery through **21
  `async_to_sync`/`asyncio.run` bridges**. The only real concurrency is a single
  `asyncio.gather` (`jikan.py:941`).
- **Public read path:** `AnimeQueryService` + `AnimePublicPayloadService`
  (`public_anime_service.py`, 1,596 lines) sit behind a custom
  stampede-protected cache (`apps/shared/public_cache.py`) with namespace
  versioning and per-user enrichment after the cache.
- **Errors:** there is a central DRF handler (`apps/core/api_errors.py`), but it
  returns `None` for non-API exceptions, so views catch `Exception` themselves
  and build 500 responses by hand.

### 1.2 Frontend
- React 19, Vite 6, TanStack Query 5, Tailwind 4, React Router 7. **All
  JavaScript (0 TS files).** Pages are lazy-loaded per route
  (`src/app/routes.jsx`).
- The auth layer is now clean: the access token lives in memory and the
  refresh token in an httpOnly cookie (`src/api/httpClient.js`).
- Data fetching is split: 24 files use react-query, and **about 32 files fetch
  inside `useEffect`**. These include all 17 admin pages, `Navbar`,
  `NotificationBell`, `Settings`, `Notifications` and `ImportPage`.

### 1.3 Already fixed since the October audit (no further work planned)
CI gate · test suite finishes and is green · refresh token in an httpOnly
cookie · CSP `unsafe-*` limited to Jazzmin `/django-admin/` · `DJANGO_ENV` fails
closed (defaults to production) · `title` no longer unique · `AnimeRelation`
table · studio M2M · forum counters use `F()`/`Greatest` · dead
`apps/animes/cache` package removed · Dockerfile `production` stage is last ·
`SOCIALACCOUNT_LOGIN_ON_GET=False` · `UserActivityMiddleware` is registered and
throttled.

---

## 2. Findings ranked by severity and impact

Labels: **[V]** verified in code or by measurement · **[L]** likely, needs a
test to confirm · **[D]** needs your decision.

### High

**H1. Errors are swallowed without tracebacks, so Sentry is blind to them** [V]
- 218 `except Exception` blocks. 14 views build 500 responses by hand:
  `apps/animes/views/anime.py:85-92`,
  `apps/core/views/celery_admin.py:216,270,291,302,326`,
  `apps/users/views/notifications.py:246,273,310`,
  `apps/users/views/admin_badges.py:62,168`,
  `apps/users/views/import_export.py:202`,
  `apps/core/views/admin_import_jobs.py:134` and
  `apps/core/views/monitoring.py:34`.
- Example: `anime.py:86` runs `logger.error("Error retrieving anime %s: %s", slug, exc)`.
  It logs no traceback, and because the exception is caught, Sentry never sees it.
- Heaviest files: `core/services/notification_service.py` (13),
  `animes/services/rate_limiting.py` (9), `users/tasks.py` (8),
  `animes/tasks/images.py` (8), `core/celery_signals.py` (7),
  `animes/services/jikan.py` (7).
- Impact: production failures stay invisible, and real bugs come back as
  generic 500s.

**H2. The provider layer is oversized, mixes async and sync, and is under-tested** [V]
- 4 files over 1,200 lines. The worst functions are
  `offline_catalog.py:166` (104 statements) and `jikan.py:412 _get`
  (complexity 28).
- The async-to-sync bridging (21 bridges for one `gather`) is the kind of code
  behind the October deadlock: a second DB connection opened from a
  `sync_to_async` thread while the outer transaction was still open.
- `anilist.py` has 33% coverage, so **refactoring it is unsafe until tests are
  added.**

**H3. Dead and duplicated code nobody maintains** [V]
- `apps/core/celery_admin.py` (541 lines, 3 `@admin.register` classes) is
  **never imported** (0% coverage, no importers), so these admin pages do not
  exist.
- Scaling paths that are switched off: Redis Sentinel (`root/settings/base.py`
  ~600–640 and the Celery broker options), read replicas (`base.py:318-340` and
  all of `root/db_routers.py`), and the PgBouncer toggle (`base.py:292-316`).
- `apps/core/tests/test_scaling_config.py:265-290` "tests" the PgBouncer logic
  by re-implementing it on a local variable, so it asserts nothing about the
  settings.
- Duplicated helpers:
  - `_decode_escaped_html_entities` ×4 (`animes/serializers_mixins.py:11`,
    `users/serializers/users.py:89`, `users/services/profile_service.py:27`,
    `users/services/public_profile_service.py:21`)
  - `_normalize_bio` ×2 and `_normalize_profile_primary_color` ×2
    (`profile_service.py` / `public_profile_service.py`)
  - `_iter_exception_chain` ×2 (`animes/tasks/images.py:50`, `users/tasks.py:58`)
  - `_user_exists` ×2 and `_positive_int` ×2

### Medium

**M1. Two task-result stores** [V][D]: `django_celery_results`
(`CELERY_RESULT_BACKEND="django-db"`) *and* `core.CeleryTaskResult`, which is
updated by hand in `animes/tasks/base.py:223-298` and `animes/tasks/sync.py:92-176`.
Each store has its own cleanup beat job (`celery.backend_cleanup`,
`cleanup_old_task_results`).

**M2. Settings defaults drift** [V]: app code has 40
`getattr(settings, "X", default)` calls that repeat defaults already set in
`base.py`, and the two copies disagree. Example:
`shared/public_cache.py` uses `PUBLIC_API_CACHE_LOCK_TTL_SECONDS` default **15**,
while `base.py:99` defaults it to **120**. `base.py` is 1,055 lines; the beat
schedule (~190 lines) and the Jazzmin config (~120 lines) are inlined in it.

**M3. Adult-content filtering runs on every public query** [V for the cost
pattern, L for its real impact]: `_exclude_adult_content`
(`public_anime_service.py:1018-1038`) adds two `NOT IN` subqueries, one over
the genre join and one over JSON `tags ?| [...]`, at 13 call sites.
EXPLAIN ANALYZE is needed before changing the schema (decision D5).

**M4. Lint config hides problems** [V]: 35 ignored rules. **F823, B023 and
F811 currently have 0 hits**, so they can be re-enabled for free. 160 files are
unformatted. `.pre-commit-config.yaml` runs `manage.py test` (the project uses
pytest) and a mypy hook that CI never runs.

**M5. Dependencies don't match the code** [V]:
- `requests` is imported (`users/services/import_service/anilist.py:121`,
  `mal_api.py:56`) but **not declared**. It only works because something else
  installs it.
- Declared but never imported: `cookiecutter`, `django-tailwind`, `pip`,
  `pydantic`, `pyjwt` (simplejwt already depends on it), and the
  `channels[daphne]` extra plus `"daphne"` in `INSTALLED_APPS` (both dev and
  prod run uvicorn).
- `django-debug-toolbar` is a production dependency but is only used in
  development settings.
- Both httpx and requests are used for HTTP.

**M6. Frontend data-fetching drift** [V]: about 32 files fetch inside
`useEffect`. 138 query keys are written as literal arrays across 30 files with
no key factory, so invalidation can silently miss.

**M7. Admin code ships to every visitor** [V]: `src/app/routes.jsx:4-5`
imports `AdminLayout` (507 lines) and `AdminRoute` eagerly, which puts them
into the 267 KB `App` chunk that every visitor loads.

**M8. God components** [V]: `Settings.jsx` 1,406 lines, `AnimeDetail.jsx`
1,093, `Browse.jsx` 1,077, `AdminReports.jsx` 1,070, `Navbar.jsx` 1,067 (31
hooks).

**M9. The maintenance-mode staff bypass probably never fires for SPA staff**
[L]: `apps/core/middleware/site_control_middleware.py:35` checks
`request.user.is_staff`. JWT authentication only runs inside DRF views, so at
middleware time SPA users look anonymous. Staff would get 503s on
non-exempt routes during maintenance. This needs a test to confirm.

### Low
- **L1. Stale files and claims:**
  - `README.md` still lists Daphne.
  - `TODO` claims "TypeScript migration ✅" and "Elasticsearch ✅".
  - `frontend/tailwind.config.js` is never loaded (Tailwind v4 needs `@config`;
    the tokens already live in `@theme` in `src/index.css`).
  - The `autoprefixer` devDependency is unused (`postcss.config.js` only uses
    `@tailwindcss/postcss`).
  - `.agents/` is empty, and `apps/forums/test_forums.py` sits outside
    `apps/forums/tests/`.
  - Stale worktrees remain for merged PRs #7 and #8 (`~/aniShows-relations`,
    `~/aniShows-verify-email`).
  - `.venv` is Python 3.13, while the project targets 3.12.
- **L2.** 105 function-local relative imports, used as workarounds for
  circular imports (for example `animes/tasks/base.py:223`).
- **L3.** Some code creates a new `httpx` client per call
  (`tasks/themes.py:83,237`, `tasks/images.py:166`, `watch_episodes.py:132`).
- **L4.** 127 inline `style={{…}}` in 47 files. PropTypes are used in only 11
  files.
- **L5.** 52 migrations in `animes` and 37 in `users`. Squashing them has low
  value and real risk, so I'm not recommending it now.
- **Security:** no new high-severity findings. `SessionAuthentication` is still
  in the DRF defaults (`base.py:527`). It is CSRF-protected, so it is not a
  vulnerability; whether to keep it is decision D9.

---

## 3. Phased roadmap (file by file)

Each phase is one or more small PRs that pass CI on their own. Phases 0–3 do
not change behaviour. Later phases are gated by benchmarks.

### Phase 0: Guardrails and baselines (~1 day, no behaviour change)
| Change | Files |
|---|---|
| Benchmark script: cold and warm timings plus query counts for `/anime/` list, detail, search, browse rows, schedule and profile; median of 3 runs; results saved to `docs/benchmarks/2026-11-baseline.md` | `scripts/bench_public_api.py` (new), reuse `monitoring/load-tests/` k6 scenarios |
| Query-count guards (`django_assert_max_num_queries`) for the same 6 endpoints | `apps/animes/tests/test_query_budgets.py` (new) |
| JSON snapshot tests of public response shapes (fixture DB), so later refactors can prove "no API change" | `apps/animes/tests/test_public_contract.py` (new) |
| Remove F823, B023 and F811 from ruff `ignore` (0 hits) | `pyproject.toml` |
| Pre-commit: pytest instead of `manage.py test`; drop the mypy hook (or run it in CI, see D8) | `.pre-commit-config.yaml` |
| Coverage report in CI (report only, no threshold yet) | `.github/workflows/ci.yml` |

**Done when:** CI is green, the baseline file is committed, and the new tests
pass on the current code.

### Phase 1: Dead code and dependency cleanup (~1 day)
| Change | Files |
|---|---|
| Delete the unimported Celery Django-admin module | `apps/core/celery_admin.py` |
| Remove Sentinel, replica and PgBouncer branches; delete the router and the tautological tests (D2) | `root/settings/base.py`, `root/db_routers.py`, `apps/core/tests/test_scaling_config.py`, `.env.example` |
| Drop unused deps; move debug-toolbar to dev; declare `requests` **or** port the two call sites to httpx (recommended: port, it's the house client) | `pyproject.toml`, `uv.lock`, `users/services/import_service/{anilist,mal_api}.py` |
| Remove `"daphne"` from `INSTALLED_APPS`; use `channels` without the daphne extra | `root/settings/base.py`, `pyproject.toml` |
| Delete `tailwind.config.js` and `autoprefixer`; fix README and TODO; remove `.agents/`; move `test_forums.py` into `tests/` | frontend config, docs |

**Done when:** tests pass; `manage.py check --deploy` passes under production
settings; the image builds; I report the image size before and after; the
`uv.lock` diff is reviewed.

### Phase 2: Error handling and logging (~2–3 days)
1. Extend `api_exception_handler` (`apps/core/api_errors.py:111`) so unhandled
   exceptions return the same `{detail, code:"internal_server_error"}` 500
   envelope and are logged with `exc_info` (Sentry captures them). The response
   shape stays the same for clients.
2. Delete the 14 hand-built 500 blocks listed in H1 and let exceptions reach
   the handler.
3. Convert `logger.error(f"...{e}")` inside `except` blocks to
   `logger.exception(...)` (92 sites).
4. Narrow `except Exception` in the six heaviest files to concrete types
   (`httpx.HTTPError`, `DatabaseError`, `ValueError`, `KeyError`…). Keep broad
   catches only at task and consumer boundaries, always with `logger.exception`.
5. Turn on ruff `BLE001` with a per-file ignore list that only gets shorter.

**Done when:** tests assert the 500 envelope and that `exc_info` is logged;
there are 0 hand-built 500s in public and user-facing views; `except Exception`
count is ≤ 80. The admin Celery and import-job actions keep their explanatory
500 bodies (only admins see them, and the message is what they act on) but log
the traceback with `logger.exception`.

### Phase 3: Shared helpers, settings and task results (~2 days)
| Change | Files |
|---|---|
| `apps/shared/text.py`: `decode_escaped_html_entities`, `normalize_bio`, `normalize_primary_color`; replace the 4+2+2 copies | the files in H3 |
| `apps/shared/errors.py`: `iter_exception_chain`; shared `positive_int` | `animes/tasks/images.py`, `users/tasks.py`, `animes/services/relation_links.py`, `core/consumers.py` |
| Move the beat schedule and Jazzmin config into `root/settings/celery_schedule.py` and `root/settings/jazzmin.py`. Keep the 4 small env helpers (switching to django-environ adds a dependency for no measurable gain) | `root/settings/base.py` |
| Replace `getattr(settings, X, default)` with `settings.X` wherever `base.py` defines X (fixes the drift in M2) | 40 sites, e.g. `shared/public_cache.py`, `animes/signals.py`, `tasks/offline_catalog.py` |
| One task-result store (D3) | `animes/tasks/base.py`, `animes/tasks/sync.py`, `core/models.py` + migration, `root/settings/base.py`, admin views |

**Done when:** tests pass and the listed functions have 0 duplicates.

### Phase 4: Provider-layer decomposition (~1–2 weeks, one provider per PR)
Order: **add tests first** (AniList to ≥70%, Jikan to ≥75%, using recorded
JSON fixtures through `httpx.MockTransport`), then split.

```
apps/animes/services/providers/
  jikan/    client.py      # HTTP, rate limiter, circuit breaker, response cache
            mapper.py      # the ~25 pure _normalize_* functions → plain dicts
            persistence.py # save_anime_to_db, relationships, theme songs
  anilist/  client.py · mapper.py · persistence.py
  base.py                  # today's provider_base.py
```
- `JikanService` and `AniListService` stay as thin facades **at the current
  import paths** (re-exported), so callers, tasks and tests don't change.
- Split `offline_catalog.py:166` (104 statements) and `jikan.py:412 _get`
  (complexity 28) along their existing phases.
- D4 (recommended): make the Celery-side paths synchronous with `httpx.Client`,
  keep async only around the single `gather`, and delete the bridges. This
  removes the second-connection deadlock class altogether.

**Done when:** a golden test feeds recorded provider payloads through the
mappers and gets **byte-identical** normalized dicts before and after; sync task
tests pass; no file in `animes/services/` is over 800 lines.

### Phase 5: Public read-path performance (~3–5 days, benchmark-gated)
1. Run EXPLAIN ANALYZE for list, search and browse rows on the dev DB (39k
   rows) and record the results.
2. Replace `_apply_sort`'s 207-line if/elif chain
   (`public_anime_service.py:776-983`) with a per-sort-key table of
   `(filters, annotations, ordering)`. Split `AnimeQueryService` into
   `filters.py`, `sorting.py` and `shelves.py`.
3. **Only if** step 1 shows the adult filter is material: add `Anime.is_adult`
   (set in `provider_base._prepare_anime_data`, backfilled by a data migration,
   partial index), then change `_exclude_adult_content` to
   `filter(is_adult=False)` (D5).
4. Index audit: use `pg_stat_user_indexes` on `anime_anime` (32 indexes) and
   drop only indexes with 0 scans that duplicate another index.
5. `offline_db_payload` to a side table (D6), but only after measuring its
   TOAST share of the table.
6. `schedule` has no server-side cache: in the Phase 0 benchmark smoke run its
   warm time equals its cold time (`apps/animes/views/anime.py:164`). Cache it
   the way `browse-rows` is cached, keyed by day and the adult-content flag,
   with per-user enrichment applied after the cache.

**Done when:** contract snapshots are unchanged; query budgets are unchanged or
lower; no endpoint is >10% slower than baseline; target ≥30% lower cold p50 on
list and search, otherwise steps 3–5 are dropped.

### Phase 6: Frontend (~2–3 weeks, can run alongside Phases 4–5)
| Step | Files |
|---|---|
| 6a. Lazy-load `AdminLayout` and `AdminRoute`; confirm recharts and markdown load only on the routes that use them | `src/app/routes.jsx` |
| 6b. Query-key factory built on v5 `queryOptions`; migrate the 138 literal keys | `src/api/queries/*.js` (new), the 30 consumer files |
| 6c. Move `useEffect` fetching to `useQuery`/`useMutation`: the 17 admin pages first (they share one pattern), then `NotificationBell`, `Navbar`, `Notifications`, `Settings`, `ImportPage` | the files listed in M6 |
| 6d. Split the god components along their existing sections (Settings tabs → `components/settings/*Tab.jsx`; Navbar → search, user menu and notifications) | the files in M8 |
| 6e. TypeScript (D7): `tsconfig` with `allowJs`; convert `src/api` and `src/hooks` first; generate API types from the drf-spectacular schema (`openapi-typescript`) | `frontend/` |

**Done when:** vitest passes, with new tests for every migrated hook; `App`
chunk ≤ 200 KB raw (from 267) and no admin code in the public entry; 0
`useEffect` fetches in admin pages; no component over 600 lines.

### Phase 7: Infrastructure (only after decisions)
- PgBouncer in prod compose: remove it, or switch to Django's native pool.
  That needs `psycopg[binary,pool]` in place of `psycopg2-binary`; with psycopg2
  the `pool` option is silently ignored.
- Jikan stack (jikan + Mongo + Typesense, about 1.4 GB): removal depends on D1.
- Beat schedule review: `sync_anime_catalog` has 5 entries,
  `sync_theme_songs` 2 and `backfill_theme_youtube_urls` 2. Merge only where
  the arguments allow it.

### Dependencies between phases
```
0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5
│                       ▲
└─► 6a…6e (independent of 1–5; 6e after 6b/6c)
Phase 4 needs its tests-first step. Phase 5 needs Phase 0 baselines. Phase 7 needs D1/D2.
```

---

## 4. Decisions that need your approval
| # | Decision | My recommendation |
|---|---|---|
| D1 | Drop Jikan and go AniList-only (affects 20 files plus the 3 compose services) | Yes, but as its own project after Phase 4 |
| D2 | Delete the PgBouncer, Sentinel and read-replica code paths now | Yes (YAGNI; nothing is deployed; recoverable from git) |
| D3 | Which task-result store to keep | Keep `core.CeleryTaskResult` (the admin UI uses it); drop `django_celery_results` |
| D4 | Make the provider layer synchronous in Celery | Yes |
| D5 | Add a denormalized `is_adult` column | Only if EXPLAIN shows a real cost |
| D6 | Move `offline_db_payload` to a side table | Only after measuring its size |
| D7 | TypeScript migration | Yes, incrementally, after 6b/6c |
| D8 | One-shot `ruff format` (160 files) + `.git-blame-ignore-revs`; mypy in CI | Format: yes. Mypy: only on new provider modules |
| D9 | Remove `SessionAuthentication` from the DRF defaults | Keep (it's CSRF-protected and the browsable API uses it); low priority |
| D10 | Squash migrations | No, not now |

---

## 5. Testing, benchmarking and rollback strategy
- **Per PR:** backend pytest + ruff, frontend ESLint + vitest + build, and the
  Phase 0 contract and query-budget tests. A PR may not change the contract
  snapshots unless the change was approved.
- **Benchmarks:** same machine, same DB snapshot, Redis flushed for cold runs,
  median of 3, compared to the committed baseline.
- **Schema changes (D3/D5/D6):** reversible migrations in two steps (add and
  backfill → switch reads → drop later), so each PR can be reverted on its own.
- **Rollback:** one revert per PR. There's no production server, so a rollback
  is just a git revert plus `migrate <app> <previous>`.

## 6. Framework facts checked against official docs
- Django 5.1+ native PostgreSQL pooling requires psycopg 3 (`psycopg[pool]`)
  and is **ignored with psycopg2**
  (docs.djangoproject.com/en/5.2/ref/databases/#connection-pool).
- Tailwind v4 no longer detects JS config files automatically; they need
  `@config` (tailwindcss.com/docs/upgrade-guide).
- TanStack Query v5 recommends `queryOptions` for sharing a `queryKey` and
  `queryFn` across places (tanstack.com/query/v5/docs/framework/react/guides/query-options).

## 7. Definition of done (whole programme)
- All backend (730+) and frontend (109+) tests pass; the new contract and
  query-budget tests exist and pass.
- Backend coverage is ≥ 72% overall, `anilist.py` ≥ 70% and `jikan.py` ≥ 75%.
- `ruff check` passes with F823/B023/F811/BLE001 enabled; `ruff format --check`
  runs in CI.
- `except Exception` ≤ 80, each one at a boundary with `logger.exception`.
  0 hand-built 500 responses.
- No file in `apps/animes/services/` over 800 lines; no React component over
  600 lines.
- 0 duplicated helpers from H3; no dead modules (`celery_admin.py`, router).
- `App` chunk ≤ 200 KB raw; 0 `useEffect` fetching in admin pages; a single
  query-key factory.
- No public API shape changes; no endpoint regresses more than 10% against
  baseline.
