# AniShows audit (October 2026)

How this audit was done: I built and ran the full Docker stack locally, applied the
one pending migration, timed the main API endpoints, ran both test suites, ran
ruff, ESLint, vulture and `npm audit`, queried the database, and read the code
that matters most: settings, models, views, auth, infra and CI.

---

## 1. Verdict

**Refactor in place. Don't rewrite.** The codebase is less of a mess than you
think. It has a real service layer, DRF ViewSets, 500+ backend tests, 70 frontend
tests, a passing ruff config, and a working product with ~39k anime in the
database. The problems are serious, but they sit in a few clear places:

1. **No safety net.** CI never runs tests or lint. Every push to `main` builds and
   deploys to production over SSH.
2. **Auth security.** A 30-day refresh token lives in `localStorage`, and the CSP
   allows `'unsafe-inline' 'unsafe-eval'`. One XSS anywhere is enough to take over
   an account.
3. **Infra built for 100k users before having 100.** 20 containers and about
   3.6 GB of RAM in dev, including PgBouncer, Sentinel/replica plumbing, a
   self-hosted Jikan (PHP + Mongo + Typesense), Umami, 4 Celery workers, Daphne
   *and* Uvicorn, and 25 beat jobs. On an 8 GB machine, the stack plus the test
   suite exhausts memory.
4. **Data model hacks.** The anime `title` field is unique, fake AniList IDs are
   used to avoid collisions, relations are stored as JSON, there is one studio per
   anime, and raw payload blobs make up most of the DB size.
5. **God files.** `jikan.py` is 2.5k lines, `anilist.py` is 1.7k,
   `public_anime_service.py` is 1.6k, `settings/base.py` is 1k, and
   `Settings.jsx` is 1.4k. There are 225 `except Exception` blocks.

A rewrite would throw away working sync pipelines and tests to fix problems that
can be fixed one at a time. Use a strangler approach: lock in a safety net first,
then simplify, then refactor module by module behind tests.

---

## 2. What I observed when running it

| Check | Result |
|---|---|
| `docker compose build` | ✅ builds (about 10 min cold) |
| `docker compose up` | ⚠️ `web` and `daphne` **exit 1 with no message**. One migration was unapplied, and `scripts/run_with_migration_check.sh` fails silently. Fixed by running `migrate`. |
| Health, SPA, Vite | ✅ 200 |
| `GET /anime/?page_size=24`, cold | ⚠️ **~1.0 s**. Cached responses take 14 ms. Cold detail takes 0.67 s, cold search 0.98 s. |
| Dev memory | ⚠️ ~3.6 GB across 20 containers. `celery` sat at 506/512 MB and `jikan` at 725/768 MB. WSL dropped connections twice. |
| Backend tests | ❌ **never completes**: it deadlocks or gets OOM-killed, with ≥22 failures before that (see §2.1) |
| Frontend tests | ✅ 70/70 pass (21 files) |
| Frontend build | ✅ 22 s. Largest chunks: recharts 368 KB, MarkdownRenderer 270 KB, App 255 KB (eager) |
| ruff (project config) | 4 errors, but the config ignores **F401 unused imports (86 hits)** and about 30 other rules |
| `ruff format --check` | 152 of 306 files would be reformatted |
| ESLint | 1 error (an unused var in `AnimeDetail.jsx`) |
| `npm audit --omit=dev` | **4 high and 1 moderate** in `react-router` (fix with `npm audit fix`) |

### 2.1 Backend test suite

**The backend suite (522 tests) cannot finish in its current state.** It either
runs out of memory or deadlocks:

- **Deadlock:** `apps/animes/tests/test_jikan_service.py::JikanServiceNormalizationTests::test_save_anime_to_db_reuses_provider_matched_row`
  hangs forever. One Postgres connection sits `idle in transaction` after an
  `INSERT INTO anime_anime`, while a *second* connection from the same process
  waits on its row lock with another `INSERT INTO anime_anime`. So
  `save_anime_to_db` (or something it calls) writes through a second DB
  connection (a thread or `sync_to_async`) while the outer transaction is still
  open. This is probably a real production bug as well, not only a test bug.
- **Memory:** run serially, the pytest process grew past 1.5 GB by about 5% of
  the suite and was OOM-killed. That test passes alone at a steady 434 MB, so the
  growth is cumulative leakage across tests (mocks, caches or module state).
- **Failures before the hang:** a parallel run reached 74% with **22 failures
  across 12 files**: `test_episode_ratings`, `test_episode_tracking`,
  `test_anilist_integrity`, `test_anime_list`, `test_reviews`, `test_seasonal`,
  `test_image_self_heal_tasks`, `test_notification_tasks` (3),
  `test_cache_behavior`, `test_import_service` (2), `test_profile_features` (4)
  and `test_production_readiness`. A serial run got 9 failures in the first 141
  tests. Many are validation tests (`rejects_invalid…`, `cannot_exceed_total`,
  `sub_rating_bounds`), which suggests the input validation itself has regressed.
  That needs investigating, not just fixing the tests.

Infra problems with the tests themselves:
- `make test` runs in the `web` service, so it inherits the 1.5 GB memory limit.
  With xdist (`-n 3`), workers get **OOM-killed**. The replacement workers then
  **deadlock** in Postgres, with one connection `idle in transaction` and another
  waiting on its lock. The suite hangs forever instead of failing.
- Tests use the dev DB server, not an isolated service.
- The pre-commit hook runs `manage.py test`, but the project uses pytest.

---

## 3. Where to start (the order matters)

### Phase 0: Safety net (do this first, ~2–3 days)
Nothing else is safe to change until this exists.
1. **Add a CI job that gates deploys.** Run ruff, ESLint, pytest (against a
   Postgres service container), vitest and the frontend build on every PR.
   Make `deploy` depend on it. Right now `.github/workflows/deploy.yml` has no
   test step at all.
2. **Make the test suite finish, then make it green.** Add `pytest-timeout` so a
   hang becomes a failure. Fix the second-connection deadlock in
   `save_anime_to_db`. Find the cumulative memory leak. Run tests in their own
   compose service with no 1.5 GB cap. Then triage the 22+ failures, starting
   with the validation ones.
3. **Protect `main`.** Require PRs and green CI. Stop deploying on every push and
   deploy on tags or releases instead.
4. **Clean the repo root.** Delete `changes.patch`, `patch.js`, `requirements.txt`
   (it duplicates `uv.lock`), the stale `TODO`, and the empty `.agents/`. Fix the
   silent exit in `run_with_migration_check.sh` so it says *why* it failed.

### Phase 1: Security (~1 week)
1. **Move the refresh token out of `localStorage`.** Use an httpOnly, Secure,
   SameSite=Lax cookie scoped to `/api/v1/auth/refresh/`. Keep the access token
   in memory only. See `frontend/src/api/httpClient.js:91-116` and
   `REST_AUTH.JWT_AUTH_REFRESH_COOKIE=None` in settings.
2. **Tighten the CSP.** Remove `'unsafe-inline'` and `'unsafe-eval'` from the API
   CSP (`apps/users/middleware/csp_middleware.py:23-24`). Scope the Jazzmin admin
   exception to `/django-admin/` only.
3. **Remove `CsrfExemptSessionAuthentication`** (`apps/animes/views/anime.py:43`)
   and drop `SessionAuthentication` from the API defaults. The SPA uses JWT, so
   session auth only adds CSRF surface.
4. **Harden `ImageResizeView`** (`apps/animes/views/image_views.py:42`). It is
   unauthenticated, resizes on the request thread with LANCZOS and WebP method=6,
   accepts any `w`/`h`, and caches nothing on the server. That makes it a CPU DoS
   vector. Use a fixed set of size presets, cache the results, rate-limit the
   endpoint, or replace it with an image CDN or imgproxy.
5. **Slim down the JWT claims.** Remove `email`, `is_staff` and `is_superuser`
   from the token (`apps/users/views/auth.py:44-46`). Admin UI gating should
   come from `/users/me/`, never from decoded claims.
6. **Stop putting the WebSocket JWT in the query string** (`root/ws_auth.py`).
   It ends up in proxy access logs. Use a short-lived one-time WS ticket, or send
   the token in the first message.
7. **Fail closed on settings.** `root/settings/__init__.py:23` defaults
   `DJANGO_ENV` to **development** (DEBUG=True). If prod ever runs without that
   variable, it serves debug pages. Default to production, and require the
   variable explicitly in dev.
8. **Upgrade `react-router`** (4 high CVEs). Set `SOCIALACCOUNT_LOGIN_ON_GET=False`.

### Phase 2: Simplify the platform (~1–2 weeks)
The single biggest quality-of-life win. Target ≤8 dev containers and under 1.5 GB.

| Remove or merge | Why |
|---|---|
| **Daphne** | Gunicorn already runs `UvicornWorker` (ASGI), which serves WebSockets. Two servers for one app. |
| **PgBouncer** in dev | It forces `DISABLE_SERVER_SIDE_CURSORS` and adds a hop. Use Django 5's native `pool` option if pooling is needed. |
| **Self-hosted Jikan + Mongo + Typesense** (~1.4 GB) | Use the public Jikan API with rate limiting, or drop Jikan and use AniList only. |
| **Umami + its Postgres** | Move to an opt-in compose profile. |
| **4 Celery workers → 1** (dev), 2 (prod) | Queue routing can stay. |
| **Redis Sentinel and read-replica code paths** | Unused (both disabled). Delete them until there's real load. |
| **Two Celery result stores** (`django_celery_results` and `core_CeleryTaskResult`) | Keep one. |
| **25 beat jobs** | Several overlap (trending hourly, airing hourly, airing weekly…). Consolidate. |

Also fix these:
- **The prod image contains dev dependencies.** The Dockerfile's last stage is
  `development` (`Dockerfile:83`), and CI builds without `--target`, so
  production ships pytest, mypy and bandit. Add `target: runtime`.
- **Dev has no hot reload.** No source volumes are mounted for `web` or
  `frontend`, so every code change means a rebuild. Add a `compose.override.yml`
  with bind mounts and `runserver` or `vite`.
- Unpinned `:latest` images: `minio`, `minio/mc`, `jikan-rest`, `pgbouncer`, `caddy`.
- `docker-compose.yml` repeats the same 20-line env block 7 times. Use YAML
  anchors or `env_file`.
- Unused prod dependencies: `cookiecutter`, `django-tailwind`, `pip`,
  `django-debug-toolbar` (it's dev-only), `python-whois`, `six`.
- Deploys run `git stash && git pull` on the server, as root. Ship immutable
  images plus a compose file instead.
- Local `.venv` is Python 3.13, but Docker and pyproject target 3.12. Pin one.

### Phase 3: Data model (~2 weeks, behind tests)
1. **Drop `Anime.title unique=True`** (`apps/animes/models/anime.py:63`). Anime
   titles are not unique. **915 titles** in the DB had `" (YEAR)"` appended to
   work around it. Make `slug` the unique key and store titles as they are.
2. **Remove the `JIKAN_ANILIST_ID_OFFSET` fake-ID hack** (`anime.py:33`). It
   produced 28 rows, plus the correlated `public_queryset()` subquery that casts
   JSON on every public list. That subquery is likely the cause of the ~1 s cold
   list time. Use a proper `ExternalId(provider, external_id)` table, or nullable
   `mal_id`/`anilist_id` with a dedup step at import time.
3. **`studio` is a single FK.** Most anime have several studios. Make it M2M.
4. **`relations` is a JSON blob.** Use an `AnimeRelation(from, to, type)` table so
   franchises can be queried.
5. **`offline_db_payload`** and other raw blobs make up most of the 153 MB
   `anime_anime` table. Move raw import payloads to a separate table or object
   storage.
6. **40 indexes on `anime_anime`**, several of them redundant (`slug` has both a
   unique index and a plain one; `title` has both a btree and a trigram index).
   Audit them against `pg_stat_user_indexes` and drop the unused ones.
7. **`UserAnimeList.score` has no validators.** `email_verified` lives on the
   profile and duplicates allauth's `EmailAddress`. Pick one source of truth.
8. **Denormalized counters drift.** Forum migrations
   `0004_populate_denormalized_counters` and `0005_fix_corrupted_counters`
   exist because they already broke. Use `F()` updates in the same transaction,
   or compute them.
9. **Squash migrations.** There are 47 in `animes` and 36 in `users`.

### Phase 4: Backend code quality (ongoing, one module per PR)
- **Break up the god modules.** `services/jikan.py` (2,535 lines),
  `anilist.py` (1,709), `public_anime_service.py` (1,581: `_apply_sort` alone
  is 205 lines), `offline_catalog.py` (1,443). 31 functions exceed 100 lines.
  Split each into a client (HTTP only), a mapper (provider → domain), and a
  repository/upsert layer.
- **Reduce the 225 `except Exception` blocks.** Many return a generic 500 and
  swallow the traceback (`logger.error(..., exc)` with no `exc_info`). Catch
  specific exceptions, and let DRF's handler and Sentry deal with the rest.
- **Untangle the custom caching layer.** There are 155 `cache.get/set` call
  sites, a custom stampede lock (`shared/public_cache.py`), per-user enrichment
  after caching, and an entire dead module (`apps/animes/cache/`). Pick one
  pattern, such as per-view cache with versioned keys, and delete the rest.
- **Delete dead code.** `apps/users/middleware/activity_middleware.py` and
  `audit_middleware.py` are never registered, and `apps/animes/cache/*` is never
  imported. Vulture flags about 400 more candidates worth reviewing.
- **Split `settings/base.py` (1,045 lines).** Move the Celery beat schedule and
  Jazzmin config into their own modules. Use `django-environ` or pydantic-settings
  instead of four hand-written `_env_*` helpers.
- **Make linting honest.** Re-enable F401 and the other ignored rules gradually,
  run `ruff format` once in a single commit, and add mypy to CI on new modules.
- **Fix naming.** The app directory is `animes` but its label is `anime`, and
  Jazzmin config references `anime.Anime` in one place and `animes.Anime` in
  another.
- Your own `TODO` style notes (model formatting, a unified logger, fewer comments)
  are fine to apply as you touch each file. Don't spend a dedicated pass on them.

### Phase 5: Frontend (~2–3 weeks, can run in parallel with Phase 4)
- **Migrate to TypeScript.** The TODO marks the TS migration as ✅, but there are
  0 `.ts` files. Start with `api/` and `hooks/`, then convert pages as you touch
  them. Generate API types from the OpenAPI schema (drf-spectacular already exists).
- **Use one data-fetching pattern.** 30 files use react-query, while 26 files
  fetch in `useEffect` by hand. Use react-query everywhere, with a query-key
  factory.
- **Split the god components:** `Settings.jsx` (1,415 lines, **36 `useState`**),
  `AnimeDetail.jsx` (1,108), `Browse.jsx` (1,077), `AdminReports.jsx` (1,070),
  and `Navbar.jsx` (1,067 lines, 16 `useEffect`s). Use a feature-folder layout
  (`features/anime`, `features/profile`, `features/admin`…).
- **Use a form library.** Settings and auth forms should use react-hook-form
  with zod.
- **Inline styles.** There are 127 `style={{…}}` usages on top of Tailwind, and
  `tailwind.config.js` is a v3 leftover in a Tailwind v4 project.
- **Bundle size.** Lazy-load recharts and the markdown stack, and check why
  `App` is a 255 KB eager chunk.
- **Fix the refresh logic.** In `httpClient.js` the retry path resets
  `isRefreshing` inconsistently, and a 401 path does a `setTimeout` redirect.
  This gets much simpler after the Phase 1 cookie change.
- Fix the TODO's other inaccurate claims, such as "Elasticsearch ✅". There is
  no Elasticsearch.

### Phase 6: Product and platform polish (after the above)
- Add Playwright e2e smoke tests for login, browse, detail, add-to-list and
  review, and run them in CI.
- Add an OpenAPI-driven typed client, and stop hand-writing `api/modules/*`.
- Add observability that matters at your scale: Sentry, one uptime check, and
  slow-query logging. Prometheus multiproc can come later.
- Add accessibility and Lighthouse passes. The mobile bottom nav and hero look
  good. Keep the design and clean up the code under it.

---

## 4. Quick reference: findings by severity

**Critical**
- No CI test gate; pushes to main deploy straight to prod (`.github/workflows/deploy.yml`)
- 30-day refresh JWT in `localStorage` + CSP with `unsafe-inline`/`unsafe-eval`
- `DJANGO_ENV` defaults to development (DEBUG) (`root/settings/__init__.py:23`)

**High**
- Prod image built from the `development` stage (`Dockerfile:83`)
- Unauthenticated, uncached, CPU-heavy image resize endpoint
- `react-router` high-severity CVEs
- `Anime.title unique=True` corrupts data (915 renamed titles)
- Test suite can OOM, deadlock and hang; some tests fail
- Startup fails silently on pending migrations

**Medium**
- `CsrfExemptSessionAuthentication` + global `SessionAuthentication`
- Staff/superuser/email claims in JWT; WS token in query string
- Cold list endpoint ~1 s (JSON-cast subquery in `public_queryset`)
- 20-container dev stack, ~3.6 GB, no hot reload
- 225 broad excepts, 31 functions >100 lines, dead modules
- Inconsistent data fetching on the frontend; 1k+ line components

**Low**
- Unused deps, unpinned images, duplicated compose env, stray patch files,
  formatting drift, stale TODO/README claims, Python 3.12/3.13 mismatch
