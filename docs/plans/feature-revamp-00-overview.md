# Feature revamp 00: overview, ownership and integration plan

> Planning only. Nothing here has been performed. Local only: no push, no PR, no deploy.
> Bases: backend `fix/anilist-only-and-fixes` (specs read at 17f082a; the tip is now 4fa2d14,
> which only touches the catalog/provider layer and adds `animes/0057_anime_character_unique_voice`),
> frontend `feat/visual-ux-overhaul` @ ab5b3c2 (19 commits, council 9.5/9.5/9.7).

## 1. The plan in one paragraph

Build a local `integration/feature-revamp` branch: slim-down, then visuals merged in. On top of
it, add one behaviour-neutral **seams + contract-stubs** commit that splits the six shared
"god files" along group lines and adds the cross-group helper signatures as thin wrappers over
today's behaviour. Branch six worktrees from that commit and run the six groups in parallel.
Merge them back in this order: **G1 Accounts → G4 Notifications → G3 Lists → G2 Browse →
G5 Community → G6 Admin**. Each later group rebases (and renumbers its migrations) before its
final council round. The order follows the contracts: identity and notify come first, then the
data producers, then the read path, then community, and admin last because it consumes all of
them.

## 2. Spec index

| # | Spec | Lines | Headline P0 |
|---|---|---|---|
| 1 | [feature-revamp-1-accounts-auth.md](feature-revamp-1-accounts-auth.md) | 383 | Register without email → 500; "Resend verification" always 500s; query cache not cleared on logout/account switch; Google login leaves a Django session that survives logout |
| 2 | [feature-revamp-2-browse-discover.md](feature-revamp-2-browse-discover.md) | 278 | Browse search never ranks by relevance; any list edit flushes all public caches site-wide; recommendations ignore the adult setting and resurrect dismissed titles; synchronous refresh in the web worker |
| 3 | [feature-revamp-3-lists-anilist-sync.md](feature-revamp-3-lists-anilist-sync.md) | 424 | Profile list/insights read only 20 rows per status; imports stuck in "processing" forever after the time limit; AniList score formats mis-scaled; JSON export preview always crashes |
| 4 | [feature-revamp-4-notifications-push.md](feature-revamp-4-notifications-push.md) | 504 | Web push has never worked end to end (no subscribe flow, SW unregistered by default, 200-char endpoint column, dead-subscription pruning never fires); push follows the previous account on shared devices |
| 5 | [feature-revamp-5-community.md](feature-revamp-5-community.md) | 448 | Replies deeper than 10 levels saved but never shown; follow toggle returns multiplied counts; review edit can move a review to another anime; favourite reorder collides across pages |
| 6 | [feature-revamp-6-admin.md](feature-revamp-6-admin.md) | 503 | SPA admin actions are never audited (JWT is invisible to middleware); staff can make the worker fetch any URL/local path via import jobs; maintenance bypass broken for JWT staff; logs grow unbounded |

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

| Area | G1 Accounts | G2 Browse | G3 Lists | G4 Notifications | G5 Community | G6 Admin |
|---|---|---|---|---|---|---|
| Models | CustomUser, UserProfile (identity/privacy/appearance), SocialLinkChangeLog | UserRecommendation; read-path indexes only | UserAnimeList, UserActivity, UserImportJob, UserStats, EpisodeRating, UserHistory, **new UserListLink** | Notification, PushSubscription, **new NotificationPreference** | forums.*; Review*, UserFavorite*; Badge, UserBadge, UserFollow; `points` semantics | SystemLog, AuditLog, AdminPanelSettings, Celery* |
| Backend code | users auth/account/profile views, services, adapters, cookies, tokens, throttling, share preview, middleware, link-safety services | animes public views, `public_anime_service`, `public_query/*`, recommendations, serializers `anime.py`/`base.py`, `serializers_mixins.py`, `shared/public_cache.py` | list/activity/import/export views + services, `import_service/*`, `user_list_side_effects`, `episode_ratings` | `notification_service`, `push_service`, notification tasks, consumers/routing, `asgi.py`, notification views | forums app, reviews, favorites, badges, follows | `admin_api/**`, core admin views/services, middleware, cleanup/logging tasks, Django admin + Jazzmin |
| Frontend | auth pages, Settings shell, Profile shell, AuthContext, httpClient, UserMenu | Home, Browse, Detail, Character, VoiceActor, Schedule, AnimeCard, search | StatusSelector, ListEntryEditModal, EpisodesTab, profile list/activity/insights tabs, Import/Export | bell, Notifications pages, NotificationsTab, service worker | forums, review UI, favourites grid, follow UI, badges UI | `pages/admin/**`, AdminLayout/Route, admin.css |
| Migration space | `users` | none planned (`animes` fallback) | `users`, `animes` | `core` | `forums`, `animes`, `users` | `core` |

**Amendments (resolve the gaps the groups flagged):**
1. `apps/animes/signals.py`: the Anime/Genre/Studio cache receivers go to **G2**. The adult-flag
   receivers stay **frozen**. UserAnimeList receivers go to G3, review/favourite receivers to G5.
2. `apps/core/services/celery_tasks.py` (`CoreTaskService`): the notification half
   (`celery_tasks.py:239-535`) moves in the seams commit to
   `apps/core/services/notification_tasks_service.py` (**G4**), with a re-export. The rest is
   **G6**. G4 and G6 both flagged this collision.
3. `apps/users/services/celery_tasks.py` (`UserTaskService`) uses function-level ownership:
   `cleanup_unverified_accounts` and `warm_profile_cache` belong to **G1** (G1 plans to delete
   the latter and its beat entry), the rest to **G3**.
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
   its own endpoints and must call out every budget/contract change in its council packet. The
   integrator regenerates `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json` at each
   merge. G6 owns the Jazzmin half's content, the integrator owns the beat half.
10. `MarkdownRenderer` (G5) also renders G1's bios, so G5's stricter pipeline is opt-in and the
    current default behaviour stays until G1 migrates bios (G1 `resanitize_bios`).

**Frozen for everyone** (integrator-only, by request): catalog ingestion (providers, sync/airing/
metadata/franchise/image/offline tasks, `rate_limiting.py`), `root/settings/*` (except via
§6 feature modules), `root/{urls,celery,storage_backends}.py`, `apps/shared/*` (except G2's
two files), `apps/core/{api_errors,utils,db_safety,checks}.py`, `conftest.py`,
`pyproject.toml`/`uv.lock`, `package.json`/lockfile, Docker/compose/Caddy/deploy, design tokens
(`index.css`, `styles/components/*`), app chrome (`Layout`, `Navbar`, `MobileNav`,
`MobileTopBar`, `Footer`), shared common components and hooks.

## 5. Cross-group contract register (freeze these before fan-out)

Names below are the ones the provider spec uses. Where a consumer spec used another name, the
provider's name wins (e.g. G5's `record_audit` → G6's `record_admin_action`).

| Provider | Contract | Consumers | Stub in seams commit? |
|---|---|---|---|
| G1 | `apps/users/services/profile_visibility.py::can_view_profile(target_user, viewer) -> bool` and `get_visible_user_or_404(username, viewer)` (is_private rule; new G1 file) | G3 (lists, activity), G5 (reviews `?user=`, forum author filters, follower lists) | Yes, wrapping today's `is_private` check |
| G1 | `apps/users/services/auth_service.py::revoke_all_sessions(user)` | G6 (suspend) | Yes (blacklist outstanding tokens) |
| G1 | `send_email_task(..., headers=None)` | G4 (List-Unsubscribe) | Yes (kwarg accepted, passed through) |
| G1 | `useAdultContentPreference()` hook; AuthContext logout calls `detachOnLogout()` then `queryClient.clear()` | G2 (Browse, Schedule); G4 | Hook: yes. Logout order: G1 implements |
| G2 | `public_anime_service.invalidate_anime_detail(slug)`, `invalidate_public_collections()` | G3, G5 (review changes) | Yes (wrap the existing `users/services/cache.py::invalidate_anime_detail_cache`) |
| G2 | `api/queries/anime.js::patchAnimeListStatus(queryClient, animeId, status)` | G3's list hook | Yes (initially = today's invalidate) |
| G2 | `UserStatusMixin` output shape (`user_list_status` …) unchanged; `site_status_distribution` added to detail | G3 | No (G2 implements) |
| G3 | `useListEntryMutation({ anime: {id, slug, episode_count}, entry })` | G2 (AnimeCard, Home, AnimeDetail) | Yes (extracted from today's AnimeCard/StatusSelector logic, no behaviour change) |
| G3 | `user_list_side_effects.site_status_counts(anime_id) -> {watching, completed, on_hold, dropped, plan_to_watch}` | G2 serializer | No (G3 implements; G2 tolerates absence) |
| G3 | List `status` values and `episodes_watched` names unchanged | G4 (episode targeting) | n/a |
| G4 | `notify(recipient, type, *, actor=None, data=None, dedupe_key=None, group_key=None) -> int`, `notify_many(recipients, type, *, actor, data)`, `retract(recipient, type, *, actor, group_key)`, `invalidate_unread_counts(user_ids)`. Never raises; on_commit delivery; per-type keys in spec 4 | G5 (replies, mentions, likes, follows, badges), G3 (optional import-done), G6 (unread invalidation) | Yes: `notify` maps onto today's `create_*` functions, keys ignored until G4 lands |
| G4 | `NotificationPreference` schema `{category: {channel: bool}}` | G1 (Settings tab host) | No |
| G5 | `grant_badge(user, badge, granted_by, reason)`, `revoke_badge(...)`, `MAX_FEATURED_BADGES = 3` | G6 (admin badges), G2 (`BadgesMixin` literal `[:3]`) | Yes (constant + wrappers over current code) |
| G5 | `useToggleFavorite(kind)` | G2 (AnimeDetail) | Optional |
| G5 | `forums/services/moderation.py` (`list_open_reports`, `resolve_reports`, `open_count`), only if forum reports ship | G6 moderation page (feature-detects the module) | No |
| G6 | `apps/admin_api/services/audit.py::record_admin_action(...)`, new `AuditLog.ActionType` values | G5 (moderation, badge rules) | Yes (writes today's AuditLog row) |

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
| `frontend/src/app/routes.jsx` | G1, G4, G6 | Seams: per-group marked blocks; groups edit only their block |
| `pages/Settings.jsx` / `SettingsTabs.jsx` | G1 (host), G4, G5 (tabs) | G1 owns the tab registry. G4/G5 own their tab files. G1 implements `?tab=` (G4 request) |
| `AnimeDetail.jsx` | G2 (page), G3 (list controls, EpisodesTab), G5 (ReviewsSection) | Children are separate files. G2 is the only editor of the page file |
| `AuthContext.jsx` | G1, G4 (logout detach) | G1 implements the call to G4's exported function |
| `package.json`/lockfile | G2 (remove `fuse.js`), G5 (keep `rehype-raw`; maybe add `rehype-sanitize`) | Integrator applies dependency changes at the owning group's merge, never in group branches |
| `main.jsx`, `public/boot.js`, `vite.config.js` | G4 | Seams: `src/pwa/serviceWorker.js` (G4-owned) imported by `main.jsx`; `boot.js` to G4; PWA `/api/v1` cache removed by the integrator |
| Migrations `users` / `core` / `animes` | see §7 | Merge-order numbering, renumber on rebase |

## 7. Migration plan (consolidated)

Policy (unchanged from the brief): names `NNNN_<groupslug>_<desc>`, at most 2 per app per group,
reversible, batched data steps, no committed merge migrations. The later-merged group renumbers
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
| `animes` | 0057 (slim-down may add more) | `0058_community_review_index_cleanup` (index drops only) | G5 |
| | | none planned; fallback `browse_schedule_airing_idx` only if EXPLAIN demands | G2 |

**Hotspots that cannot be avoided:** `users` (three groups, five migrations) and `core` (two
groups, four migrations). Both G4 and G6 drafted `0010`/`0011`, so G6 renumbers to 0012/0013.
`animes` stays risky only while slim-down is still adding migrations. Take its final leaf at
integration time; G5 re-points if slim adds 0058.

Cross-app dependency to watch: G4's `0010` adds an FK to `users.CustomUser`. Depend on the users
leaf that exists at G4's merge (0039), not on a later group's migration.

**Deferred migrations (do not do in the fan-out):** slim-down's "next release" hand-written drop of
`themes_checked_at`/`themes_status`/`themes_attempt_count` (D1 rollout); dropping UserProfile's
four legacy notification flags (after G4 has been live one release); dropping
`django_celery_beat` tables (G6 R3, deploy-time decision).

## 8. Integration branch recipe (not performed)

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
   page as G2 left it. It takes `users` 0042, `forums` 0009/0010, `animes` 0058.
6. **G6 Admin.** It consumes everything (moderation for G5, badges, audit, import jobs) and
   renumbers `core` to 0012/0013. Fold `root/settings/features/*` back into `base.py` after it.

Protocol: groups work in parallel from `revamp-base`. When group *k* merges (`--no-ff`, after
its council ≥ 9.5 and gates), each still-open group rebases onto integration, renumbers its
migrations, re-runs gates, and gets a short council delta review on the rebase diff. The
integrator regenerates the beat/Jazzmin snapshot and re-runs guard tests after every merge.
After G6: a final full-stack council pass on the integration branch, plus a manual phone and
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
| D-7 Beat changes | Apply all three at the owning group's merge (integrator regenerates the beat snapshot): remove `warm-profile-cache-hourly` (G1), remove `collect-queue-metrics-minute` (G6), run `check-new-episodes` hourly at :50 (G4). | Yes. Internal scheduling, reversible by restoring the entries; nothing is deployed. | n/a | – |
| D-8 `django_celery_beat` | Apply the code part only: remove it from `INSTALLED_APPS` and Jazzmin (beat uses the default file scheduler; no `--scheduler` anywhere in compose/makefile/deploy). Keep the package in `pyproject.toml` and **do not drop its tables**. | Yes, for the code part (re-adding the app restores it). Dropping tables is not reversible. | Table drop deferred to a deploy-time step. | ⚑ Drop the tables at first deploy? |
| D-9 Caddy IP gate | Apply a default-open matcher (`{$ADMIN_ALLOW_CIDRS:0.0.0.0/0}`) on `/metrics`, `/api/v1/health/ready/`, `/django-admin/*` in `Caddyfile.prod`. Behaviour is unchanged until the env var is set. | Yes. A no-op by default, local file only. | n/a | ⚑ Set the real CIDRs before deploy |
| D-10 Cache wait timeout | Apply 3000 ms, but only after G3's merge removes the global flush (finding 1), and only if the budget/caching tests stay green. | Yes. Reversible tuning, not user-visible policy. | If G3 slips, keep 30 s. | – |

**Smoke-test findings (integration branch):**

| Finding | Cause (from code) | Owner | Tonight |
|---|---|---|---|
| "one pice" returns nothing | Multi-word search ANDs one condition per word (`public_query/filters.py:284-286`): "one" matches by `ILIKE`, "pice" only by `title <% word` at `pg_trgm.word_similarity_threshold`. pg_trgm scores "pice" against "piece" at about 0.6 (3 of 5 trigrams), so it should pass the configured 0.5 (`base.py:298-312`) but fails the 0.6 server default (`<%` is strictly greater than). First check `SHOW pg_trgm.word_similarity_threshold` on the smoke DB: if it isn't 0.5, the `options` startup parameter isn't reaching the connection (integrator config, frozen settings). Either way the per-word AND is brittle for short misspelt words. Fix: OR in a whole-phrase match (`search <% title` / `title_jp`), which is index-servable ("one pice" vs "One Piece" ≈ 0.78), and add "one pice" to `test_typos_still_find_the_title`. Index-usage tests must stay green. | **G2** (`public_query/*`); a config cause goes to the integrator | **Safe.** Restores intended behaviour, reversible, covered by tests and the EXPLAIN index-usage test. |
| *The Apothecary Diaries* hidden as adult | `adult_content.py` `ADULT_TAGS` contains thematic tags, not only explicit ones ("prostitution", also "incest", "rape", "succubus", "sex", …). Any one of them sets `is_adult`. AniList's own signals (`Media.isAdult`, per-tag `isAdult`) aren't even requested (`providers/anilist/client.py:56` asks only `name rank isGeneralSpoiler isMediaSpoiler`). Proper fix: adult = adult genre OR `Media.isAdult` OR a tag AniList marks `isAdult`; then the nightly `reconcile_adult_flags` re-derives the flags. | **Frozen catalog layer** (slim-down owner / integrator), not a fan-out group. G2 only consumes `is_adult`. | **Not safe.** Changing what counts as adult makes previously hidden titles visible to everyone who has not opted in: content policy. Interim: no change tonight. Groups proceed with `is_adult` as it is. Prepare the change as a proposal behind `ADULT_RULE = "legacy"` (default) / `"anilist"`, with a list of titles that would flip. ⚑ CONFIRM |

**Owner checklist on waking:** D-1, D-2, D-4, D-6, D-8 (table drop), D-9 (CIDRs), the adult rule.

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
  Otherwise defer.
- Migration squashing (REFACTOR_PLAN D10: no).
