# Admin

The staff admin lives at `/admin` (React, `frontend/src/admin/`) on top of the
`/api/v1/admin/` API (`apps/admin_api/`, contract in [admin-api.md](admin-api.md)).
Django's own admin stays at `/django-admin/` for superusers.

## Roles

| Role | Can |
|---|---|
| Staff | Read everything except request logs, task payloads and IP addresses; moderate reviews and forums; suspend, restore, sign out, reset passwords and clear profile content of members (not other staff). |
| Superuser | Everything: catalog edits and deletes, bulk actions, imports, beat runs, settings, announcements, staff access, account deletion, CSV export. |

The rules live in one place, `apps/admin_api/permissions.py::ADMIN_ACTION_POLICY`.
Anything not listed there is superuser-only. The frontend hides what a role
cannot do; the API refuses it regardless. Every write is recorded in the audit
log (Logs → Audit log).

## Sections

| Section | Path | What it is for |
|---|---|---|
| Dashboard | `/admin` | What needs attention (reports, failed jobs, stuck syncs, failed list imports), key numbers, recent members and reviews. |
| Analytics | `/admin/analytics` | Users, content and engagement reports over 7/30/90/365 days. |
| Moderation | `/admin/moderation` | The review report queue: dismiss, mark as spoiler or remove, with notes. |
| Reviews | `/admin/reviews` | Every review: filter, read, toggle spoilers, delete, bulk actions. |
| Forums | `/admin/forums` | Threads (pin, lock, move, remove, restore), replies, categories and tags. |
| Users | `/admin/users`, `/admin/users/:id` | Find members; the user page has their account, activity, badges, moderation history and every account action. |
| Badges | `/admin/badges` | Create badges, grant and revoke them. |
| Announcements | `/admin/announcements` | Site-wide banners with a schedule, and in-app notices to all, recently active or staff members. |
| Anime | `/admin/anime`, `/admin/anime/:id` | The catalog: refresh one title from AniList, re-download images, edit its SEO description, delete. |
| Genres, Studios, Characters, People | `/admin/genres` … | Catalog records (People are the API's `staff`: voice actors, directors). |
| Catalog sync | `/admin/catalog-sync` | The catalog engine: titles listed and hidden, each season against AniList, every lane's last run (superusers can run one), the full sweep's progress, and the run log. `/admin/imports` and `/admin/sync-health` redirect here. |
| List imports | `/admin/list-imports` | Members' MAL/AniList list imports, for support. |
| System | `/admin/system` | Health, queues, workers, scheduled jobs (run now), AniList budget, database size, recent failures. |
| Task history | `/admin/tasks` | Celery task results (superuser). |
| Logs | `/admin/logs` | Audit log (staff) and request logs (superuser). |
| Settings | `/admin/settings` | Maintenance mode, sign-ups, account rules, reviews on/off. |

Search anything with <kbd>Ctrl</kbd> <kbd>K</kbd> (<kbd>⌘</kbd> <kbd>K</kbd>) or <kbd>/</kbd>.

## Conventions

- **The URL is the state.** Search (`q`), filters, sort (`ordering`) and page live
  in the query string, so a filtered view can be linked and survives a reload.
  `?open=<id>` opens a record's drawer (`/admin/reviews?open=12`,
  `/admin/forums?tab=threads&open=4`).
- **One look.** Pages use only the kit in `frontend/src/admin/ui/`, which wears
  the site's design system: slate panels, one periwinkle accent, soft fills
  instead of lines, sentence case, 44 px targets, tables that become cards on
  phones.
- **Consequential actions confirm.** Suspensions and bulk bans need a reason;
  deletes of accounts or threads need the name typed; bulk deletes show a dry
  run of what would cascade first.
