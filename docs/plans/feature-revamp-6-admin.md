# Feature revamp 6: Admin
> Base: backend fix/anilist-only-and-fixes@17f082a, frontend feat/visual-ux-overhaul@ab5b3c2. Planning only.

Path convention: backend paths are in SLIM (the slim-down tree); `frontend/src/...` paths are in WT. `L` = line.

## Summary
The admin is broad: a staff SPA with 16 pages, about 45 API routes, Celery control, logs, settings and Jazzmin. But several basics are broken:
- No admin action made from the SPA is ever audited.
- Staff (not only superusers) can make a worker fetch any URL or open any local path through the import-job trigger.
- Maintenance mode locks out SPA staff.
- Every request log and every minute task writes extra rows that are never deleted, so the database grows without limit on the 8 GB VPS.
- The WT admin import page breaks against the SLIM API.

This group fixes those (P0). It then adds four lightweight daily-use features (P1), all on existing Postgres, Redis and Celery:
- a real moderation queue (resolve, dismiss, remove), with audit entries;
- suspend and restore a user with a reason, which also ends their sessions;
- one System page (queues, workers, beat last-run, AniList budget, database size) that replaces the fake "schedules" CRUD and the scattered Celery endpoints;
- an accessible table, dialog and confirm toolkit for admin pages, including a card layout on phones.

It needs no new services. It adds no beat entries (retention runs inside the existing daily cleanup task) and two `core` migrations.

## Current state

### Models (apps/core/models.py, owned by G6)
| Model | Lines | Notes |
|---|---|---|
| `SystemLog` | 26-67 | Fields: level, log_type, user FK, `user_ip`, method, path, status_code, message, `details` JSON (user agent, query), duration. Indexes on (level,ts), (log_type,ts), (user,ts). No retention. |
| `AuditLog` | 70-121 | action choices `CREATE/UPDATE/DELETE/LOGIN/LOGOUT/EXPORT/BULK_ACTION`; entity_type/id/repr; previous_state, new_state, changes, metadata. Retention is only a manual Django-admin action (`apps/core/admin.py:276-286`). |
| `AdminPanelSettings` | 124-141 | One JSON row `key="global"`. Cached in Redis for 300s plus a 2s in-process cache (`apps/core/services/admin_settings_service.py:12-147`). |
| `CeleryTaskResult` | 143-227 | A row is created for every task by `task_prerun` (`apps/core/celery_signals.py:47-84`). Cleaned after 7 days. |
| `CeleryWorkerStatus` | 230-258 | Written only when an admin GETs `celery/workers/` (`apps/core/services/celery_admin_service.py:391-402`). |
| `CeleryTaskSchedule` | 261-330 | DB "schedules" CRUD. Beat never reads it: beat runs the file scheduler (`docker-compose.prod.yml:73`) with the static `CELERY_BEAT_SCHEDULE`. |

### Endpoints (all under `/api/v1/admin/`, `apps/admin_api/urls.py`; default permission `IsAdminUser` = staff or superuser; [SU] = superuser-only)
| Route | View | Perm | Used by SPA |
|---|---|---|---|
| `users/` GET; `users/{id}/` GET, DELETE[SU]; `users/{id}/toggle_active/`, `toggle_staff/` POST[SU] | `views/users.py:44` | mixed | yes |
| `badges/` CRUD, `grant/`, `revoke/` [SU]; `holders/` GET | `apps/users/views/admin_badges.py:20` | mixed | yes |
| `anime/` GET, DELETE[SU] | `views/anime.py:49` | mixed | yes |
| `genres/`, `studios/`, `characters/`, `staff/` CRUD (writes SU) | `views/anime.py:84-159` | mixed | yes |
| `offline-sync-states/` GET; `{id}/retry|mark_skipped|set_ids_and_retry|merge_target/` POST[SU] | `views/anime.py:162` | mixed | **no** |
| `reviews/` GET, DELETE[SU]; `reviews/reports/` GET; `reviews/{id}/reports/resolve/` POST (staff) | `views/reviews.py:27` | mixed | resolve: **no** |
| `user-lists/` GET, `{id}` GET/DELETE[SU], `bulk_delete/`[SU] | `views/users.py:109` | mixed | yes (page not in nav) |
| `favorites/` GET, DELETE[SU], `stats/` | `views/users.py:161` | mixed | yes (page not in nav) |
| `import-jobs/` GET; `{id}/cancel/` POST; `trigger/` POST | `apps/core/views/admin_import_jobs.py:57` | **staff for all** | yes |
| `logs/` GET, `logs/stats/`; `audit-logs/` GET | `views/logs.py:36,57` | staff | audit-logs: **no** |
| `dashboard/`, `stats/export/` (JSON), `reports/?type&days` GET | `views/dashboard.py`, `views/reports.py:11` | staff | yes |
| `bulk/` POST | `views/reports.py:33` | SU | yes |
| `settings/` GET, PUT[SU] | `views/settings.py:11` | mixed | yes |
| `celery/tasks/results/` GET, DELETE[SU], `bulk_delete/`[SU], `stats/` | `apps/core/views/celery_admin.py:55` | mixed | **no** |
| `celery/tasks/schedules/` CRUD, `enable/disable/run_now/` [SU] | `celery_admin.py:116` | mixed | **no** |
| `celery/dashboard/`, `celery/workers/` GET; `celery/tasks/trigger/`, `celery/tasks/control/`, `celery/workers/control/` POST[SU] | `celery_admin.py:223` | mixed | **no** |

Other routes:
- `/api/v1/health/` and `/api/v1/health/ready/` (`apps/core/views/health.py:52,61`): public.
- `/metrics` (`apps/core/views/monitoring.py`): basic auth.
- `/django-admin/` (Jazzmin, `root/settings/jazzmin.py`).
- All four are exposed by `Caddyfile.prod:37,77,88`.

### Celery (G6 task wrappers)
| Task | Where | Beat entry |
|---|---|---|
| `cleanup_old_task_results` | `apps/core/tasks/cleanup_tasks.py:9` | `cleanup-task-results-daily`, 01:00 (`root/settings/celery_schedule.py:158-163`) |
| `health_check_workers` | `cleanup_tasks.py:24` | hourly at :15 (`:164-168`) |
| `collect_queue_metrics` | `cleanup_tasks.py:38` | every minute (`:117-121`) |
| `flush_forum_view_counts` | `cleanup_tasks.py:30` | every minute (`:180-184`); the logic is G5's |
| `cleanup_celery_backend` | `cleanup_tasks.py:19` | none (does nothing) |
| `log_request_async`, `log_audit_async`, `log_exception_async` | `apps/core/tasks/logging_tasks.py` | none; queued per request by `apps/core/middleware/logging_middleware.py` |

### Middleware (`root/settings/base.py:234-253`)
Order: `SiteControlMiddleware` → `LoggingMiddleware` → `AdminAuditMiddleware` → `UserActivityMiddleware` (G1) → `ExceptionLoggingMiddleware`.

### Frontend (WT)
- Routes: `frontend/src/app/routes.jsx:65-85,144-168`, all lazy.
- Pages: `pages/admin/*.jsx` (16 pages, about 7.6k lines). Components: `pages/admin/components/{DataTable,Modal,BulkActions}.jsx`, `importJobs/*`, `reports/*`, `badges/*`.
- Hooks: `pages/admin/hooks/useAdminQuery.js` (`useAdminQuery`, `useAdminList`, `useAdminMutation`, `getAdminErrorMessage`).
- Query keys: `api/queries/admin.js` (`adminKeys` under `['admin', ...]`, `adminBadgeKeys`). `api/modules/admin.js` covers badges only; the other pages call `api.get('/admin/...')` inline.
- Shell: `components/AdminLayout.jsx` (491 lines; sidebar plus the admin's own notification bell, which polls every 30s), `components/AdminRoute.jsx` (inline-styled spinner), `components/MaintenanceScreen.jsx`, `frontend/src/admin.css`.
- Tests: `pages/admin/__tests__/{AdminUsers,AdminDashboard,AdminGenres}.test.jsx`, `pages/admin/hooks/__tests__/useAdminQuery.test.jsx`.

### Backend tests
- `apps/admin_api/tests/test_admin_route_permissions.py` checks only that a regular user is refused on every route. It does not check staff against superuser.
- Also: `test_celery_admin_api.py`, `test_offline_sync_admin_api.py`, `test_production_readiness.py` (settings, review-report flow, bulk safety, the user-toggle permissions, audit path parsing, report cache, maintenance mode with `force_authenticate`, health).
- `apps/core/tests/test_admin_import_jobs*.py`, `test_celery_admin_validation.py`, `test_health_redirects.py`, `test_settings_split.py` (beat and Jazzmin snapshot).

## Problems found
| ID | Sev | Area | Problem | Evidence | Fix ref |
|---|---|---|---|---|---|
| A1 | High | Audit | `AdminAuditMiddleware` reads `request.user` **before** the view runs. JWT authentication happens inside DRF, so every SPA (Bearer) admin action looks anonymous and is never audited. Only the badge views write audit rows. As a result the "recent activity" list on the Reports page is always empty. | `apps/core/middleware/logging_middleware.py:134-136`; `apps/users/views/admin_badges.py:54,65,128,172`; `apps/admin_api/services/reports_service.py:202-215`; SPA uses Bearer (`frontend/src/api/httpClient.js:213`) | P0-1 |
| A2 | High | Security | `import-jobs/trigger/` and `cancel/` accept **staff**. The trigger passes `source_url` / `source_path` straight to the worker, which opens that local path or fetches that URL (SSRF / local-file read). `limit` has no upper bound (AniList budget). The Celery trigger, by contrast, is superuser-only and allowlisted. | `apps/core/views/admin_import_jobs.py:57-60,97-121`; `apps/core/services/admin_import_jobs_service.py:408-418,520-529`; `apps/animes/services/offline_catalog.py:465-470` | P0-2, P0-3 |
| A3 | High | Maintenance (M9) | The staff bypass checks the session user, which is anonymous under JWT. Staff therefore get 503 on public APIs during maintenance. Tests use `force_authenticate`, which hides the bug. Still not fixed. | `apps/core/middleware/site_control_middleware.py:34-35`; `docs/REFACTOR_PLAN.md:191-195`; `apps/admin_api/tests/test_production_readiness.py:348-356` | P0-4 |
| A4 | High | Logs / DB | **(1) Write cost per log row.** Each logged request is queued as a Celery task. `task_prerun` then also creates and updates a `CeleryTaskResult` row and stores the full `log_data` (IP, user agent, path) unredacted in `task_args`. So one request log costs one Redis message plus three writes. | `apps/core/middleware/logging_middleware.py:96-99`; `apps/core/celery_signals.py:61-69` | P0-5 |
| | | | **(2) Minute tasks.** Two tasks run every minute, which adds about 2,880 result rows a day. | `root/settings/celery_schedule.py:117-121,180-184` | |
| | | | **(3) No retention.** Nothing ever deletes `SystemLog` or `AuditLog` rows. | — | |
| A5 | High | Logs | `LoggingMiddleware` takes `user_id` before the view runs, so every JWT request is logged as anonymous. | `logging_middleware.py:88-89` | P0-1 |
| A6 | High | Merge | The WT admin import UI does not match the SLIM API: it sends `source: 'jikan_enrichment'`, which SLIM rejects with 400, and it reads `selectedOfflineEnrichment.themes.completed`, which SLIM no longer returns, so the page crashes with a TypeError. SLIM's frontend copy has the fixed versions of these three files. | `frontend/src/pages/admin/AdminImportJobs.jsx:97-99,132`; `pages/admin/components/importJobs/TriggerImportJobForm.jsx:37,43-47,88-92,145`; `importJobs/ImportJobDetails.jsx:93`; `git diff d961659 17f082a -- frontend/src/pages/admin` | P0-6 |
| A7 | Med | Celery | `trigger_task` accepts any `queue` string. A typo queue receives tasks that no worker consumes. `default_queue` in `AVAILABLE_TASKS` also disagrees with `task_routes` (thumbnails are `low_priority` vs `images`; recommendations are `low_priority` vs `analytics`). | `apps/core/views/celery_admin.py:246`; `apps/core/services/celery_admin_service.py:74,44,285-288`; `root/celery.py:88,96` | P0-7 |
| A8 | Med | Celery | `worker_control` `shutdown` with no worker named shuts down **all** workers. It is exposed over HTTP with no audit entry and no UI. | `celery_admin_service.py:415-420`; `celery_admin.py:310-334` | P0-7 |
| A9 | Med | Errors | Failure responses echo `str(exc)` to the client. | `celery_admin.py:217,273,294,307,331`; `admin_import_jobs.py:135` | P0-7 |
| A10 | Med | Celery | `CeleryTaskSchedule` CRUD, enable/disable and the dashboard's `scheduled_count` describe schedules that beat never runs. `django_celery_beat` is installed, but its tables are unused (they still show in Jazzmin). | `celery_admin.py:116-220`; `celery_admin_service.py:467-469`; `root/settings/base.py:153`; `docker-compose.prod.yml:73` | P1-3 |
| A11 | Med | Monitoring | Queue sizes are read with the **cache** Redis client (DB 0), but the broker is DB 1. `collect_queue_metrics` therefore always reports 0 while running every minute. | `apps/core/services/celery_monitoring.py:22-38`; `root/settings/base.py:585-586,597` | P1-3 |
| A12 | Med | Monitoring | `health_check_workers` judges health from `CeleryWorkerStatus.last_heartbeat`. That field is updated only when an admin opens `celery/workers/`, so the hourly task warns "unhealthy" indefinitely. The GET handler also writes to the database and makes four broadcast inspect calls. | `apps/core/services/celery_tasks.py:85-121`; `celery_admin_service.py:366-402` | P1-3 |
| A13 | Med | Data | Admin anime list annotates `Count("favorites")` and `Count("reviews")` **without** `distinct`. The two joins multiply each other, so `favorites_count = reviews_count = favs × reviews`. | `apps/admin_api/services/anime_admin_service.py:16-21` | P1-5 |
| A14 | Med | Perf | Users list and the "active users" report count three multi-valued joins (`anime_lists × reviews × favorites`) per user. The report does this over all users. | `apps/admin_api/views/users.py:62-71`; `reports_service.py:294-310` | P1-5 |
| A15 | Med | Moderation | **(1) Heuristic queue.** The "reports" queue mixes real user reports with heuristics. With the default `min_score=1`, every review rated 3 or lower, or tagged as a spoiler, shows up as "reported". | `apps/admin_api/views/reviews.py:109-131` | P1-1 |
| | | | **(2) Cost.** The queue counts six distinct annotations over the votes × reports join, then runs five more counts over the same annotated queryset. | `reviews.py:66-108,176-186` | |
| | | | **(3) No resolve in the SPA.** The SPA has no resolve or dismiss button (the endpoint exists), so reports can only be cleared by deleting the review. | `frontend/src/pages/admin/AdminReviewReports.jsx:26-40` | |
| | | | **(4) Inconsistent permissions.** `resolve` is open to staff, while review `destroy` is superuser-only. | `reviews.py:37,195` | |
| A16 | Med | Users | `toggle_active` is not idempotent (a double click undoes the ban). It stores no reason and does not end sessions; access tokens stay valid until they expire (unverified whether simplejwt rejects them earlier). Bulk ban works the same way. | `apps/admin_api/services/user_admin_service.py:17-37`; `apps/admin_api/services/bulk_operations_service.py:127-145` | P1-2 |
| A17 | Med | Bulk | **(1) No safety rails.** No cap on the number of ids, no int validation (`id__in=["x"]` gives a 500), no transaction, no dry run, no audit entry. | `bulk_operations_service.py:24-30` | P1-4 |
| | | | **(2) Misleading counts.** `deleted_count` includes cascaded rows, so "Deleted N anime" overstates the number of anime. | `bulk_operations_service.py:92-94` | |
| | | | **(3) Status edits get reverted.** Bulk anime `update_status` uses `.update()`, which bypasses caches and signals, and the next AniList sync overwrites it. | `bulk_operations_service.py:71-86` | |
| A18 | Med | Settings | 16 of 23 settings are not enforced anywhere, including the security toggles in the UI: `twoFactorAuth`, `ipBlocking`, `apiRateLimit`, `sessionTimeout`, `maxLoginAttempts`, `requireStrongPassword`. Only maintenance, registration, email verification, username change, username length and reviews are read by code. | `apps/admin_api/services/settings_service.py:15-47`; grep of `get_admin_setting` callers; `frontend/src/pages/admin/AdminSettings.jsx:274-305` | P1-6 |
| A19 | Med | PII | Every staff account can read every user's IP and user agent in `logs/`, and the task kwargs (including log payloads) in Celery results. | `apps/users/admin_serializers.py:69-79` (`fields="__all__"`); `celery_admin.py:62-76` | P0-2 |
| A20 | Med | Health | `/api/v1/health/ready/` is public and unthrottled, yet builds a `MigrationExecutor` graph on every hit. | `apps/core/views/health.py:84-88`; `apps/core/services/migration_health.py:5-8`; `Caddyfile.prod:37` | P1-5 |
| A21 | Med | Logs | The logging middleware excludes `"/health/"` and `"/admin/logs/"`, which never match the real `/api/v1/...` paths. All admin GETs are logged because of `always_log_prefixes`. Combined with the Logs page polling (A27), an open logs tab writes about 5,760 `SystemLog` rows a day. | `logging_middleware.py:19-28,109-110`; `frontend/src/pages/admin/AdminLogs.jsx:28-51` | P0-5 |
| A22 | Low | Remnant | The offline-sync filter accepts `stage=themes`, which builds `themes_status`. SLIM removed that field (`apps/animes/models/sync.py:66-72` has only metadata and franchise), so the request fails with a FieldError (500). | `anime_admin_service.py:103-104` | P1-10 |
| A23 | Low | Dead code | **(1)** Celery `tasks` action is never routed. **(2)** Duplicate in-view superuser checks behind the mixin. **(3)** Legacy import `source` aliases and `trigger_anilist_import`. **(4)** `ANILIST_SYNC_TASK` / `TRENDING_REFRESH_TASK` aliases. **(5)** `_format_task_result` wrapper. **(6)** `cleanup_celery_backend` does nothing. | `celery_admin.py:227-239` vs `urls.py:67-92`; `celery_admin.py:78-94`, `views/anime.py:72-76`; `admin_import_jobs.py:66-69,104-121`; `admin_import_jobs_service.py:25-27,512-517`; `cleanup_tasks.py:19-21` | P1-10 |
| A24 | Low | Jazzmin | **(1)** Icon keys use `animes.*`, but the app label is `anime` (`apps/animes/apps.py:7`), so the icons never apply. **(2)** The "API Admin" link opens the JSON dashboard endpoint. **(3)** The custom link points to `core_celerytaskresult_changelist`, but that model is not registered in Django admin. **(4)** `django_celery_beat` icons and ordering are still listed. **(5)** `show_ui_builder: True` in production. | `root/settings/jazzmin.py:18,24,38-46,64-77,96-101,124`; `apps/core/admin.py:1-12` | P1-10 |
| A25 | Low | Metrics | Basic-auth credentials are compared with `==`, not in constant time. | `apps/core/views/monitoring.py:161` | P1-10 |
| A26 | Low | Data | Favorites `stats` returns the raw ImageField name (`anime__cover_image`) ahead of the external URL, so posters show as relative paths. The dashboard sends `cover_image`, which the page never renders. | `apps/admin_api/views/users.py:212-217`; `apps/admin_api/services/dashboard_service.py:71-75` | P2-5 |
| A27 | Med | UX | The Logs page and the admin notification bell poll every 30s, even in a background tab. The bell shows the admin's **personal** notifications and maps them to unrelated admin pages (a `new_follower` notification opens `/admin/users`). | `AdminLogs.jsx:41-50`; `frontend/src/components/AdminLayout.jsx:37-46,82-99` | P1-8, P1-9 |
| A28 | Med | a11y | **(1) Confirmations.** 19 destructive actions use native `confirm()`, including user delete and bulk deletes. | `AdminUsers.jsx:55,67,78`; `AdminAnime.jsx:56`; `AdminGenres.jsx:86,98`, etc. | P1-7 |
| | | | **(2) Modal.** No `role="dialog"`, `aria-modal`, focus trap or focus restore; the close button is an unlabeled "✕". | `pages/admin/components/Modal.jsx:38-56` | |
| | | | **(3) DataTable.** Sortable headers are `<th onClick>` with no button and no `aria-sort`. It sorts **only the current page**. Rows are clickable but unreachable by keyboard; checkboxes have no labels. | `DataTable.jsx:62-81,106-114,145-158` | |
| | | | **(4) Icon buttons.** They use `title` only and sit at `opacity-50` until hover, which fails AA on touch. | `AdminUsers.jsx:238-262` | |
| A29 | Med | UX | **(1) Phones.** Tables only scroll sideways (`overflow-x-auto`); there is no phone layout. | `DataTable.jsx:93` | P1-7 |
| | | | **(2) Search.** Search inputs send one request per keystroke, and each request is logged (A21). | `AdminUsers.jsx:116`; `AdminLogs.jsx:133-134` | |
| | | | **(3) Staff vs superuser actions.** Staff see superuser-only buttons and get a 403 when they click them. | `AdminUsers.jsx:241-259` | |
| A30 | Low | UX | **(1) Style.** Emoji or dingbats in 16 admin files, which breaks the minimal style (`AdminLogs.jsx:99-106`; `AdminSettings.jsx:66-69`; `AdminReviews.jsx:82` and others). There are also 30 `backdrop-blur` and 17 glow/pulse effects. | | P1-7 |
| | | | **(2) Fake link.** Dashboard "popular" cards show a hover chevron but are not links. | `AdminDashboard.jsx:255-272` | |
| | | | **(3) Orphan pages.** `user-lists` and `favorites` have routes but no nav entry. | `frontend/src/app/routes.jsx:160-161` vs `AdminLayout.jsx:242-291` | P1-9 |
| | | | **(4) Mislabelled nav item.** "Import Jobs" (catalog imports) sits under the Users nav section. | | P1-9 |
| A31 | Low | Validation | `int(min_score)` raises an unhandled ValueError (500). Reports accept any `days` value, which creates unbounded cache keys. | `apps/admin_api/services/user_list_admin_service.py:15`; `reports_service.py:46-56` | P1-5 |
| A32 | Low | Audit | Badge audit uses `REMOTE_ADDR`, which behind Caddy is the proxy's IP. Badge update is not audited. | `admin_badges.py:54-56`; no `perform_update` | P0-1 |
| A33 | Low | Perf | The system-logs list has no `select_related("user")`, so the serializer's `username` causes an N+1. | `apps/admin_api/views/logs.py:47-49`; `admin_serializers.py:77-79` | P1-5 |
| A34 | Med | Tests | Missing tests: a staff-vs-superuser route matrix, audit entries under real JWT, the maintenance bypass under JWT, logging attribution, staff refused on import triggers, query budgets for admin lists. | `test_admin_route_permissions.py:45-54` | P1-11 |

Jikan / Mongo / Typesense: none left in SLIM's admin-owned backend (grep is clean). WT still has them: A6, plus the WT backend copies (`apps/core/services/admin_import_jobs_service.py:136,306,448,525`, `celery_admin_service.py:14,27`, `apps/core/views/admin_import_jobs.py:104-127`), which the slim merge replaces. Remaining theme-sync remnant: A22. Stats export is JSON (`AdminReports.jsx:64-76`); there is no CSV, so no CSV-injection risk today.

## Proposed scope

### P0 (bugs, security, data integrity)
- **P0-1 Reliable audit trail (A1, A5, A32). Size M.**
  - Add `apps/admin_api/services/audit.py::record_admin_action(request, *, action, entity_type, entity_id="", entity_repr="", previous=None, new=None, metadata=None, reason="")`. It does a synchronous `AuditLog.objects.create`, takes the IP from `core.utils.get_client_ip`, truncates `entity_repr` to 200 characters, and sets `request._admin_audited = True`.
  - Call it from every mutating admin path:
    - users: suspend, restore, staff toggle, delete
    - reviews: delete, resolve
    - genres, studios, characters, staff: `perform_create`, `perform_update`, `perform_destroy`, recording the changed fields
    - offline-sync actions
    - bulk operations: one `BULK_ACTION` row with the ids and counts
    - import trigger and cancel; Celery trigger and revoke; beat run-now
    - settings PUT (old/new diff)
    - badges: create, update, delete, grant, revoke (`admin_badges.py`)
  - Change `AdminAuditMiddleware` so it resolves the user **after** `get_response`. It becomes a fallback: it writes a generic row only when `request._admin_audited` is unset, so no endpoint is missed and nothing is logged twice.
  - `LoggingMiddleware` reads the user after the response too (the same trick `UserActivityMiddleware` uses, `apps/users/middleware/activity_middleware.py:24-26`).
  - Files: `apps/admin_api/services/audit.py` (new), `apps/core/middleware/logging_middleware.py`, every admin view and service.
- **P0-2 One permission model (A2, A19). Size M.**
  - **Staff (moderators):** read the dashboard, reports, catalog lists, users and audit log; moderation (resolve or dismiss reports, delete reviews, mark spoilers); suspend or restore non-staff users.
  - **Superuser only:** everything else that writes or exposes secrets:
    - catalog CRUD and deletes, bulk operations
    - import trigger and cancel, the Celery trigger, revoke and results
    - `logs/` and `logs/stats/` (they contain IPs and user agents)
    - settings PUT, staff toggle, user delete, suspending a staff account
    - offline-sync mutations
  - Put the rules in one declarative map, `apps/admin_api/permissions.py::ADMIN_ACTION_POLICY` (viewset to `{action: "staff"|"superuser"}`), applied by one mixin that **fails closed**: an action missing from the map is superuser-only.
  - Remove the in-view duplicate checks (`celery_admin.py:79-94`, `anime.py:72-76`).
  - Files: `apps/core/permissions.py`, `apps/admin_api/permissions.py` (new), the admin views, `apps/core/views/{admin_import_jobs,celery_admin}.py`.
- **P0-3 Harden the import-job trigger (A2). Size S.**
  - Drop `source_url` and `source_path` from the API; they stay available to the management command only.
  - Validate `release_tag` against `^(latest|[0-9A-Za-z._-]{1,40})$`, and allow only `DEFAULT_ASSET_NAME` for `asset_name`.
  - Clamp `limit`: trending ≤ 500, slices ≤ 500, `full_catalog` ≤ 5000. Clamp `batch_size` to 1-500.
  - Validate `status` against `Anime.AnimeStatus`.
  - Return 409 when the same task is already PENDING or STARTED (no double-trigger).
  - Error responses use generic messages and log the details.
  - Keep only the four canonical `source` values.
  - Files: `apps/core/views/admin_import_jobs.py`, `apps/core/services/admin_import_jobs_service.py`.
- **P0-4 Maintenance bypass for JWT staff (A3). Size S.**
  - In `SiteControlMiddleware`, only when maintenance is on and the session user is not staff, run `JWTAuthentication().authenticate(request)` on the Django request and catch `AuthenticationFailed`/`InvalidToken`. Staff get through.
  - No cost when maintenance is off.
  - Add `/api/v1/health/` to the exempt list (it already is) and keep the existing exempt paths.
  - File: `apps/core/middleware/site_control_middleware.py`.
- **P0-5 Bound log volume and add retention (A4, A21). Size M.**
  - **(a) Stop untracked tasks writing rows.** In `celery_signals.py`, add `UNTRACKED_TASKS` = the three `log_*_async` tasks, `collect_queue_metrics` and `flush_forum_view_counts`. These skip `CeleryTaskResult` entirely and instead write one cache key, `celery:lastrun:<task>`, with a TTL of 2 days (used for the System page). Other tasks store `task_args` truncated to 2 KB.
  - **(b) Logging middleware rules.**
    - Excluded paths: `/api/v1/health/`, `/metrics`, `/api/v1/admin/logs/`, `/static/`, `/media/`.
    - Always logged: mutating `/api/v1/admin/` requests, POSTs under `/api/v1/auth/`, 5xx, 403, 429.
    - 401 and 404 are sampled at `REQUEST_LOG_SUCCESS_SAMPLE_RATE`, because token refreshes and bots dominate them.
  - **(c) Retention.** `CoreTaskService.prune_admin_records()` deletes in batches of 5,000 by id: `SystemLog` INFO and WARNING after 14 days, ERROR and CRITICAL after 30 days; `AuditLog` after 365 days. Constants live in `celery_tasks.py`. It is called at the end of the existing `cleanup_old_task_results` task, so the task name, kwargs, beat entry and snapshot stay unchanged.
  - Files: `apps/core/celery_signals.py`, `apps/core/middleware/logging_middleware.py`, `apps/core/services/celery_tasks.py`, `apps/core/tasks/cleanup_tasks.py`.
- **P0-6 Admin import UI matches the SLIM API (A6). Size S.**
  - The integrator takes SLIM's versions of `AdminImportJobs.jsx`, `importJobs/ImportJobDetails.jsx` and `importJobs/TriggerImportJobForm.jsx` when merging slim into the integration branch (request R1).
  - G6 then guards optional progress groups (`selectedOfflineEnrichment?.franchises`) so a missing group never crashes the page, and adds a vitest.
- **P0-7 Narrow the Celery control surface (A7-A9). Size S.**
  - Remove the `queue` override and `default_queue`. `send_task` then follows `task_routes`, which is also what the `tasks` listing reports.
  - Remove `shutdown` from `worker_control`. Ping moves into the System page; the `celery/workers/control/` route is deleted.
  - `control_task` (revoke) stays superuser-only and is audited.
  - All error responses become generic.
  - Files: `apps/core/views/celery_admin.py`, `apps/core/services/celery_admin_service.py`, `apps/admin_api/urls.py`.

### P1 (daily-use UX, missing tests)
- **P1-1 Moderation queue (A15). Size M.**
  - `GET /admin/moderation/reviews/?status=open|in_review|resolved|dismissed&reason=&page=` lists one row per review that has at least one report matching the filter.
    - Fields: review snippet (200 characters), author, anime, report counts by reason, reporter count, first and last report time, `has_spoilers`.
    - Implemented with one `ReviewReport` aggregate subquery, not a join fan-out.
  - Heuristic signals (low rating, spoiler tag, empty text) are only an opt-in filter, `?signals=1`, and never count as reports.
  - `POST /admin/moderation/reviews/{review_id}/resolve/` with `{outcome: "dismiss"|"remove_review"|"mark_spoiler", notes}`:
    - runs in one transaction;
    - updates the open reports to `resolved` or `dismissed` with `resolved_by`, `resolved_at` and `resolution_notes`;
    - deletes the review via `Review.delete()` (so G5's signals still fire), or sets `has_spoilers=True`;
    - writes one audit row (`RESOLVE` or `DISMISS`).
  - `GET /admin/moderation/summary/` returns open counts and powers the nav badge, polled every 60s in the foreground only.
  - SPA: `pages/admin/AdminModeration.jsx` replaces `AdminReviewReports.jsx`; `/admin/review-reports` redirects to it.
  - Forum reports join later through a G5 service (see contracts).
  - Deprecate `reviews/reports/` and `reviews/{id}/reports/resolve/`: they are kept for one release and delegate to the new service.
  - Files: `apps/admin_api/services/moderation_service.py`, `apps/admin_api/views/moderation.py` (new), `views/reviews.py`, `urls.py`, the frontend page and nav.
- **P1-2 Suspend and restore with a reason (A16). Size M.**
  - `POST /admin/users/{id}/suspend/` with `{reason}` (required, 3-500 characters). Idempotent:
    - sets `is_active=False`;
    - calls G1's `revoke_all_sessions(user)` (`apps/users/services/auth_service.py:25`);
    - writes an audit row (`SUSPEND`, `reason` in metadata).
  - `POST /admin/users/{id}/restore/` reverses it, also with a reason and an audit row.
  - Refusals: acting on yourself; any target that is a superuser; a staff target unless the actor is a superuser.
  - The reason lives in `AuditLog` rows, so `CustomUser` needs no new field.
  - `GET /admin/users/{id}/` gains `moderation_history`: the last 10 `AuditLog` rows for entity `User`/id, using the new index.
  - Bulk `ban`/`unban` route through the same service and require a reason.
  - Remove `toggle_active`. Keep `toggle_staff` (superuser), but make it explicit as `{is_staff: bool}`.
  - SPA: a user detail drawer (profile basics, counts, history) plus a Suspend dialog with a reason field.
  - Files: `apps/admin_api/services/user_admin_service.py`, `views/users.py`, `bulk_operations_service.py`, `frontend/src/pages/admin/AdminUsers.jsx`, `pages/admin/components/UserDrawer.jsx` (new).
- **P1-3 System page (A10-A12). Size L.**
  - `GET /admin/system/` (staff read; the action fields only work for superusers) returns:
    - (a) **queues:** `LLEN` per routed queue on the **broker** connection (`current_app.connection_for_read()` channel client, or `redis.from_url(settings.CELERY_BROKER_URL)`).
    - (b) **workers:** `control.ping(timeout=1.0)` plus `inspect().active()` counts, cached 15s.
    - (c) **beat:** for each `settings.CELERY_BEAT_SCHEDULE` entry: task, kwargs, schedule text, last run (the latest `CeleryTaskResult.date_created` per task name in one `values().annotate(Max)` query, or the cache key for untracked tasks), next due (`schedule.remaining_estimate(last_run)`), and `stale` (more than 15 minutes past due).
    - (d) **AniList:** `{limit, used_this_minute, paused_until, breaker_state}` through the requested accessor (R7). If the accessor is missing, the section shows "unavailable".
    - (e) **database:** `pg_database_size` and the top 8 tables by `pg_total_relation_size`, cached 300s.
    - (f) **health:** database, cache and migrations (the migrations result cached 60s).
    - (g) **failures:** the last 10 failed task results.
  - `POST /admin/system/beat/{entry}/run/` (superuser): sends that entry's task with its **configured** kwargs; the client cannot supply args. Audited; returns 409 if the task is in flight.
  - Rewrite `health_check_workers` to ping workers and upsert `CeleryWorkerStatus`, so its warnings are true.
  - Fix `celery_monitoring.get_queue_size` to read the broker.
  - Delete `CeleryTaskSchedule`: its model, serializers (`apps/core/serializers.py:98-280`), viewset and routes. Also delete the routes `celery/dashboard/`, `celery/workers/`, `celery/workers/control/` and `celery/tasks/results/stats/`. `celery/tasks/results/` list and detail stay (superuser) for drill-down.
  - SPA: `pages/admin/AdminSystem.jsx`, with sections as cards and tables, refreshed manually (with a "Refresh" button and the time of the last update) and not polled.
  - Files: `apps/admin_api/{services/system_service.py,views/system.py}` (new), `apps/core/services/{celery_monitoring,celery_admin_service,celery_tasks}.py`, `apps/core/views/celery_admin.py`, `apps/core/serializers.py` (R6), `apps/core/models.py`, migration 0011.
- **P1-4 Bulk-operation safety (A17). Size S.**
  - At most 100 ids, each coerced to a positive int, otherwise 400.
  - `transaction.atomic()`.
  - `dry_run: true` returns `{matched, would_delete_by_model}` from `Collector` without deleting anything.
  - Response counts use `deleted_by_model[<model label>]`.
  - Remove anime `update_status`. Delete operations require `confirm: "<count>"` to equal the number of matches.
  - One audit row per operation.
  - File: `bulk_operations_service.py`, plus `BulkActions.jsx`, which shows the dry-run counts in the confirm dialog.
- **P1-5 Query cost and correctness (A13, A14, A20, A31, A33). Size M.**
  - Anime admin list: `Subquery` counts (or `Count(distinct=True)` with separate `Avg`), which fixes the inflated numbers.
  - Users list: replace the three join counts with three correlated `Subquery(Count)`.
  - Report "top active users": three grouped queries over `user_id` limited to the period (`[:50]` each), merged in Python.
  - Review queue: see P1-1.
  - Logs list: `select_related("user")`; `stats` covers only the last 24h unless filters are given.
  - Readiness: cache `has_pending_migrations` for 60s in-process; liveness stays cheap.
  - Clamp `days` to {7, 30, 90, 365}; return 400 on a bad `min_score`.
  - Dashboard and system payloads cached 60s with `?refresh=1` (dashboard: about 12 queries today; cache key `admin:dashboard:v1`).
- **P1-6 Settings that do what they say (A18). Size S.**
  - Keep only the enforced keys: `general.{maintenanceMode, allowRegistration}`, `users.{emailVerification, allowUsernameChange, minUsernameLength, maxUsernameLength}`, `content.{enableReviews}`.
  - `merge_admin_settings` already drops unknown keys, so stored data stays harmless.
  - PUT stores an old→new diff in the audit log.
  - The maintenance toggle uses a confirm dialog that explains "staff keep access".
  - The accessor signatures used by G1 and G5 do not change.
  - Files: `apps/admin_api/services/settings_service.py`, `apps/core/services/admin_settings_service.py` (defaults), `AdminSettings.jsx`, `test_production_readiness.py`.
- **P1-7 Admin UI toolkit and a11y (A28-A30). Size L.** New admin-local files under `pages/admin/components/`:
  - `ConfirmDialog.jsx`: `role="alertdialog"`, focus trap through the shared `useFocusTrap`, a destructive button in `#7c3aed`/red text, and an optional "type the name to confirm" for user delete, anime delete and bulk deletes of more than 10.
  - `Modal.jsx` rewritten: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap and restore, lucide `X` with `aria-label="Close"`.
  - `DataTable.jsx`:
    - Sorting moves to the server: it passes `ordering` up through `onSort`, and the client-side sort of the current page is removed.
    - Headers become `<button>`s with `aria-sort`.
    - Rows open through an explicit "View" button, not a row click.
    - Checkboxes get `aria-label="Select <name>"`.
    - Below `sm` it renders cards (stacked label/value, actions in one row, 44px targets, 16px gutters).
  - `hooks/useDebouncedValue.js` (300ms) for every search input.
  - Icon buttons get `aria-label` and full opacity.
  - Superuser-only actions are hidden for staff, via `user.is_superuser` from `AuthContext`.
  - Swap emoji and dingbats for lucide icons. Remove `backdrop-blur`, `animate-pulse` and glow, keeping `admin.css` tokens and the existing violet accents.
  - Empty and error states use `components/common/ErrorState` and keep the existing toasts.
  - `AdminRoute.jsx` uses `PageLoader` instead of its inline-styled spinner.
- **P1-8 Logs page (A21, A27). Size S.**
  - Polling is off by default. A "Live" toggle refetches every 30s, foreground only, and announces "Live" through `aria-live`.
  - Superuser-only (P0-2).
  - New "Audit" tab on the existing `audit-logs/` endpoint, with filters for action, entity type and user, plus a link from a user drawer entry to that user's audit entries.
  - Detail modal shows the `details` JSON in a `<pre>`.
- **P1-9 Navigation and layout cleanup (A27, A30). Size S.**
  - Remove the personal notification bell from `AdminLayout`, which drops the G4 hook dependency. In its place, a moderation badge on the Moderation nav item.
  - Nav sections:
    - Overview: Dashboard, Analytics
    - Moderation: Queue, Reviews
    - Users: Users, Badges
    - Catalog: Anime, Genres, Studios, Characters, Staff
    - System: System, Catalog imports, Logs, Settings, Django admin
  - `user-lists` and `favorites` are removed as pages. Per-user lists and favorites counts show in the user drawer; favorites stats are already in Analytics. Their endpoints are deleted, except `favorites/stats`, which Analytics uses.
  - The sidebar becomes a disclosure (`aria-expanded`, Escape closes it, focus returns to the toggle).
- **P1-10 Remnants and dead code (A22-A25). Size S.**
  - Remove `themes` from the offline-sync stage filter.
  - Delete the dead and duplicate code listed in A23.
  - Jazzmin: icon keys `anime.*`; "API Admin" → `/admin` (the SPA); delete the Celery custom link, or register a read-only `CeleryTaskResultAdmin` (chosen: register read-only, so the link works); remove the `django_celery_beat` and `core.CeleryTaskSchedule` entries; `show_ui_builder: False`. Snapshot updated through R6.
  - `/metrics` compares with `hmac.compare_digest`.
- **P1-11 Tests.** See the acceptance criteria.

### P2
- **P2-1** Quarantine tab in Catalog imports, on `offline-sync-states/`: retry, skip, set ids, merge, all audited. Size M.
- **P2-2** Characters and Staff: read and delete only (drop create and edit), if it is confirmed that sync overwrites manual edits (unverified). Size S.
- **P2-3** Move the inline `api.get('/admin/...')` calls into `api/modules/admin.js` and `api/queries/admin.js` (`adminQueries.*`). Size M.
- **P2-4** Django admin: register `ReviewReport` (list filter on status) and read-only `AdminPanelSettings`. Size S.
- **P2-5** Favorites stats poster uses `cover_image.url` or the external URL; dashboard popular cards link to the anime admin row or the public page. Size S.
- **P2-6** Restyle `MaintenanceScreen` to the minimal tokens: a `#7c3aed` solid button, no white pill. Size S.

### Out of scope
- Flower, Grafana and Prometheus servers.
- CSV exports. If one is ever added, cells starting with `= + - @` must be prefixed with `'`.
- 2FA, IP blocking and an API rate-limit UI.
- Forum moderation backend (G5).
- Badge rules (G5).
- Notification preferences (G4).
- Changing the beat schedule (frozen).
- Changing the catalog sync semantics.

## File ownership
May change (post-seams paths):

**Prep commit (`revamp/base`), see overview section 4a.** These now exist and are G6's:
- Models: `apps/core/models/{logs,settings,celery}.py` (bodies and headers; R6/R8 done)
- `apps/core/services/celery_tasks.py`, now without the notification half; it keeps three one-line delegators to G4's
  `NotificationTaskService`. Leave them, or delete them once nothing calls them.
- `root/settings/features/admin.py`
- `_maintenance_entries()` in `celery_schedule.py`: D-7's `collect-queue-metrics-minute` removal (R4) is G6's own edit,
  plus that snapshot key.
- `frontend/src/app/routes/admin.jsx`: R2 is G6's own edit.
- Contract stub (keep the signature): `apps/admin_api/services/audit.py::record_admin_action(request, *, action,
  entity_type, entity_id="", entity_repr="", previous=None, new=None, metadata=None, reason="")` (+
  `tests/test_audit_service.py`). It writes today's `AuditLog` row, with the IP from `get_client_ip` and `reason` stored
  in `metadata`, and sets `request._admin_audited`.
- **Moved to G7** (overview amendment 12): `apps/core/views/health.py`, `apps/core/services/migration_health.py` and
  their tests, so drop A20 and the "Readiness" bullet of P1-5. R5 (the Caddy IP gate, D-9) also goes to G7.
  `apps/admin_api/tests/test_production_readiness.py` stays G6's.
- R3 (`django_celery_beat` out of `INSTALLED_APPS`) is still an integrator step at G6's merge (`base.py` is frozen).
- Migration space: `core` `0012`–`0013`.

- **admin_api:** `apps/admin_api/**`, including new `services/{audit,moderation_service,system_service}.py`, `views/{moderation,system}.py`, `permissions.py`, and tests `tests/test_admin_permission_matrix.py`, `test_admin_audit.py`, `test_moderation_api.py`, `test_user_suspension.py`, `test_system_api.py`, `test_bulk_operations.py`, `test_admin_query_budgets.py`.
- **core:**
  - `apps/core/views/{admin_import_jobs,celery_admin,monitoring}.py` (`health.py` is G7's)
  - `apps/core/services/{admin_import_jobs_service,admin_settings_service,celery_admin_service,celery_monitoring,celery_tasks}.py` (`migration_health.py` is G7's; the R8 split is done)
  - `apps/core/middleware/*`, `apps/core/tasks/{cleanup_tasks,logging_tasks}.py`, `apps/core/celery_signals.py`, `apps/core/permissions.py`
  - models `SystemLog`, `AuditLog`, `AdminPanelSettings`, `CeleryTaskResult`, `CeleryWorkerStatus`, `CeleryTaskSchedule`
  - migrations `apps/core/migrations/0012_admin_*.py`, `0013_admin_*.py` (reserved)
  - tests `apps/core/tests/test_site_control_middleware.py`, `test_logging_middleware.py`, `test_log_retention.py`, `test_celery_signals_tracking.py` (new), plus the existing `test_admin_import_jobs*.py`, `test_celery_admin_validation.py`
- **Django admin:** `apps/{core,users,animes,forums}/admin.py`, `apps/{users,animes}/admin_serializers.py`, `apps/users/views/admin_badges.py`, `root/settings/jazzmin.py`.
- **Pending R6:** `apps/core/serializers.py` and the `JAZZMIN_SETTINGS` half of `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json`.
- **Frontend:**
  - `frontend/src/pages/admin/**`, including new `AdminModeration.jsx`, `AdminSystem.jsx`, `components/{ConfirmDialog,UserDrawer}.jsx`, `hooks/useDebouncedValue.js`, and tests in `pages/admin/__tests__/` and `pages/admin/components/__tests__/`
  - delete `AdminReviewReports.jsx`, `AdminUserLists.jsx`, `AdminFavorites.jsx`
  - `frontend/src/components/{AdminLayout,AdminRoute,MaintenanceScreen}.jsx`, `frontend/src/admin.css`, `frontend/src/api/modules/admin.js`, `frontend/src/api/queries/admin.js`

**Precedence (prep commit):** where this list names a file or directory that the *Prep commit* block above grants (a `root/settings/features/` module, a `celery_schedule.py` function, an `app/routes/` file, `boot.js`, a split module), the grant wins; everything else in this list stays forbidden. The frozen shells and shims (overview section 4) stay forbidden.

Must not touch:
- **Frozen:** `root/settings/{base,production,celery_schedule}.py`, `root/{urls,celery}.py`, `apps/core/{utils,api_errors,checks,db_safety}.py`, `apps/core/models/notifications.py` (G4) and the `apps/core/models/__init__.py` composer, `apps/shared/*`, catalog services and tasks (`apps/animes/services/{rate_limiting,offline_*}.py`, ...), `Caddyfile.prod`, compose (G7), `frontend/src/App.jsx` and the `app/routes.jsx` shell (your routes are in `app/routes/admin.jsx`), `components/common/*`, `index.css`.
- **Other groups:** the `Review`/`ReviewReport` models and `apps/animes/services/reviews.py` (G5); `apps/users/services/auth_service.py` (G1, consume only); `Notification` and its hooks (G4); `apps/core/tasks/notifications.py`.

## Cross-group contracts
**Consumes (stable interfaces, no edits):**
- G1:
  - `apps/users/services/auth_service.py::revoke_all_sessions(user)`. Keep the signature.
  - `CustomUser.is_active/is_staff/is_superuser` semantics.
  - `AuthContext` `user.is_staff` and `user.is_superuser`.
  - The admin-settings accessors G1 calls (`is_registration_enabled`, `is_email_verification_required`, `is_username_change_allowed`, `username_length_limits`) keep their names and return types.
- G5:
  - `Review`, `ReviewReport` (`Status`, `Reason`, `resolved_by/at`, `resolution_notes`), `ReviewVote.VoteType`.
  - Deletion goes through `Review.delete()`, so G5's points and signals run.
  - `are_reviews_enabled()` keeps its signature.
- Frozen/core: `apps/core/utils.get_client_ip`; `settings.CELERY_BEAT_SCHEDULE` (read-only); `root.celery.app.conf.task_queues`/`task_routes` (read-only); shared `useFocusTrap`, `PageLoader`, `ErrorState`, `Pagination`, `CustomSelect`.

**Provides:**
- `apps/admin_api/services/audit.py::record_admin_action(...)` for any staff-only mutation in other groups. G5 forum moderation and badge rule changes should call it.
- `AuditLog.ActionType` gains `SUSPEND, RESTORE, RESOLVE, DISMISS, TRIGGER, CONTROL`.
- Maintenance behaviour: staff (session or JWT) bypass it, everyone else gets 503 with `Retry-After: 300`. The exempt list is unchanged.
- `celery_signals.UNTRACKED_TASKS` (import-safe constant). Groups adding high-frequency tasks may ask G6 to list them.
- Moderation page slot: G5 can register forum reports through the interface below.

**Requests:**
- **R1 (integrator, before fan-out):** when merging slim, take SLIM's `frontend/src/pages/admin/AdminImportJobs.jsx`, `components/importJobs/ImportJobDetails.jsx` and `components/importJobs/TriggerImportJobForm.jsx` (the `git diff d961659 17f082a` changes). G6 branches from that merged state.
- **R2 (integrator, `routes.jsx` G6 block):**
  - add `system` → `AdminSystem` and `moderation` → `AdminModeration`;
  - add `review-reports` → `<Navigate to="/admin/moderation" replace/>`;
  - remove the `user-lists` and `favorites` routes and lazy imports.
- **R3 (integrator, `base.py`):** remove `django_celery_beat` from `INSTALLED_APPS`, since beat runs the file scheduler. Its existing tables can stay (no migration needed) or be dropped with `migrate django_celery_beat zero` at deploy. If kept, G6 still removes the Jazzmin references.
- **R4 (integrator, optional, `celery_schedule.py`):** drop `collect-queue-metrics-minute`. The System page reads queue sizes on demand and no Prometheus server is deployed. This changes the beat snapshot, so the integrator decides; P0-5 already makes the entry cheap.
- **R5 (integrator, `Caddyfile.prod`):** optionally gate `/metrics`, `/api/v1/health/ready/` and `/django-admin/*` behind a `remote_ip {$ADMIN_ALLOW_CIDRS:0.0.0.0/0}` matcher. The default stays open, so nothing breaks.
- **R6 (integrator, ownership matrix):**
  - add `apps/core/serializers.py` (Celery-only serializers) to G6;
  - let G6 regenerate the `JAZZMIN_SETTINGS` part of `apps/core/tests/snapshots/beat_schedule_and_jazzmin.json`;
  - the `CELERY_BEAT_SCHEDULE` part stays integrator-only.
- **R7 (slim-down / frozen `apps/animes/services/rate_limiting.py`):** add read-only `AniListRateLimiter.snapshot() -> {"limit", "budget", "used_this_minute", "interactive_used", "paused_until"}` and `CircuitBreaker.state() -> {"state", "failures", "last_failure"}`. No side effects, cache reads only. Note that slim moved past 17f082a ("Give web requests their own AniList counter", 4fa2d14), so the accessor must reflect the per-web counter.
- **R8 (integrator, seams):** split the notification half of `CoreTaskService` out of `apps/core/services/celery_tasks.py` (send_pending_notifications, check_new_episodes, cleanup_old_notifications, `_should_send_*`, `_build_new_episode_email`, ...; `celery_tasks.py:239-535`) into `apps/core/services/notification_tasks_service.py` (G4), keeping a re-export. Today G4 and G6 would both edit this file.
- **G5 (optional):** if forum reports are added, expose `apps/forums/services/moderation.py` with:
  - `list_open_reports(page, reason) -> (rows, count)`, where rows are `{kind:"forum_post", id, snippet, author, target_url, reasons:{...}, first_at, last_at}`;
  - `resolve_reports(target_id, outcome, actor, notes)`, raising `ValueError` on a bad outcome;
  - `open_count()`.

  G6 adds a "Forums" tab when the module exists (`importlib.util.find_spec`). G5 calls `record_admin_action`.
- **G1 (optional):** login with correct credentials on an inactive account returns "This account is suspended." rather than the generic failure. That is G1's decision, because it reveals that the account exists.

**Avoiding collisions:**
- `core` migrations: G4 also adds some; G6 uses its reserved 0012/0013 and re-points `dependencies` to G4's 0011 at rebase (no renaming).
- G6 does not edit `apps/users/serializers/*` or `apps/users/urls.py`. Admin badge routes stay in `apps/admin_api/urls.py`.
- `AdminLayout` stops importing `hooks/useNotifications`.

## Acceptance criteria and test plan
**Behaviour checklist:**
- [ ] Every `/api/v1/admin/` route has an entry in `ADMIN_ACTION_POLICY`. Regular user → 403 or 404. Staff and superuser match the matrix (P0-2). An unlisted action is superuser-only.
- [ ] Every successful mutating admin request made **with a real Bearer token** creates exactly one `AuditLog` row with the right user, real client IP (from `X-Forwarded-For` through `get_client_ip`), entity and action. Failed requests (status ≥ 400) create none.
- [ ] `SystemLog.user_id` is set for JWT requests.
- [ ] With maintenance on: an anonymous `GET /api/v1/genres/` → 503 with `Retry-After`. Staff with a Bearer token → 200. A regular user with Bearer → 503. With maintenance off, no JWT decode happens (asserted with a mock).
- [ ] Staff → 403 on `import-jobs/trigger/` and `cancel/`. A superuser payload containing `source_url`/`source_path` is ignored (the task kwargs don't contain them). `limit=10_000` on trending → 400. A second trigger while PENDING → 409.
- [ ] `celery/tasks/trigger/` ignores `queue`; `worker_control` shutdown no longer exists (404); error responses contain no exception text.
- [ ] Tasks in `UNTRACKED_TASKS` create no `CeleryTaskResult` rows and set the `celery:lastrun:` key.
- [ ] `cleanup_old_task_results` prunes `SystemLog` and `AuditLog` by the retention rules, in batches. The beat snapshot is unchanged.
- [ ] Logging middleware: no rows for `/api/v1/health/`, `/metrics`, `/api/v1/admin/logs/` or admin GETs; rows for 5xx, 403 and admin POSTs; 401 and 404 sampled.
- [ ] Moderation:
  - the queue lists only user-reported reviews by default;
  - each resolve outcome updates its reports, the review and the audit log atomically;
  - staff can resolve;
  - `summary` counts match the queue.
- [ ] Suspend:
  - needs a reason;
  - is idempotent;
  - blacklists the outstanding refresh tokens;
  - staff cannot suspend staff or superusers;
  - history shows in the user detail.
- [ ] System:
  - queues are read from the broker DB;
  - every beat entry is listed with its last run (or "never");
  - `run` refuses unknown entries (404) and runs with the configured kwargs;
  - the AniList section degrades to "unavailable" when the accessor is missing.
- [ ] Bulk: more than 100 ids → 400; non-int ids → 400; `dry_run` deletes nothing; `confirm` mismatch → 400; anime `update_status` → 400.
- [ ] Anime admin counts are correct with 2 favorites × 3 reviews on one anime (asserts 2 and 3).
- [ ] Settings GET/PUT expose only the 7 enforced keys; unknown keys → 400; PUT writes an audit diff.
- [ ] No Jikan, Mongo, Typesense or `themes_status` strings in G6 files (grep check in CI via a test).

**Backend tests (new and updated):**
- `apps/admin_api/tests/`:
  - `test_admin_permission_matrix.py` replaces and extends `test_admin_route_permissions.py`. It walks the resolver as today, then matches each route and method against the policy for anonymous, regular, staff and superuser users.
  - `test_admin_audit.py`: real JWT through `RefreshToken.for_user(u).access_token`, one case per mutating endpoint family, plus the middleware fallback without double-writing.
  - `test_moderation_api.py`, `test_user_suspension.py`, `test_system_api.py` (broker and inspect mocked), `test_bulk_operations.py`.
  - `test_admin_query_budgets.py`, using `django_assert_max_num_queries` with 3 rows, then 15 rows, and the same limit:

    | Endpoint | Max queries |
    |---|---|
    | users list | 4 |
    | anime list | 5 |
    | reviews list | 3 |
    | moderation queue | 4 |
    | logs list | 3 |
    | audit list | 3 |
    | dashboard (cold) | 12 |
    | system (cold, network mocked) | 6 |

  - `test_production_readiness.py`: update the settings and maintenance tests and switch them to Bearer.
- `apps/core/tests/`:
  - `test_site_control_middleware.py`, `test_logging_middleware.py`, `test_log_retention.py`, `test_celery_signals_tracking.py`;
  - `test_admin_import_jobs.py`: staff 403, hardening and 409;
  - `test_celery_admin_validation.py`: queue removed;
  - `test_settings_split.py`: Jazzmin snapshot regenerated (R6).
- Keep green: `apps/animes/tests/test_query_budgets.py`, `test_public_contract.py`, `test_query_sql_snapshot.py` (untouched by G6).

**Frontend vitest (`frontend/src/pages/admin/...`):**
- `components/__tests__/ConfirmDialog.test.jsx`: focus moves in, Escape cancels, typed confirm gates the button, focus returns.
- `components/__tests__/Modal.test.jsx`: `role="dialog"`, labelled, focus trap.
- `components/__tests__/DataTable.test.jsx`: header button toggles `aria-sort` and calls `onSort('-username')`; a `matchMedia` mock below `sm` renders cards; checkbox labels.
- `__tests__/AdminModeration.test.jsx`: list, then resolve (each outcome) fires the right POST and invalidates `adminKeys.resource('moderation')`, then shows a toast.
- `__tests__/AdminSystem.test.jsx`: renders sections, stale beat badge, "Run now" only for superusers, AniList "unavailable" state.
- `__tests__/AdminImportJobs.test.jsx`: the `metadata_enrichment` payload; no crash without `franchises`.
- `__tests__/AdminUsers.test.jsx` (update): staff sees no Delete or Promote buttons; Suspend requires a reason.
- `hooks/__tests__/useDebouncedValue.test.js`.

**Manual QA:**
- **Phone (375×812, touch).** Log in as staff:
  - dashboard cards stack, with 16px gutters;
  - Users shows as cards; search is debounced (watch the network panel);
  - open the user drawer and suspend with a reason, then confirm the user is logged out on another device;
  - Moderation: resolve "mark spoiler" and see the badge count drop;
  - try Catalog imports and see no trigger form for staff;
  - sidebar disclosure works with VoiceOver.
- **Desktop (keyboard only).** Log in as superuser:
  - tab through Users, sort by username, select rows;
  - bulk delete: the dry-run count shows in the dialog, then the typed confirm;
  - Settings: toggle maintenance and confirm;
  - open the public site in another tab as staff and see that it still loads; as anonymous, see the 503 screen;
  - System: queues and workers shown, run a beat entry, see the audit row in Logs → Audit;
  - check no emoji anywhere, focus rings visible, reduced-motion respected.
- **Logs tab.** Leave Logs open in a background tab for 5 minutes; no requests fire.

**Gates:** `ruff check`, `ruff format --check`, `makemigrations --check --dry-run`, `pytest -n auto --cov`, `npm run lint`, `npm run test:run`, `npm run build`.

## Migration plan
App `core` (G6 space). Reserved numbers 0012–0013 (overview section 7): depend on `0009` on your branch and re-point to G4's `0011` at rebase.
1. **`apps/core/migrations/0012_admin_auditlog_actions_entity_index.py`**
   - `AlterField(AuditLog.action)`, choices extended with `SUSPEND, RESTORE, RESOLVE, DISMISS, TRIGGER, CONTROL` (`max_length` 20 is enough). No change to the database.
   - `AddIndex(AuditLog, Index(fields=["entity_type", "entity_id", "-timestamp"], name="core_audit_entity_idx"))`.
   - Reversible; no backfill.
2. **`apps/core/migrations/0013_admin_drop_celerytaskschedule.py`**
   - `DeleteModel("CeleryTaskSchedule")`.
   - Reversible schema-wise (data is not restored). The table is unused by beat, and nothing is deployed yet.
   - Must land in the same commit that removes the serializers, the viewset, the Jazzmin icon and the `CeleryTaskSchedule.clean` validators.

No data migrations. Retention pruning happens at runtime (P0-5) in batches of 5,000 per statement, so the first prune after deploy is safe on a large table. `django_celery_beat` table removal is the integrator's choice (R3).

## Risks and open questions
- **Staff accounts:** Is anyone besides the owner (superuser) going to be staff? If not, the staff tier is mostly theoretical, but the policy still matters for least privilege. The owner should confirm that staff may moderate and suspend non-staff users.
- **JWT decoding in middleware (P0-4)** duplicates what DRF does later. It is limited to maintenance windows and uses the same simplejwt settings. An expired token falls through to 503, which is correct.
- **Session revocation on suspend:** `revoke_all_sessions` blacklists refresh tokens, but an access token can live until it expires (unverified whether simplejwt checks `is_active` on every request; the test should assert a 401 after suspension). Open WebSockets (G4) may stay connected until they reconnect (unverified).
- **Log volume figures** (about 5,760 rows a day per polling tab; about 2,880 result rows a day from minute tasks) are worked out from the code, not measured on production data. After deploy, check `pg_total_relation_size` on the System page.
- **R7 dependency:** the AniList section of the System page depends on a frozen-file accessor. Without it the page ships with "unavailable". G6 must not read limiter cache keys directly.
- **Removing endpoints** (`celery/schedules`, `celery/dashboard`, `celery/workers*`, `user-lists`, favorites list and delete, `reviews/reports*` after one release) is safe for the SPA, which does not use them or is rewritten. Any external script using them breaks; none are known.
- **P2-2** depends on whether AniList sync overwrites manual character and staff edits; check `apps/animes/services/providers/**` before cutting the forms.
- **Ownership:** `apps/core/serializers.py` and the snapshot JSON are not in the matrix (R6). `celery_tasks.py` mixes G4 and G6 code (R8).
- **Moderation scope creep:** forum reports are explicitly G5's. Without R-G5 the queue shows reviews only.
