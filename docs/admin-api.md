# Admin API contract (additions)

Everything lives under `/api/v1/admin/` and is gated by `ADMIN_ACTION_POLICY`
(`apps/admin_api/permissions.py`). **S** = staff (and superusers), **SU** = superuser only.
Lists are DRF-paginated: `{count, next, previous, results}`, `?page=`, `?page_size=` (max per
`StandardPagination`), `?search=`, `?ordering=` (prefix `-` for descending). Errors are
`{"detail": "..."}` (400/403/404/409), or DRF field errors `{"field": ["..."]}` on validation.
Every mutation writes one `AuditLog` row (visible in `audit-logs/`).

## Users — `users/`

| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `users/` | S | filters: `is_staff`, `is_active`, `is_superuser`, `email_verified` (bools `true`/`false`), `joined_after`, `joined_before` (`YYYY-MM-DD`, UTC dates), `joined_since` (ISO 8601 moment with offset, e.g. the admin's local midnight `2026-11-26T00:00:00+05:00`); `search` (username, email); `ordering`: `date_joined`, `username`, `email`, `last_login` |
| GET | `users/{id}/` | S | see below |
| POST | `users/{id}/suspend/` · `restore/` | S | `{"reason": 3-500 chars}` |
| POST | `users/{id}/revoke_sessions/` | S | no body → `{"id", "message"}`. Blacklists refresh tokens and bumps `session_version`, so access tokens already issued are refused at once (see below) |
| POST | `users/{id}/send_password_reset/` | S | no body → `{"id", "message"}` (the email is queued); same target rules as suspend (403 superuser/staff, 400 self); 400 if inactive or no email; 429 within 10 min of the last admin-sent reset to that account; 503 if the queue is down |
| POST | `users/{id}/clear_profile/` | S | `{"fields": ["bio","avatar","banner"] (subset), "reason": 3-500}` → `{"id", "cleared": [...], "message"}` |
| POST | `users/{id}/verify_email/` | SU | → `{"id", "email_verified": true, "changed", "message"}` |
| POST | `users/{id}/toggle_staff/` | SU | `{"is_staff": bool}` |
| DELETE | `users/{id}/` | SU | |
| GET | `users/export/` | SU | same filters/search/ordering as the list; `text/csv` attachment, ≤10,000 rows. Columns: `id,username,email,date_joined,last_login,is_active,is_staff,is_superuser,email_verified,list_entries,reviews,favorites` |

Staff may not act on themselves, superusers, or (unless superuser) other staff for
suspend/restore/revoke_sessions/send_password_reset/clear_profile (400/403 with a `detail`).

**Session revocation.** `CustomUser.session_version` is bumped by `revoke_all_sessions`
(sign out everywhere, suspension, password change). Tokens carry it as the `sv` claim
(tokens from before the claim count as 0); `apps.users.authentication.RevocableJWTAuthentication`
(the DRF default, also used by the maintenance middleware) refuses a token whose `sv` is
older than the user's: 401 `token_revoked`. Durable (no cache) and same-second safe.

`GET users/{id}/` = list row fields (`id, username, email, date_joined, last_login, is_active,
is_staff, is_superuser, email_verified, avatar, banner, bio, is_private, favorites_count,
reviews_count, list_entries_count`) plus:

```json
{
  "moderation_history": [{"id", "action", "entity_type", "timestamp", "actor", "reason", "operation", "changes"}],
  "profile": {"bio", "avatar", "banner", "is_private", "email_verified", "points",
              "last_activity", "preferred_timezone", "pending_email"},
  "stats": {"list_entries", "reviews", "favorites", "followers", "following",
            "forum_threads", "forum_posts", "badges"},
  "list_breakdown": {"Watching": 3, "Completed": 2, "Plan to Watch": 1, "On Hold": 0, "Dropped": 1},
  "recent_reviews": [{"id", "anime": {"id", "title", "slug"}, "rating", "snippet", "has_spoilers", "created_at"}],
  "recent_threads": [{"id", "title", "created_at", "is_removed"}],
  "badges": [{"id", "name", "slug", "color", "icon", "image", "granted_at", "reason"}],
  "auth_providers": ["google"],
  "has_password": true
}
```

(`list_breakdown` only has the statuses the user has.)

## Anime — `anime/`

| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `anime/` | S | filters: `status`, `type` (anime_type), `is_adult`, `season` (`WINTER`…), `season_year`, `anilist_id`, `missing` = `cover`\|`synopsis`\|`anilist_id`\|`studio`; `search` (title, title_jp); `ordering`: `title, created_at, updated_at, rating, release_date, popularity_rank, member_count` |
| GET | `anime/{id}/` | S | detail serializer (below) |
| PATCH | `anime/{id}/` | SU | only `{"meta_description": "..."}` (≤160) is writable; everything else is read-only (AniList sync owns it). Writing it sets `meta_description_locked`, so syncs keep the admin's text; writing an empty string unlocks it and the next sync fills it again. Returns the detail payload |
| POST | `anime/{id}/refresh/` | SU | queues AniList metadata refresh → 202 `{"message", "task_id", "job_id"}`; 400 when no `anilist_id` |
| POST | `anime/{id}/refetch_images/` | SU | re-downloads cover + banner → 202 `{"message", "task_id", "job_id"}`; 400 when no external image URLs |
| DELETE | `anime/{id}/` | SU | |

List row: `id, title, title_jp, slug, synopsis, status, anime_type, rating, episode_count,
duration_minutes, release_date, end_date, poster, cover_image, banner_image, trailer_url,
studio {id,name,...}|null, genres [{id,name,slug,...}], meta_description, favorites_count,
reviews_count, avg_review_rating, created_at, updated_at`. `poster` is the displayable cover
(stored file, else AniList URL) — use it, not `cover_image`.

Detail adds: `anilist_id, mal_id, season, season_year, source_material, is_adult,
popularity_rank, trending_rank, member_count, cover_image_external_url,
banner_image_external_url, banner (displayable), next_airing_episode, next_airing_date,
metadata_checked_at, list_entries_count, synonyms [str], external_links [obj], studios
[{id,name}] (provider order), sync_state {id, metadata_status, franchise_status, quarantined,
quarantine_reason, last_error_code} | null`. `sync_state.id` is the `offline-sync-states/` id.

## Reviews — `reviews/`

| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `reviews/` | S | filters: `has_spoilers`, `rating`, `min_rating`, `max_rating`, `user` (id), `anime` (id); `search` (text, username, anime title); `ordering`: `created_at, rating, report_count` |
| GET | `reviews/{id}/` | S | |
| POST | `reviews/{id}/toggle_spoiler/` | S | flips `has_spoilers`; returns the review |
| DELETE | `reviews/{id}/` | S | body `{"reason": 3-500}` (required, 400 without). The author gets an in-app notice naming the review and the reason; audited with the reason |

Row: `id, user {id, username}, anime {id, title, slug}, rating, text, has_spoilers,
report_count (open reports), created_at, updated_at`.

## Forums

| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `forum-categories/` (+`{id}/`) | S | row `{id, name, slug, description, order, thread_count}`; `search` |
| POST/PUT/PATCH | `forum-categories/` · `{id}/` | SU | `slug` optional (made from name); 400 on a taken slug |
| DELETE | `forum-categories/{id}/` | SU | 409 while the category has threads |
| GET | `forum-tags/` (+`{id}/`) | S | row `{id, name, slug, color, thread_count}` |
| POST/PUT/PATCH/DELETE | `forum-tags/…` | SU | `color` must be `#RRGGBB` |
| GET | `forum-threads/` | S | filters `category` (id), `author` (id), `is_removed`, `is_pinned`, `is_locked`; `search` (title, content, author); `ordering`: `created_at, updated_at, reply_count, view_count` |
| GET | `forum-threads/{id}/` | S | row + `content` |
| POST | `forum-threads/{id}/pin/` | S | `{"is_pinned": bool}` |
| POST | `forum-threads/{id}/lock/` | S | `{"is_locked": bool}` |
| POST | `forum-threads/{id}/remove/` | S | `{"reason": ≤200, optional}` (soft remove) |
| POST | `forum-threads/{id}/restore/` | S | |
| POST | `forum-threads/{id}/move/` | S | `{"category_id": id}` |
| DELETE | `forum-threads/{id}/` | SU | hard delete with all posts → 204 |
| GET | `forum-posts/` | S | filters `thread`, `author`, `is_removed`; `search` (content, author); `ordering`: `created_at, like_count` |
| GET | `forum-posts/{id}/` | S | row + `content` |
| POST | `forum-posts/{id}/remove/` · `restore/` | S | `remove` takes `{"reason"}` |

Thread row: `id, title, category {id, name, slug}, author {id, username}|null, created_at,
updated_at, is_pinned, is_locked, is_removed, removed_at, removal_reason, reply_count,
view_count, like_count, snippet`. All thread/post actions return the updated row (detail
shape) and are idempotent (a repeat changes and audits nothing).

Post row: `id, thread {id, title}, author {id, username}|null, snippet, depth, like_count,
created_at, is_removed, removal_reason, removed_by_author`.

## Announcements — `announcements/`

| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `announcements/` (+`{id}/`) | S | filters `level`, `is_active`, `show_banner`; `search` (title, body); `ordering`: `created_at, starts_at, ends_at` |
| POST/PUT/PATCH/DELETE | `announcements/…` | SU | |
| POST | `announcements/{id}/notify/` | SU | `{"audience": "all"\|"active_30d"\|"staff", "force": bool}` → 202 `{"message", "audience", "estimated_recipients"}`. The send is claimed atomically (`notify_status` → `queued`); 409 "still being sent" while queued (a send queued over 15 min is stuck and `force` may re-claim it); 409 if a finished send exists and not `force` (a `failed` one retries without force); 400 if inactive |

Row: `id, title (≤120), body (≤1000), link_url, link_label (≤40, needs link_url), level
(info|success|warning|critical), is_active, show_banner, starts_at|null, ends_at|null (must be
after starts_at), created_by {id, username}|null, created_at, updated_at, notify_status (""|queued|sent|failed),
notify_queued_at|null, notified_at|null, notified_count`. `link_url` is a site path
(`/schedule`) or an http(s) URL, nothing else; in-app notices carry only site paths. Notify creates in-app SYSTEM notifications only (no push/email); a resend
skips users who already have it. `notified_at`/`notified_count` fill in when the task finishes.

Public (no auth): `GET /api/v1/announcements/active/` → up to 3 `[{id, title, body, link_url,
link_label, level, starts_at, ends_at}]` that are active, `show_banner`, and inside their
window; newest first; cached at most 60 s and never past the next start/end time, and dropped on every admin change. Works during maintenance.

## Member list imports — `user-imports/` (S, read-only)

Filters `status` (pending|processing|completed|failed|cancelled), `source`
(mal_api|mal_xml|anilist), `user` (id); `search` (username); `ordering`: `created_at,
completed_at`. Row: `id, user {id, username}, source, mode, status, total_entries,
processed_entries, imported_entries, skipped_entries, failed_entries, failure_reason,
created_at, started_at, completed_at`. Detail adds `errors` and `unmatched` (first 50 each).

## Global search — `search/?q=` (S)

`q` 2–100 characters (400 otherwise). Digits also match ids exactly (user id; anime id,
anilist_id, mal_id; review id; thread id).

```json
{
  "users":   [{"id", "username", "email", "is_active", "is_staff", "avatar"}],
  "anime":   [{"id", "title", "slug", "poster", "status", "anime_type"}],
  "reviews": [{"id", "snippet", "anime_title", "username"}],
  "threads": [{"id", "title", "category", "author"}]
}
```

At most 5 of each.

## Dashboard — `dashboard/` (S, cached 60 s, `?refresh=1` rebuilds)

Adds to the existing payload:

- `statistics.users.active_7d` — profiles active in the last 7 days.
- `charts.reviews_30d` — `[{date, count}]` like `charts.user_growth`.
- `attention` — `{open_reports, open_reviews, failed_tasks_24h, quarantined_sync,
  failed_user_imports_24h, suspended_users}`.
- `recent_users[].avatar` — local avatar URL or null.

## Existing endpoints the new UI uses (unchanged)

- `moderation/summary/` (S) → `{open_reports, open_reviews, by_reason, forums: null}`.
- `moderation/reviews/` (S) `?status=open|in_review|resolved|dismissed&reason=&signals=1` →
  rows `{review_id, snippet, rating, has_spoilers, created_at, author, anime, report_counts,
  report_total, reporter_count, first_reported_at, last_reported_at, signals}`;
  `POST moderation/reviews/{review_id}/resolve/` `{"outcome": "dismiss"|"remove_review"|"mark_spoiler", "notes"}`.
- `bulk/` (SU) `{operation, entity_type, entity_ids, dry_run, confirm, force, reason}`.
- `offline-sync-states/` (S read; SU `retry`, `mark_skipped {reason}`, `set_ids_and_retry {anilist_id, mal_id}`, `merge_target {target_anime_id}`); `?quarantined=true|false|all&reason=&stage=metadata|franchise&status=`.
- `import-jobs/` (S read; SU `trigger`, `{id}/cancel/`).
- `celery/tasks/results/` (SU): filters `status` (PENDING|STARTED|SUCCESS|FAILURE|RETRY|REVOKED, case-insensitive), `task_name` (contains), `worker`, `queue`, `date_from`, `date_to`; `search`; `ordering`: `date_created, date_started, execution_time, task_name`. Row: `id, task_id, task_name, task_name_short, status, status_display, date_created, date_started, date_completed, execution_time, worker, queue, retries, error_message, triggered_by`. Detail adds `task_module, task_args, task_kwargs, result_data, result_summary, traceback`. `DELETE {id}/`; `POST bulk_delete/ {"ids": [...≤limit]}` or `{"days": N}` (older than N days) → `{message, deleted}`.
- `celery/tasks/trigger/` (SU) `{task, kwargs}`; `celery/tasks/control/` (SU) `{task_id, action: "revoke", terminate}`.
- `system/` (S; `can_run` tells the UI whether to show run buttons); `POST system/beat/{name}/run/` (SU) → 202.
- `logs/`, `logs/stats/` (SU); `audit-logs/` (S) filters `action, entity_type, entity_id, user`; `user_ip` is null unless the caller is a superuser; `GET audit-logs/entity_types/` (S) → `{"entity_types": [...]}` actually recorded (cached 5 min). Support actions record `metadata.operation` (`revoke_sessions`, `send_password_reset`, `clear_profile`).
- `settings/` (S GET, SU PUT), `reports/?type=overview|users|content|engagement&days=7|30|90|365` (S), `stats/export/` (S), `badges/…`, `genres/`, `studios/`, `characters/`, `staff/`, `favorites/stats/`.
