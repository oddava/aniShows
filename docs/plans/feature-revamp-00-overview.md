# Feature revamp 00: overview, ownership and integration plan

> Local only: no push, no PR, no deploy.
> Specs 1–6 were read at backend `fix/anilist-only-and-fixes` 17f082a/4fa2d14 and frontend
> `feat/visual-ux-overhaul` ab5b3c2. **Status:** the integration branch exists as
> `integration/anishows-overnight` @ 50dcfba (slim-down + visuals, real-backend smoke-tested). The fan-out
> base is `revamp/base` = that commit + this plan (docs) + the behaviour-neutral seams/contract-stubs prep
> commit (sections 4a, 5, 6, 7, 13). A seventh stream, **G7 Production readiness**, was added (spec 7).
> Paths in specs 1–6 are pre-seams where they say so; section 4a maps them to the post-seams files.

## 1. The plan in one paragraph

A local integration branch (`integration/anishows-overnight`: slim-down, then visuals merged in)
carries one behaviour-neutral **seams + contract-stubs** commit (on `revamp/base`) that splits the
shared "god files" along group lines and adds the cross-group helper signatures as thin wrappers over
today's behaviour. Seven worktrees branch from `revamp/base` and run in parallel. They merge back in
this order: **G1 Accounts → G4 Notifications → G3 Lists → G2 Browse → G5 Community → G6 Admin →
G7 Production readiness**. Each later group rebases (and re-points its migration dependencies) before
its final council round. The order follows the contracts: identity and notify come first, then the
data producers, then the read path, then community, then admin, which consumes all of them. G7 comes last
because it deploys the result: it collects every group's env vars and migrations, and runs the final
deploy dry-run on the integrated code.

## 2. Spec index

| # | Spec | Lines | Headline P0 |
|---|---|---|---|
| 1 | [feature-revamp-1-accounts-auth.md](feature-revamp-1-accounts-auth.md) | 383 | Register without email → 500; "Resend verification" always 500s; query cache not cleared on logout/account switch; Google login leaves a Django session that survives logout |
| 2 | [feature-revamp-2-browse-discover.md](feature-revamp-2-browse-discover.md) | 278 | Browse search never ranks by relevance; any list edit flushes all public caches site-wide; recommendations ignore the adult setting and resurrect dismissed titles; synchronous refresh in the web worker |
| 3 | [feature-revamp-3-lists-anilist-sync.md](feature-revamp-3-lists-anilist-sync.md) | 424 | Profile list/insights read only 20 rows per status; imports stuck in "processing" forever after the time limit; AniList score formats mis-scaled; JSON export preview always crashes |
| 4 | [feature-revamp-4-notifications-push.md](feature-revamp-4-notifications-push.md) | 504 | Web push has never worked end to end (no subscribe flow, SW unregistered by default, 200-char endpoint column, dead-subscription pruning never fires); push follows the previous account on shared devices |
| 5 | [feature-revamp-5-community.md](feature-revamp-5-community.md) | 448 | Replies deeper than 10 levels saved but never shown; follow toggle returns multiplied counts; review edit can move a review to another anime; favourite reorder collides across pages |
| 6 | [feature-revamp-6-admin.md](feature-revamp-6-admin.md) | 503 | SPA admin actions are never audited (JWT is invisible to middleware); staff can make the worker fetch any URL/local path via import jobs; maintenance bypass broken for JWT staff; logs grow unbounded |
| 7 | [feature-revamp-7-production-readiness.md](feature-revamp-7-production-readiness.md) | ~230 | Behind Cloudflare Tunnel: Caddy's ACME/80/443 clash on a shared VPS, a likely HTTPS redirect loop, and every user sharing one throttle bucket (client IP = cloudflared); the bundled Postgres is hard-wired (no shared external DB); the deploy guard misses `DJANGO_SECRET_KEY` |

## 3. Top cross-cutting findings (verified in code by the group specs; spot-checked here)

| # | Sev | Finding | Owner of the fix |
|---|---|---|---|
| 1 | High | Every list save calls `anime.save(update_fields=["status_distribution"])`. The Anime `post_save` receiver bumps the global collection namespace, so one user's edit empties trending/top/browse/schedule caches for everyone (`user_list_side_effects.py:88-90`, `animes/signals.py:53,135`). Found independently by G2 (B2) and G3 (L3). | G3 stops writing Anime (`site_status_counts()` cache instead); G2 makes Anime receivers field-aware |
| 2 | High | `Anime.status_distribution` has two writers with different key styles (AniList `CURRENT`… vs local lowercase). The serializer reads only lowercase, so member counts show 0 after any catalog sync (G2 B6, G3 L4). | G2 normalises on read and adds `site_status_distribution`; G3 stops recounting into the provider field |
| 3 | High | Web push is not wired: nothing subscribes, `boot.js` unregisters service workers unless `pwa-enabled` is set, `PushSubscription.endpoint` is 200 chars vs a 2048-char serializer, and the 410 prune check is always false (G4 N1–N4). | G4 (plus integrator: `boot.js`/`vite.config.js`) |
| 4 | High | Admin audit trail is empty for SPA actions: the audit middleware reads `request.user` before DRF's JWT auth runs (G6 A1, `core/middleware/logging_middleware.py:42-44,134`). The same root cause breaks the maintenance-mode staff bypass (A3, REFACTOR_PLAN M9 still open). | G6 |
| 5 | High | Staff (not only superusers) can trigger catalog import jobs whose `source_url`/`source_path` reach the worker unchecked (SSRF / local file read), and `limit` is uncapped, so they can drain the AniList budget (G6 A2). | G6 |
| 6 | High | Shared-device leakage: the TanStack cache is not cleared on logout, `['ownProfile']` is not user-keyed (G1 A04), and push subscriptions survive logout (G4 N6). | G1 (AuthContext) calls G4's `detachOnLogout()` |
| 7 | High | Imports: Celery's 600 s default limit; the soft limit is swallowed per entry; the hard kill leaves the job "processing" forever and blocks later imports; cancel is ignored; AniList 100-point/5-star/3-smiley scores are mis-scaled; imports overwrite newer local edits (G3 L5–L8). | G3 |
| 8 | High | Forum threads: replies past depth 10 are stored but never returned or rendered (G5 F1). The follow toggle aggregates two `Count`s over two joins, which multiplies the counts (G5 S1, `follow_service.py:81-84`, confirmed). | G5 |
| 9 | High | Browse always sends `sort=popular`, so the new trigram relevance ranking (slim-down's main search win) never applies on the Browse page (G2 B1, `useBrowseUrlFilters.js:21`, confirmed). | G2 |
| 10 | High | `SystemLog`/`AuditLog` are never pruned. Each request log costs one Redis message plus three DB writes, and two every-minute tasks add about 2.9k result rows/day. This is a disk/IO risk on a shared 8 GB VPS (G6 A4/A21, estimate). | G6 |

Other notable ones: episode emails sent to unverified addresses as unescaped f-string HTML
with no List-Unsubscribe (G4 N7/N8); Google-only accounts can set a password, change email or
delete the account with only an access token (G1 A06); reset/verify/email-change tokens sit in
URL paths and are sent to Umami (G1 A14); re-reporting reopens resolved review reports (G5 R2);
no throttles on review/vote/react/report/follow/favourite (G5 R3); `POST /recommendations/refresh/`
rebuilds synchronously in a web worker (G2 B5); `/api/v1/health/ready/` builds a migration graph
on every unauthenticated hit (G6 A20).

**Removed-service remnants.** After the integration merge, the frontend has none: slim-down's
versions of `AdminImportJobs.jsx`, `ImportJobDetails.jsx` and `TriggerImportJobForm.jsx` win
automatically, because visuals never touched them (verified on the `git merge-tree` result).
The backend keeps only intentional legacy-data notes (`models/anime.py:190`,
`providers/anilist/persistence.py` Jikan-era person folding, a retired `sync_theme_songs` stub).
`deploy-prod.sh` keeps the orphan-container cleanup. No group needs Jikan work beyond G6
checking that the admin import page uses slim's source list (A6).

## 4. Ownership matrix (final, with amendments from the research round)

The binding per-file matrix is the one each spec's **File ownership** section states. The
groups were briefed from the same matrix, and their `File ownership` sections stay inside it.
The summary:

| Area | G1 Accounts | G2 Browse | G3 Lists | G4 Notifications | G5 Community | G6 Admin | G7 Production readiness |
|---|---|---|---|---|---|---|---|
| Models | CustomUser, UserProfile (identity/privacy/appearance), SocialLinkChangeLog | UserRecommendation; read-path indexes only | UserAnimeList, UserActivity, UserImportJob, UserStats, EpisodeRating, UserHistory, **new UserListLink** | Notification, PushSubscription, **new NotificationPreference** | forums.*; Review*, UserFavorite*; Badge, UserBadge, UserFollow; `points` semantics | SystemLog, AuditLog, AdminPanelSettings, Celery* | none |
| Backend code | users auth/account/profile views, services, adapters, cookies, tokens, throttling, share preview, middleware, link-safety services | animes public views, `public_anime_service`, `public_query/*`, recommendations, serializers `anime.py`/`base.py`, `serializers_mixins.py`, `shared/public_cache.py` | list/activity/import/export views + services, `import_service/*`, `user_list_side_effects`, `episode_ratings` | `notification_service`, `push_service`, `notification_tasks_service`, notification tasks, consumers/routing, `asgi.py`, notification views | forums app, reviews, favorites, badges, follows | `admin_api/**`, core admin views/services, middleware, cleanup/logging tasks, Django admin + Jazzmin | `root/settings/production.py`, `features/ops.py`, health views + `apps/core/urls.py`, `migration_health`, `apps/core/checks.py`, gunicorn config, new JSON log formatter + request-id |
| Frontend | auth pages, Settings shell, Profile shell, AuthContext, httpClient, UserMenu | Home, Browse, Detail, Character, VoiceActor, Schedule, AnimeCard, search | StatusSelector, ListEntryEditModal, EpisodesTab, profile list/activity/insights tabs, Import/Export | bell, Notifications pages, NotificationsTab, service worker, `src/pwa/` | forums, review UI, favourites grid, follow UI, badges UI | `pages/admin/**`, AdminLayout/Route, admin.css | `frontend/Dockerfile`, `frontend/nginx.conf` only |
| Infra | – | – | – | – | – | – | `Dockerfile`, `.dockerignore`, both compose files, both Caddyfiles, `deploy-prod.sh`, `.env.example` + new `.env.production.example`, `makefile`, `backups/**`, `infra/**`, `scripts/run_with_migration_check.sh`, `.github/workflows/deploy.yml`, `monitoring/**`, `docs/deploy/*`, `docs/backups.md` |
| Migration space | `users` | none planned (`animes` fallback) | `users`, `animes` | `core` | `forums`, `animes`, `users` | `core` | none |

**Amendments (resolve the gaps the groups flagged):**
1. `apps/animes/signals.py`: the Anime/Genre/Studio cache receivers go to **G2**. The adult-flag
   receivers stay **frozen**. UserAnimeList receivers go to G3, review/favourite receivers to G5.
2. `apps/core/services/celery_tasks.py` (`CoreTaskService`): the notification half
   (`celery_tasks.py:239-535`) moves in the seams commit to
   `apps/core/services/notification_tasks_service.py` (**G4**), with a re-export. The rest is
   **G6**. G4 and G6 both flagged this collision.
3. `apps/users/services/celery_tasks.py` (`UserTaskService`) uses function-level ownership:
   `cleanup_unverified_accounts` and `warm_profile_cache` belong to **G1** (G1 plans to delete
   the latter and its beat entry), the rest to **G3**. The `user-maintenance-daily` beat entry and its kwargs
   (including `unverified_days`) are G3's (`_list_entries`); G1 asks G3 for a kwarg change.
4. `VirtualizedAnimeList.jsx` goes to **G2** (only Browse uses it). `StatsTab.jsx` and
   `StatusDistribution.jsx` stay **G3** (they render list data inside G2's detail page).
5. The new `UserListLink` model is approved in G3's `users` space. The new
   `apps/users/serializers/notifications.py` (moved out of the view module) goes to **G4**. The
   new `apps/users/urlconf/social.py`, `services/badge_service.py` and `services/points_service.py`
   go to **G5**. `apps/core/serializers.py` (Celery-only serializers) goes to **G6**.
6. Seams target `frontend/src/api/queries/recommendations.js` goes to **G2**. The
   `watch-episodes` action on `AnimeViewSet` goes to **G2**, and G3's EpisodesTab consumes it.
7. `frontend/public/boot.js` and the SW (un)registration block in `main.jsx` go to **G4** (via
   the `src/pwa/` module the seams commit creates; see §6). `vite.config.js`'s PWA block stays
   frozen; G4's request C-INT-7 (drop the `/api/v1` runtime cache, which stores authenticated
   responses) is applied by the integrator in the seams commit, because it is a security fix
   that changes no feature.
8. `sentry.js`, `catalog_fixtures.py`, `apps/core/tasks/__init__.py`: **frozen**.
9. Guard tests (`test_query_budgets.py`, `test_public_contract.py`, `test_query_sql_snapshot.py`
   and their snapshots): each group may edit only the test functions and snapshot entries for
   its own endpoints and must call out every budget/contract change in its council packet. The same
   row-level rule applies to `frontend/src/api/queries/__tests__/queryKeys.test.js` (G1, G2, G3, G5 rows) and
   the shim guards `apps/core/tests/test_seams_guard.py` and `frontend/src/api/__tests__/seamsShims.test.js` are
   integrator-owned. The
   integrator regenerates `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json` at each
   merge. G6 owns the Jazzmin half's content, the integrator owns the beat half.
10. `MarkdownRenderer` (G5) also renders G1's bios, so G5's stricter pipeline is opt-in and the
    current default behaviour stays until G1 migrates bios (G1 `resanitize_bios`).
11. **G7 Production readiness** (new stream) owns everything under the matrix's "Infra" row, which
    used to be frozen, plus `root/settings/production.py`, `root/settings/features/ops.py`,
    `gunicorn.conf.py`, `root/{gunicorn_tuning,wsgi}.py`, `apps/core/checks.py` (was frozen), and new
    `root/{log_formatting,request_id}.py`. G7 may edit only the `SETTINGS_ENV` dict of
    `apps/core/tests/test_settings_split.py`.
12. **Health moves from G6 to G7:** `apps/core/views/health.py`, `apps/core/services/migration_health.py`,
    `apps/core/urls.py` and their tests (`test_health_redirects.py`, `test_migration_health.py`,
    `test_production_settings.py`). G6's A20 (readiness migration graph) becomes G7 P1-2. G6 R5/D-9 (Caddy IP
    gate) goes to G7, because G7 owns `Caddyfile.prod`. `apps/admin_api/tests/test_production_readiness.py` stays
    G6's, and G7 keeps the liveness payload it pins.
13. **Routes:** `frontend/src/app/routes.jsx` is now a frozen shell. Each group owns
    `frontend/src/app/routes/<group>.jsx` (`accounts` G1, `browse` G2, `lists` G3, `notifications` G4,
    `community` G5, `admin` G6) and edits its routes there itself. The route "requests to the integrator" in
    specs 1, 4 and 6 (G1 integrator (2), G4 C-INT-6, G6 R2) become the group's own edits.
14. **Settings and beat:** each group owns `root/settings/features/<group>.py` and its own
    `_<domain>_entries()` function in `root/settings/celery_schedule.py` (see 4a). It updates only its own
    keys in the beat half of `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json`, and the integrator
    re-checks the snapshot at each merge. D-7 beat changes therefore land in the owning group's branch.
15. **Signals stay single files with function-level ownership** (amendment 1 and spec 1/3/5 lists).
    Splitting them into packages would reorder receivers on the same signal: today the Anime
    `post_save` receivers run catalog first, then G2's cache receiver, while the Genre receivers run G2's
    first, then the frozen adult-flag ones. That ordering is behaviour, so the prep commit leaves
    `apps/{animes,users}/signals.py` untouched. Each group edits only its named functions, in one isolated hunk.
16. **Query retry default:** the single `defaultOptions.queries.retry` option in
    `frontend/src/app/providers.jsx` belongs to **G2** (smoke finding S-2, section 11). The rest of the file
    stays frozen.

**Frozen for everyone** (integrator-only, by request): catalog ingestion (providers, sync/airing/
metadata/franchise/image/offline tasks, `rate_limiting.py`, `adult_content.py`), `root/settings/{base,
development,test,jazzmin}.py` (groups use their `features/` module), `root/{urls,celery,storage_backends}.py`
(`root/asgi.py` is G4's), `apps/shared/*` (except G2's two files), `apps/core/{api_errors,utils,db_safety}.py`,
`conftest.py`, `pyproject.toml`/`uv.lock`, `package.json`/lockfile, `.github/workflows/ci.yml`, design tokens
(`index.css`, `styles/components/*`), app chrome (`Layout`, `Navbar`, `MobileNav`, `MobileTopBar`, `Footer`),
shared common components and hooks. The prep commit adds these frozen composition files, which no group edits:
`apps/users/models/__init__.py`, `apps/core/models/__init__.py`, `apps/animes/models/__init__.py`,
`apps/users/serializers/users.py` (re-export shim), `apps/users/urls.py` + `apps/users/urlconf/__init__.py`
(composer), `root/settings/features/__init__.py` and the star-import block at the end of `base.py`,
`build_beat_schedule()` and `_catalog_entries()` in `celery_schedule.py`, `frontend/src/app/routes.jsx`,
`frontend/src/app/lazyWithRetry.js`, `frontend/src/api/modules/user.js` and `frontend/src/api/queries/user.js`
(re-export shims), and `frontend/src/api/client.js`. Also frozen: the re-export inits `apps/users/views/__init__.py`, `apps/core/views/__init__.py` and `apps/animes/models/__init__.py` (explicit names). A group adding a view or an animes model imports it from its submodule (`from ..views.lists import NewView` in its urlconf); nobody edits those inits. No new animes model is planned in any spec.

### 4a. Post-seams file map (prep commit on `revamp/base`)

Where the specs say "post-seams" or "seams target", the file now exists. Every group-owned module below starts
out holding exactly the code it took over, and nothing else.

| Seam | G1 | G2 | G3 | G4 | G5 | G6 | G7 |
|---|---|---|---|---|---|---|---|
| `apps/users/models/` (package) | `accounts.py` | – | `lists.py` | – | `social.py`, `badges.py` | – | – |
| `apps/core/models/` (package) | – | – | – | `notifications.py` | – | `logs.py`, `settings.py`, `celery.py` | – |
| `apps/animes/models/` (`user_data.py` removed) | – | `recommendations.py` | `tracking.py` (EpisodeRating, UserHistory) | – | `favorites.py` | – | – |
| `apps/users/serializers/` (`users.py` = shim) | `accounts.py` (+ bio constants) | `recommendations.py` | `lists.py` | `notifications.py` (moved from `views/notifications.py`) | `badges.py`, `favorites.py`, `social.py` | – | – |
| `apps/users/urlconf/` (composed by `urls.py`) | `accounts.py` | – | `lists.py`, `imports.py` | `notifications.py` | `social.py` | – | – |
| `apps/core/services/` | – | – | – | `notification_tasks_service.py` (`CoreTaskService` keeps delegating methods) | – | `celery_tasks.py` (rest) | – |
| `root/settings/features/` | `accounts.py` | `browse.py` | `lists.py` | `notifications.py` | `community.py` | `admin.py` | `ops.py` |
| `celery_schedule.py` functions | `_account_entries` | `_recommendation_entries` | `_list_entries` | `_notification_entries` | – | `_maintenance_entries` (incl. the forum view flush task wrapper) | – |
| `frontend/src/api/modules/` (`user.js` = shim) | (`auth.js`) | `recommendations.js` | `lists.js`, `activity.js`, `imports.js` | `notifications.js` | `favorites.js`, `reviews.js`, `social.js`, `badges.js` | (`admin.js`) | – |
| `frontend/src/api/queries/` (`user.js` = shim) | `profile.js` (profile/user/mini-profile keys) | `recommendations.js` | `lists.js` (list/activity/insights keys, `userQueries.watching`) | (`notifications.js`) | `favorites.js`, `reviews.js`, `social.js`, `badges.js` | (`admin.js`) | – |
| `frontend/src/components/profile/` | `ProfileContent.jsx` (shell) | – | `tabs/AnimeListTab.jsx`, `tabs/ActivityTab.jsx`, `tabs/InsightsTab.jsx` | – | `tabs/FavoritesTab.jsx`, `tabs/ReviewsTab.jsx` (+ `FriendsTab.jsx`) | – | – |
| `frontend/src/app/routes/` | `accounts.jsx` | `browse.jsx` | `lists.jsx` | `notifications.jsx` | `community.jsx` (+ `preloadForumChunks`) | `admin.jsx` | – |
| `frontend/src/pwa/` | – | – | – | `serviceWorker.js` (from `main.jsx`) + `public/boot.js` | – | – | – |
| Contract stubs (section 5) | `services/profile_visibility.py`, `send_email_task(headers=)`, `hooks/useAdultContentPreference.js` | `invalidate_anime_detail`/`invalidate_public_collections`, `patchAnimeListStatus` | `hooks/useListEntryMutation.js` | `notify`/`notify_many`/`retract`/`invalidate_unread_counts` | `services/badge_service.py` | `admin_api/services/audit.py` | – |

Stub tests (owned by the stub's group): `apps/users/tests/{test_profile_visibility,test_email_headers}.py` (G1),
`apps/animes/tests/test_public_cache_contract.py` (G2), `frontend/src/hooks/__tests__/useListEntryMutation.test.jsx`
(G3), `apps/core/tests/test_notify_contract.py` (G4), `apps/users/tests/test_badge_service.py` (G5),
`apps/admin_api/tests/test_audit_service.py` (G6), `frontend/src/hooks/__tests__/useAdultContentPreference.test.jsx` (G1).
A stub's owner may change its implementation freely, but must keep the signature (the rule at the end of section 5).
Backend importers were repointed to the new serializer modules. Frontend importers were left as they were and
still import from `api/client`, `api/modules/user` or `api/queries/user`; the shims star-export the new modules,
so a group may repoint its own files whenever it touches them. The shims are never edited. A new API object or
query export reaches importers through its own module (`api/client.js` lists names explicitly and stays frozen),
so import it from there.

## 5. Cross-group contract register (freeze these before fan-out)

Names below are the ones the provider spec uses. Where a consumer spec used another name, the
provider's name wins (e.g. G5's `record_audit` → G6's `record_admin_action`).

| Provider | Contract | Consumers | Stub in seams commit? |
|---|---|---|---|
| G1 | `apps/users/services/profile_visibility.py::can_view_profile(target_user, viewer) -> bool` and `get_visible_user_or_404(username, viewer)` (is_private rule; new G1 file) | G3 (lists, activity), G5 (reviews `?user=`, forum author filters, follower lists) | Yes, wrapping today's `is_private` check |
| G1 | `apps/users/services/auth_service.py::revoke_all_sessions(user)` | G6 (suspend) | Already exists with this signature (no stub needed) |
| G1 | `send_email_task(..., headers=None)` | G4 (List-Unsubscribe) | Yes (kwarg accepted, passed through) |
| G1 | `useAdultContentPreference()` hook; AuthContext logout calls `detachOnLogout()` then `queryClient.clear()` | G2 (Browse, Schedule); G4 | Hook: yes. Logout order: G1 implements |
| G2 | `public_anime_service.invalidate_anime_detail(slug)`, `invalidate_public_collections()` | G3, G5 (review changes) | Yes (wraps `animes/signals._invalidate_anime_public_caches`, what an `Anime` save does today; the `users/services/cache.py` helper it was planned on is dead code) |
| G2 | `api/queries/anime.js::patchAnimeListStatus(queryClient, animeId, status)` | G3's list hook | Yes (initially = today's invalidate) |
| G2 | `UserStatusMixin` output shape (`user_list_status` …) unchanged; `site_status_distribution` added to detail | G3 | No (G2 implements) |
| G3 | `useListEntryMutation({ anime: {id, slug, episode_count}, entry })` | G2 (AnimeCard, Home, AnimeDetail) | Yes (extracted from today's AnimeCard/StatusSelector logic, no behaviour change) |
| G3 | `user_list_side_effects.site_status_counts(anime_id) -> {watching, completed, on_hold, dropped, plan_to_watch}` | G2 serializer | No (G3 implements; G2 tolerates absence) |
| G3 | List `status` values and `episodes_watched` names unchanged | G4 (episode targeting) | n/a |
| G4 | `notify(recipient, type, *, actor=None, data=None, dedupe_key=None, group_key=None) -> Notification \| None`, `notify_many(recipient_ids, type, *, actor=None, data=None, dedupe_key=None, group_key=None) -> int` (rows written), `retract(recipient, type, *, actor, group_key) -> None`, `invalidate_unread_counts(user_ids) -> None` (module-level in `notification_service.py`; signatures as in spec 4, which wins). Never raises; on_commit delivery; per-type keys in spec 4 | G5 (replies, mentions, likes, follows, badges), G3 (optional import-done), G6 (unread invalidation) | Yes: `notify` maps onto today's `create_*` functions, keys ignored until G4 lands |
| G4 | `NotificationPreference` schema `{category: {channel: bool}}` | G1 (Settings tab host) | No |
| G5 | `grant_badge(user, badge, granted_by, reason)`, `revoke_badge(...)`, `MAX_FEATURED_BADGES = 3` | G6 (admin badges), G2 (`BadgesMixin` literal `[:3]`) | Yes (constant + wrappers over current code) |
| G5 | `useToggleFavorite(kind)` | G2 (AnimeDetail) | Optional |
| G5 | `forums/services/moderation.py` (`list_open_reports`, `resolve_reports`, `open_count`), only if forum reports ship | G6 moderation page (feature-detects the module) | No |
| G6 | `apps/admin_api/services/audit.py::record_admin_action(...)`, new `AuditLog.ActionType` values | G5 (moderation, badge rules) | Yes (writes today's AuditLog row) |

| G7 | Health endpoint paths, status codes and current payload keys (additive only); "the app trusts exactly one proxy hop (Caddy)" in every deploy mode; `LOG_FORMAT` + `request_id` in log lines + `X-Request-ID` echo; `.env.production.example` as the one list of production variables | Everyone (logging through `apps.shared.logger` with `extra=`); G1/G5/G6 (client IP for throttles, view counts, audit) | No (G7 implements) |

**Stub status on `revamp/base`.** Landed in the prep commit, each with a small test of today's behaviour (see 4a):
`can_view_profile`/`get_visible_user_or_404`, `send_email_task(headers=None)` and `useAdultContentPreference` (G1);
`invalidate_anime_detail`/`invalidate_public_collections` and `patchAnimeListStatus` (G2); `useListEntryMutation` (G3);
`notify`/`notify_many`/`retract`/`invalidate_unread_counts` (G4); `grant_badge`/`revoke_badge`/`MAX_FEATURED_BADGES` (G5);
`record_admin_action` (G6). Not stubbed: `revoke_all_sessions` (it already exists in `auth_service.py` with this
signature), `site_status_counts` and `site_status_distribution` (G3/G2 implement; G2 tolerates absence),
`useToggleFavorite` (optional) and `forums/services/moderation.py` (feature-detected). Nothing in the app calls a stub
yet: each consumer switches when it implements its own scope. Stub semantics differ from the final contract in
three places: `notify` ignores `dedupe_key`/`group_key` and suppresses only self-notifications (inactive users and
preferences arrive with G4); `invalidate_anime_detail` still bumps the collection namespace, as an `Anime` save
does today, until G2's P0-2; and `get_visible_user_or_404` uses today's exact-case lookup until G1's A13.

Rule: a contract can change only by a note in both specs plus an integrator ack. No group edits
another group's stub implementation; it only calls it.

## 6. Conflict hotspots and mitigations

| Hotspot | Groups | Mitigation |
|---|---|---|
| `apps/users/serializers/users.py` (745 lines) | G1, G2, G3, G5 | Seams: split into `serializers/{accounts,lists,social,badges,favorites,recommendations,notifications}.py`; `users.py` re-exports |
| `apps/users/urls.py` | G1, G3, G4, G5 | Seams: `apps/users/urlconf/{accounts,lists,imports,social,notifications}.py`, composed in `urls.py`; route names unchanged |
| `apps/users/models.py` | G1, G3, G5 | Seams: models package `apps/users/models/{accounts,lists,social,badges}.py` + `__init__` re-export (same app label, no migration; `makemigrations --check` must stay clean) |
| `apps/core/models.py` | G4, G6 | Seams: package `apps/core/models/{logs,settings,celery,notifications}.py`; also removes G4's "imports header" request (INT-2) |
| `apps/animes/models/user_data.py` | G2, G3, G5 | Seams: split into `favorites.py` (G5), `tracking.py` (EpisodeRating, UserHistory → G3), `recommendations.py` (G2) |
| `apps/core/services/celery_tasks.py` | G4, G6 | Amendment 2 split |
| `apps/animes/signals.py`, `apps/users/signals.py` | G2, G3, G5 / G1, G4, G5 | Function-level ownership. Optional seams split into `signals/` packages if the integrator wants zero shared files |
| `root/settings/base.py` | G1, G2, G4, G5, G6 requests | Seams: empty `root/settings/features/{accounts,browse,lists,notifications,community,admin}.py`, star-imported at the end of `base.py`; each group owns its module (new settings, throttle scopes, documented overrides). Fold back into `base.py` after G6 merges |
| `root/settings/celery_schedule.py` + beat snapshot | G1, G2, G3, G4, G6 | Seams: `_catalog_entries` (frozen), `_account_entries` (G1), `_recommendation_entries` (G2), `_list_entries` (G3), `_notification_entries` (G4), `_maintenance_entries` (G6). Snapshot regenerated per merge |
| `frontend/src/api/modules/user.js`, `api/queries/user.js` | G1, G2, G3, G4, G5 | Seams split (§ brief) + `queries/recommendations.js`; `client.js` keeps the names |
| `components/profile/ProfileContent.jsx` | G1, G3, G5 | Seams: shell + `components/profile/tabs/*` per owner |
| `frontend/src/app/routes.jsx` | G1, G4, G6 | Done: shell + per-group `app/routes/<group>.jsx` files (amendment 13) |
| `pages/Settings.jsx` / `SettingsTabs.jsx` | G1 (host), G4, G5 (tabs) | G1 owns the tab registry. G4/G5 own their tab files. G1 implements `?tab=` (G4 request) |
| `AnimeDetail.jsx` | G2 (page), G3 (list controls, EpisodesTab), G5 (ReviewsSection) | Children are separate files. G2 is the only editor of the page file |
| `AuthContext.jsx` | G1, G4 (logout detach) | G1 implements the call to G4's exported function |
| `package.json`/lockfile | G2 (remove `fuse.js`), G5 (keep `rehype-raw`; maybe add `rehype-sanitize`) | Integrator applies dependency changes at the owning group's merge, never in group branches |
| `main.jsx`, `public/boot.js`, `vite.config.js` | G4 | Seams: `src/pwa/serviceWorker.js` (G4-owned) imported by `main.jsx`; `boot.js` to G4; PWA `/api/v1` cache removed by the integrator |
| Migrations `users` / `core` / `animes` | see §7 | Reserved merge-order numbers; re-point `dependencies` on rebase, never rename |
| Docker/compose/Caddy/deploy/env template | G4 (VAPID env), G6 (Caddy gate), G7 | All G7's (amendment 11). G4's env lines and D-9 land in G7's files |

**Outcome in the prep commit.** Done as listed: the serializer split (plus `notifications.py`), the urlconf split
(one router, so the URL list is identical apart from the order of the `badges` router block, whose prefix overlaps
nothing), the models packages, `user_data.py` split, the `celery_tasks.py` split, `features/*`, the per-domain beat
functions, the frontend `api/modules`, `api/queries` and `ProfileContent` splits, per-group route files (instead of
marked blocks), and `src/pwa/`. Not done: the signals split (amendment 15); `package.json` (integrator, at the
owning group's merge); and G4's C-INT-7 `vite.config.js` change. Removing the PWA `/api/v1` runtime cache changes
behaviour when `VITE_ENABLE_PWA=true`, so it is applied by the integrator at G4's merge. That keeps the prep commit
behaviour-neutral, and the PWA is off by default.

## 7. Migration plan (consolidated)

Policy (unchanged from the brief): names `NNNN_<groupslug>_<desc>`, at most 2 per app per group,
reversible, batched data steps, no committed merge migrations. (Superseded by the reserved ranges below: numbers are fixed and the later-merged group only re-points)
and re-points `dependencies` when it rebases (safe: nothing is deployed). Final numbering under
the recommended merge order:

| App | Leaf today | Proposed (final numbers after merge order) | Group |
|---|---|---|---|
| `users` | 0037 | `0038_accounts_username_ci_unique` (refuses on duplicates, like 0037), `0039_accounts_pending_email` | G1 |
| | | `0040_lists_entry_constraints_import_job` (clamp data, CHECK constraints, import-job fields incl. `cancelled`), `0041_lists_anilist_link` (UserListLink) | G3 |
| | | `0042_community_follow_no_self` (delete self-follows, CHECK, drop redundant index) | G5 |
| `core` | 0009 | `0010_notifications_dedupe_actor_push` (dedupe/group keys + partial uniques, actor FK, pending index, 2048 unique endpoint), `0011_notifications_preferences` (model + batched copy of 4 legacy flags) | G4 |
| | | `0012_admin_auditlog_actions_entity_index`, `0013_admin_drop_celerytaskschedule` | G6 |
| `forums` | 0008 | `0009_community_moderation_subscriptions`, `0010_community_reparent_deep_posts` (data) | G5 |
| `animes` | 0057 (final; slim-down is merged) | none planned; fallback `0058_browse_schedule_airing_idx` only if EXPLAIN demands | G2 |
| | | `0059_community_review_index_cleanup` (index drops only) | G5 |

**Reserved number ranges (binding from `revamp/base`; no empty migrations are created).** Each group
creates its files with its reserved numbers from day one, depending on the leaf that exists on
`revamp/base`. Because the numbers already follow the merge order, a rebase only re-points `dependencies`
to the previous group's last migration. Nobody renames a file. Django orders migrations by the dependency graph,
not by number, so a gap (G3's `0040` depending on `0037` before G1 merges) is fine, and `makemigrations --check`
stays clean on every branch. Unused reserved numbers are skipped, not reused. If a group needs more than its range,
it asks the integrator for the next free number and does not take a neighbour's.

| App | Leaf on `revamp/base` | G1 | G2 | G3 | G4 | G5 | G6 | G7 |
|---|---|---|---|---|---|---|---|---|
| `users` | `0037_customuser_email_ci_unique` | `0038`–`0039` (`accounts_*`) | – | `0040`–`0041` (`lists_*`) | – (no users migration) | `0042` (`community_*`) | – | – |
| `core` | `0009_notification_review_like_and_index` | – | – | – | `0010`–`0011` (`notifications_*`) | – | `0012`–`0013` (`admin_*`) | – |
| `forums` | `0008_thread_category_updated_idx` | – | – | – | – | `0009`–`0010` (`community_*`) | – | – |
| `animes` | `0057_anime_character_unique_voice` | – | `0058` (`browse_*`, fallback index only) | – | – | `0059` (`community_*`) | – | – |

Dependency rules at rebase: G3's `users.0040` → G1's `0039` (or `0037` if G1 shipped none); G5's `users.0042` →
the last of G3's; G6's `core.0012` → G4's `0011`; G5's `animes.0059` → G2's `0058` if G2 used its fallback, else
`0057`. G4's `core.0010` FK to `users.CustomUser` depends on the users leaf present at G4's merge (G1's `0039`).
The specs that drafted other numbers (G3 `0038`/`0039`, G6 `0010`/`0011`, G5 `00NN`/`0058`, G2 "`0057`") now use
these, and so does the final-numbering table above.

**Hotspots that cannot be avoided:** `users` (three groups, five migrations) and `core` (two
groups, four migrations). Both G4 and G6 drafted `0010`/`0011`, so G6 uses its reserved 0012/0013.
Slim-down is merged, so `animes` 0057 is final.

Cross-app dependency to watch: G4's `0010` adds an FK to `users.CustomUser`. Depend on the users
leaf that exists at G4's merge (0039), not on a later group's migration.

**Deferred migrations (do not do in the fan-out):** slim-down's "next release" hand-written drop of
`themes_checked_at`/`themes_status`/`themes_attempt_count` (D1 rollout); dropping UserProfile's
four legacy notification flags (after G4 has been live one release); dropping
`django_celery_beat` tables (G6 R3, deploy-time decision).

## 8. Integration branch recipe (performed; kept for the record)

**Done:** the integration branch is `integration/anishows-overnight` @ 50dcfba (not `integration/feature-revamp`),
and the prep commit sits on `revamp/base` (the tag `revamp-base` is not needed; branch from `revamp/base`).
Fan-out (local only), one worktree per group:

```bash
for g in 1-accounts 2-browse 3-lists 4-notifications 5-community 6-admin 7-production; do
  git worktree add "../aniShows-revamp-$g" -b "feat/revamp-$g" revamp/base
done
git -C ../aniShows-revamp-1-accounts config core.fileMode false   # once: the setting is shared (Windows)
```

The original recipe follows.

Preconditions: the slim-down session has finished and its council has passed; the root
checkout is clean; take slim-down's final tip, not 4fa2d14.

```bash
# from this worktree (or any non-root worktree)
git switch -c integration/feature-revamp fix/anilist-only-and-fixes   # slim-down tip
git merge --no-ff feat/visual-ux-overhaul \
  -m "Merge feat/visual-ux-overhaul into the feature-revamp integration branch"
```

- **Commits included:** slim-down `d961659..<tip>` (14 commits today: 7149a81 … 17f082a,
  4fa2d14) and visuals `94a3919..ab5b3c2` (19 commits). Both already contain `main` (677caa1)
  and the Phase 0–7 merges (common base d961659). Use a real merge, with no cherry-picks or
  squash, so both council-reviewed histories stay intact.
- **Expected textual conflicts: none.** `git merge-tree --write-tree` for 17f082a+ab5b3c2 and
  for 4fa2d14+ab5b3c2 both exit 0 (result trees `ca82ebb…`, `f43ed88…`). The only file both
  sides touched is `frontend/src/components/FranchiseSection.jsx`: a comment on slim-down's
  side, flex/`type="button"` changes on visuals', in separate hunks.
- **Semantic checks after the merge:**
  1. Admin import page: slim-down's `AdminImportJobs.jsx`/`TriggerImportJobForm.jsx`/
     `ImportJobDetails.jsx` must be the merged result, with no `jikan_*` sources and no
     `themes` field (G6 A6/R1; auto-satisfied, verify).
  2. `git grep -i jikan -- frontend/src` shows nothing.
  3. Full gates: `ruff check`, `ruff format --check`, `makemigrations --check --dry-run`,
     `pytest -n auto`, `npm run lint`, `npm run test:run`, `npm run build`.
  4. Do not commit the Windows file-mode flip on
     `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json` (100755→100644) that appears in
     Windows checkouts; set `core.fileMode=false` in the worktrees.
- **Then the seams + contract-stubs commit(s)** on the integration branch, behaviour-neutral:
  every split in §6, the stubs in §5, `api/queries/recommendations.js`, `src/pwa/` module,
  `root/settings/features/*`, per-domain beat functions, routes blocks, removal of the PWA
  `/api/v1` runtime cache. Gate: all tests green, contract/budget/SQL/beat snapshots
  byte-identical, `makemigrations --check` clean (the model packages must not change state).
  Council-review this commit on its own; it is the riskiest mechanical change.
- **Fan-out:** tag `revamp-base`, then
  `git worktree add ../aniShows-revamp-<n> -b feat/revamp-<n>-<slug> revamp-base` for n = 1..6.

## 9. Merge order back into integration and rebase protocol

1. **G1 Accounts & auth.** It owns AuthContext/httpClient/logout, the profile shell, privacy
   (`can_view_profile`) and the first `users` migrations. Everyone touches auth flows in QA.
2. **G4 Notifications.** It gives the `notify` contract its real behaviour before its main
   producers (G5) land, takes `core` 0010/0011, and lands the SW change before anything depends
   on push.
3. **G3 Lists.** It fixes the global cache flush at its source (finding 1) and ships
   `useListEntryMutation`/`site_status_counts`, which G2 consumes. It takes `users` 0040/0041.
4. **G2 Browse.** It is the largest frontend surface; it rebases onto G3's hook and side-effect
   changes, and finalises the public contract/budget snapshots once the producers have settled.
5. **G5 Community.** It consumes the real `notify` (G4), `can_view_profile` (G1) and the detail
   page as G2 left it. It takes `users` 0042, `forums` 0009/0010, `animes` 0059.
6. **G6 Admin.** It consumes everything (moderation for G5, badges, audit, import jobs) and
   uses `core` 0012/0013.
7. **G7 Production readiness.** It has no contract that the others consume before deploy. It rebases
   onto all six, adds every env var they introduced to `.env.production.example` (its gate fails otherwise),
   runs the migration-reversibility script over all fan-out migrations, and does the deploy dry-run on the
   integrated code. Its files are exclusive, so its rebase is mechanical. After it merges, fold
   `root/settings/features/*` back into `base.py`.

Protocol: groups work in parallel from `revamp-base`. When group *k* merges (`--no-ff`, after
its council ≥ 9.5 and gates), each still-open group rebases onto integration, re-points its
migrations, re-runs gates, and gets a short council delta review on the rebase diff. The
integrator regenerates the beat/Jazzmin snapshot and re-runs guard tests after every merge.
After G7: a final full-stack council pass on the integration branch, plus a manual phone and
desktop QA run of every spec's QA script.

## 10. Owner decisions needed before fan-out

(The overnight run applies the defaults in §11, not these recommendations, where they differ.)

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Drop `SessionAuthentication` from DRF defaults (reverses REFACTOR_PLAN D9) because the Google-login Django session outlives JWT logout (G1 A05) | Yes. Django admin keeps sessions natively; enable the browsable API only in DEBUG |
| D-2 | Adult titles on direct links for viewers who have not opted in: 404 or interstitial (G2) | Interstitial with opt-in link (no 404, keeps share links working) |
| D-3 | `status_distribution` meaning (G2/G3) | AniList-only in that field, plus `site_status_distribution` from G3, labelled "On AniList" / "On aniShows" |
| D-4 | Email new-episode notifications default for new users; plan-to-watch alerts only for the premiere (G4 Q1/Q2) | Email off by default; premiere-only for plan-to-watch |
| D-5 | AniList two-way sync | Pull-only now (linked username, Sync now + opt-in daily inside the existing maintenance task). Push via OAuth deferred: AniList limits per IP, so a user token adds no budget (G3) |
| D-6 | Account deletion and others' forum replies (G1/G5) | Keep replies, show "deleted user" (author SET_NULL) |
| D-7 | Beat changes: remove `warm-profile-cache-hourly` (G1) and `collect-queue-metrics-minute` (G6); run `check-new-episodes` hourly at :50 (G4) | Yes to all three |
| D-8 | Remove `django_celery_beat` from `INSTALLED_APPS` (G6 R3) | Yes; drop its tables at deploy |
| D-9 | Caddy IP-gate for `/metrics`, `/api/v1/health/ready/`, `/django-admin/` (G6 R5) | Yes, default-open env matcher |
| D-10 | Lower `PUBLIC_API_CACHE_WAIT_TIMEOUT_MS` to 3000 (G2) | Yes, once finding 1 is fixed |

## 11. Autonomous defaults for tonight

The fan-out runs overnight while the owner is asleep. A §10 item may be applied autonomously
only if it is **safe**: reversible, local only, and not a change of product direction or of
user-visible policy that the owner could object to. Every other item gets a conservative
interim choice: current behaviour kept, a flag defaulting to current behaviour, or deferral.
That way no group blocks on it. Items marked **⚑ CONFIRM** need the owner's sign-off on waking.
Groups must not ship anything beyond these defaults.

| # | Default tonight | Safe? | Interim / how groups proceed | Confirm |
|---|---|---|---|---|
| D-1 Session auth | Keep `SessionAuthentication` in the DRF defaults (owner decision D9 stands). G1 adds `API_SESSION_AUTH_ENABLED = True` in `root/settings/features/accounts.py` and switches the class list on it, with tests for both values. G1 also fixes the actual leak now: logout and refresh-revocation call Django `logout(request)`, so the Google-login session dies with the JWT. | No. It reverses a recorded owner decision. | Flag defaults to current behaviour; the session-leak fix ships (bug fix, no policy change). | ⚑ Flip the flag to `False`? |
| D-2 Adult direct links | Keep current detail-page behaviour for viewers who have not opted in. G2 does not add a 404 or an interstitial. | No. Content policy, user-visible. | Deferred; G2 leaves the detail adult gating as it is today. | ⚑ 404 vs interstitial vs current |
| D-3 `status_distribution` | Apply: AniList counts only in `status_distribution` (G2 normalises the keys on read), G3 stops recounting into it, and the additive `site_status_distribution` comes from `site_status_counts()`. UI labels "On AniList" / "On aniShows". | Yes. Bug fix (counts show 0 today) plus an additive field; reversible; contract-snapshot change called out. | n/a | – |
| D-4 Email default / plan-to-watch alerts | Keep current behaviour: the migration copies the legacy flags faithfully, new users get today's defaults (email on), plan-to-watch users still get every episode. G4 makes both choices named constants in `features/notifications.py` (`NEW_USER_EMAIL_EPISODES = True`, `PLAN_TO_WATCH_ALERTS = "all"`). The pure fixes still ship: no email to unverified addresses, escaped HTML, List-Unsubscribe. | No. User-visible notification policy. | Constants default to current behaviour. | ⚑ Email off for new users? Premiere-only for plan-to-watch? |
| D-5 AniList sync | Apply pull-only: linked username, "Sync now", opt-in daily sync **default off**, run inside the existing maintenance task. No OAuth token storage and no push. | Yes. Additive, opt-in, the conservative reading of the group's brief, no new credentials stored. | Push sync deferred (§12). | – |
| D-6 Forum content of deleted accounts | Keep the current `CASCADE` on `Thread.author`/`Post.author` (`forums/models.py:60,100`). No on_delete migration tonight. G5 adds a test that pins the current behaviour, so the later change is a deliberate one. | No. Data-retention/privacy policy. | Deferred; G5 keeps `forums` migrations free of on_delete changes. | ⚑ Keep replies as "deleted user" (SET_NULL)? |
| D-7 Beat changes | Apply all three, each in the owning group's branch, in its own `_<domain>_entries()` function and its own snapshot keys (amendment 14); the integrator re-checks the snapshot at the merge: remove `warm-profile-cache-hourly` (G1), remove `collect-queue-metrics-minute` (G6), run `check-new-episodes` hourly at :50 (G4). | Yes. Internal scheduling, reversible by restoring the entries; nothing is deployed. | n/a | – |
| D-8 `django_celery_beat` | Apply the code part only: remove it from `INSTALLED_APPS` and Jazzmin (beat uses the default file scheduler; no `--scheduler` anywhere in compose/makefile/deploy). Keep the package in `pyproject.toml` and **do not drop its tables**. | Yes, for the code part (re-adding the app restores it). Dropping tables is not reversible. | Table drop deferred to a deploy-time step. | ⚑ Drop the tables at first deploy? |
| D-9 Caddy IP gate | **G7** applies a default-open matcher (`{$ADMIN_ALLOW_CIDRS:0.0.0.0/0}`) on `/metrics`, `/api/v1/health/ready/`, `/django-admin/*` in `Caddyfile.prod` (G7 P1-2). Behaviour is unchanged until the env var is set. | Yes. A no-op by default, local file only. | n/a | ⚑ Set the real CIDRs before deploy |
| D-10 Cache wait timeout | Apply 3000 ms, but only after G3's merge removes the global flush (finding 1), and only if the budget/caching tests stay green. | Yes. Reversible tuning, not user-visible policy. | If G3 slips, keep 30 s. | – |

**Smoke-test findings (integration branch):**

| Finding | Cause (from code) | Owner | Tonight |
|---|---|---|---|
| S-1 "one pice" returns nothing | Multi-word search ANDs one condition per word (`public_query/filters.py:284-286`). "one" matches by `ILIKE`; "pice" can match only by `word <% title` at `pg_trgm.word_similarity_threshold` (0.5, `SEARCH_WORD_SIMILARITY_THRESHOLD`). **Measured on Postgres 18 (prep commit):** `word_similarity('pice','One Piece') = 0.40`, below 0.5, so the AND drops the row. That is the cause, not configuration (the earlier "≈0.6" estimate was wrong). The whole phrase scores `word_similarity('one pice','One Piece') = 0.667` and `similarity(...) = 0.583`, so an OR'ed whole-phrase match finds it. Fix: `(AND of per-word matches) OR search <% title OR search <% title_jp`; the trigram GIN indexes serve `<%`. Rank stays `search_rank`. Add "one pice" (and a 3-word typo case) to `test_typos_still_find_the_title`, and keep the index-usage/EXPLAIN and SQL-snapshot tests green (regenerate only the search entries, deliberately). | **G2** (`public_query/*`; spec 2 B31/P0-7) | **Safe.** Restores intended behaviour, reversible, covered by tests and the EXPLAIN index-usage test. |
| S-2 the app retries 404s | The QueryClient default is `retry: 1` (`app/providers.jsx:18`), and no query overrides it for client errors, so every 404 (missing anime/character/staff slug, private or missing profile) is fetched twice before the NotFound state shows. G1 A27 covers the profile queries only. | **G2** (amendment 16: owns that one option; spec 2 B32/P1-13). G1 keeps A27 for its own queries | **Safe.** Fewer requests, same final UI; vitest covers it. |
| S-3 `POST /auth/login/` without `username` → 500 | `CustomTokenObtainPairSerializer.validate` (`users/views/auth.py:62-73`) falls through to simplejwt's `validate`, which reads `attrs["username"]` and raises `KeyError`. **Measured:** body `{password}` → 500; `{email: <unknown>, password}` → 500 (the email lookup returns `None`, so no username is set), while `{username: <unknown>}` → 401. The 500-vs-401 difference also tells an attacker whether an email is registered. | **G1** (spec 1 A35/P0-10) | **Safe.** 400 `{username: "Enter a username or email."}` for a missing identifier; an unknown email gets the same 401 as a wrong password. |
| *The Apothecary Diaries* hidden as adult | `adult_content.py` `ADULT_TAGS` contains thematic tags, not only explicit ones ("prostitution", also "incest", "rape", "succubus", "sex", …). Any one of them sets `is_adult`. AniList's own signals (`Media.isAdult`, per-tag `isAdult`) aren't even requested (`providers/anilist/client.py:56` asks only `name rank isGeneralSpoiler isMediaSpoiler`). Proper fix: adult = adult genre OR `Media.isAdult` OR a tag AniList marks `isAdult`; then the nightly `reconcile_adult_flags` re-derives the flags. | **Frozen catalog layer** (slim-down owner / integrator), not a fan-out group. G2 only consumes `is_adult`. | **Not safe.** Changing what counts as adult makes previously hidden titles visible to everyone who has not opted in: content policy. Interim: no change tonight. Groups proceed with `is_adult` as it is. **No group edits `adult_content.py`, the provider query or `reconcile_adult_flags`.** The change waits as a proposal behind `ADULT_RULE = "legacy"` (default, today's tag rule) / `"anilist"`, with a list of titles that would flip. The flag does not exist yet; it is added with the proposal, after the owner's answer. ⚑ CONFIRM |

**Owner checklist on waking:** D-1, D-2, D-4, D-6, D-8 (table drop), D-9 (CIDRs), the adult rule
(`ADULT_RULE` legacy → anilist?), G7 Q1 (HSTS preload/includeSubDomains on a shared domain), G7 Q2 (off-site
backup target).

## 12. Deferred (out of the fan-out)

- TypeScript (REFACTOR_PLAN 6e) and an OpenAPI-generated client: both would touch every
  group's files. Do them after integration as their own project.
- Playwright e2e smoke (login, browse, detail, add-to-list, review, notification): a
  post-integration task on the integration branch, not per group.
- A theme-song source (AnimeThemes) for the retired theme sync (D1 decision 1).
- slim-down's next-release column-drop migration, the legacy notification flag drop, and the
  `django_celery_beat` table drop (§7).
- AniList push sync (D-5), 2FA, email digests, forum reports if G5 does not reach them (G6 feature-detects).
- Changes to the frozen catalog layer that groups requested: G3's public
  `AniListClient.get_media_by_ids`/`run_query`/`save_anime_to_db(download_images=)`, G6's
  read-only `AniListRateLimiter.snapshot()`/`CircuitBreaker.state()`, and G2's optional mapper
  key normalisation. Route these to the slim-down owner as one small follow-up commit on the
  integration branch **before** fan-out if G3 P0/P1 depend on them (G3's import batching does).
  Otherwise defer. **Status:** not in the prep commit, which is limited to behaviour-neutral seams. Tonight G3 uses
  its documented fallback (its own httpx call through `AniListRateLimiter().acquire()`, P1-3), and G6 ships the
  System page's AniList section as "unavailable" (R7). Both switch once the integrator adds the accessors.
- Migration squashing (REFACTOR_PLAN D10: no).

## 13. Gates, baselines and how to measure them

Every group runs these on its branch before each council round, and the integrator runs them after every merge.
On `revamp/base`: 1079 backend tests (the 1052 of 50dcfba + 23 stub tests + 4 seam guards), 291 frontend tests (282 + 7 stub tests + 2 seam guards).

| Gate | Command (from the repo root unless noted) | `revamp/base` |
|---|---|---|
| Backend tests | `docker compose --profile test run --rm test python -m pytest -n 12 -q` | 1079 passed |
| Lint | `python -m ruff check .` | clean |
| Format | `python -m ruff format --check .` | clean (415 files) |
| Migrations | `python manage.py makemigrations --check --dry-run` (test settings) | "No changes detected" |
| **Type check** | `python -m mypy .` inside the backend image (`anishows_web:*`, mypy 1.19.1, the `[tool.mypy]` config in `pyproject.toml`) | **421 errors** in 104 files (530 checked); 427 at 50dcfba |
| Frontend tests | `cd frontend && npx vitest run` | 291 passed |
| ESLint | `cd frontend && npx eslint .` | clean |
| Build | `cd frontend && NODE_OPTIONS=--max-old-space-size=4096 npx vite build` (on Windows `npm run build` fails on the POSIX env syntax; use this) | OK |

**mypy rule:** no group may raise the count above **421**, measured with the exact command above.
(Re-baselined on `release/anishows-rc`: the measured count is now the ceiling in
`scripts/check_mypy_ceiling.py`, enforced in CI and by `make typecheck`.) The prep commit
moved code without adding errors. The drop from 427 to 421 is mypy reporting each missing-stubs
(`import-untyped`) note once per run, at the first import site, and the splits changed which site that is. Because
of that, a refactor can shift the raw count by a few without any real change. If the number moves and you did not
add type errors, compare normalized error lines (path + message, line numbers stripped) against
`revamp/base`; only genuinely new error lines count against you. Fixing existing errors in your own files is welcome.
