# Feature revamp 4: Notifications + web-push
> Base: backend fix/anilist-only-and-fixes@17f082a, frontend feat/visual-ux-overhaul@ab5b3c2. Planning only.

Path prefixes: `SLIM:` = backend snapshot, `WT:` = planning worktree (frontend truth). The G4 backend files are byte-identical in both trees (checked with `diff -q`).

## Summary
In-app notifications mostly work: rows, a live WebSocket badge, and an infinite list page. Web push does not work at all. The frontend never registers a service worker and never subscribes, `boot.js` unregisters every service worker on load, and the server never exposes the VAPID public key. Behind that, the backend push code has four bugs that would break it even after wiring: endpoints are truncated to 200 chars, dead subscriptions are never pruned, TTL is 0 so offline devices drop messages, and the VAPID `sub` claim is malformed.

Preferences are four `UserProfile` booleans. They don't cover the forum, like or badge types, and there are no in-app toggles. Email goes to unverified addresses with unescaped HTML and no unsubscribe link.

This group delivers:
1. A frozen producer API, `notify()`, with DB-enforced idempotency (`dedupe_key`) and race-safe aggregation (`group_key`).
2. A compact `core.NotificationPreference` model (category × channel), migrated from the legacy flags.
3. Event-driven push and email delivery, with the existing beat entry kept as a sweeper.
4. Cheaper and more correct new-episode fan-out.
5. One shared resilient socket per tab.
6. An honest preferences matrix, plus a device-level push opt-in that works on Chrome, Firefox, Edge, and iOS when installed as a PWA.

All of this runs on the existing Postgres, Redis, Celery and Channels stack. No new services.

## Current state

### Models (SLIM:apps/core/models.py)
| Model | Fields / notes |
|---|---|
| `Notification` (405-461) | user FK, `notification_type` (9 choices: new_episode, review_reply, review_like, new_follower, forum_reply, forum_mention, forum_like, badge_awarded, system), title, message, `data` JSON, is_read/read_at, `is_email_sent`, `is_push_sent`, priority. Six indexes, including `(is_email_sent, created_at)` and `(is_push_sent, created_at)`. No unique constraints. Model method `mark_as_read` (457) has no caller. |
| `PushSubscription` (464-492) | user FK, `endpoint = URLField()` (default max_length 200; migration 0003:40), p256dh/auth varchar 255, device_type, device_info JSON, is_active, last_used. `Index(endpoint)`, not unique. |
| Legacy prefs `UserProfile` (SLIM:apps/users/models.py:71-74) | `email_new_episodes`, `push_new_episodes`, `push_review_replies`, `push_new_follower`, all default True. `email_verified` is at :56. |

Latest core migration: `0009_notification_review_like_and_index`. Latest users migration: `0037_customuser_email_ci_unique`.

### Endpoints (prefix `/api/v1/`, SLIM:apps/users/urls.py:41,52-69; views in SLIM:apps/users/views/notifications.py)
| Method + path | View | Notes |
|---|---|---|
| GET `notifications/?is_read=&type=&page=&page_size=` | `NotificationViewSet.list` (148-176) | StandardPagination with COUNT. Cover enrichment batch (97-146). `type` takes a single value. |
| GET `notifications/unread_count/` | `.unread_count` (178-182) | Redis-cached counter. |
| PATCH `notifications/{pk}/mark_read/` | `.mark_read` (184-199) | Scoped to the owner, so no IDOR. A non-integer pk raises ValueError and returns 500 (see N16). |
| POST `notifications/mark_all_read/` | `.mark_all_read` (201-205) | |
| DELETE `notifications/{pk}/` | `.destroy` (207-215) | Scoped to the owner. |
| GET/PUT `notifications/preferences/` | `NotificationPreferenceView` (218-243) | Flat four booleans. |
| POST/GET/DELETE `notifications/subscribe/`, DELETE `notifications/unsubscribe/` | `PushSubscriptionViewSet` (246-297) | The serializer accepts a 2048-char endpoint (47) and runs `validate_public_target` against SSRF (57-64). |
| WS `ws/notifications/?ticket=` | `NotificationConsumer` (SLIM:apps/core/consumers.py), routing.py, root/asgi.py | Group `notifications_user_{id}`. Sends `unread_count` on connect. Accepts client `mark_read`, `mark_all_read` and `ping`. Server events: `notification`, `notification_updated`, `notification_deleted`, `unread_count`, `notification_read`. |

### Services
- SLIM:apps/core/services/notification_service.py (761 lines). `create_notification` (131-181) wraps the insert in a savepoint and broadcasts on_commit. The unread counter lives in the cache (271-338). Seven `create_*` producers (411-761). Like aggregation uses `select_for_update` on JSON filters (552-610, 612-676), and there is a retract path (678-744).
- SLIM:apps/core/services/push_service.py. `webpush()` is called with no ttl, timeout, urgency or topic (55-67). 404/410 deactivation sits at 79.
- SLIM:apps/core/services/celery_tasks.py (**G6-owned file**) holds the notification logic at 238-534: `send_pending_notifications`, `check_new_episodes`, the `_should_send_*` helpers, the inline f-string email, and the episode event helpers.

### Celery
SLIM:apps/core/tasks/notifications.py has three tasks behind `cache_lock`. Beat entries in SLIM:root/settings/celery_schedule.py:
| Entry | Task | Schedule |
|---|---|---|
| `check-new-episodes` (141-145) | `check_new_episodes` | every 6 h at minute 0 |
| `send-pending-notifications` (146-150) | `send_pending_notifications` | */10 min |
| `cleanup-old-notifications` (151-156) | `cleanup_old_notifications_task(days=90)` | daily 02:30 |

**Airing inputs.** These are FROZEN slim-down code. `_apply_recent_airing_transition` (SLIM:apps/animes/services/providers/base.py:345-371) copies the old `next_airing_*` into `last_aired_*` when the schedule advances. AniList schedule refresh runs once a day: `sync-airing-schedule-daily` at 01:45 (celery_schedule.py:37-42). `derive-airing-hourly` only re-reads local rows (SLIM:apps/animes/tasks/sync.py:40-45, 56). `check_new_episodes` treats an anime as aired when `last_aired_at` falls in the last 24 h, or when an airing show's `next_airing_date` falls in the last 24 h (celery_tasks.py:486-519).

### Producers outside G4
| Producer | Call site |
|---|---|
| Follow | SLIM:apps/users/signals.py:77-98 (G4 owns the notify call) |
| Review like and unlike | SLIM:apps/animes/services/reviews.py:264-281 (G5) |
| Forum mention, reply, threaded reply, thread like, post like | SLIM:apps/forums/services/interactions.py:51-64, 133-145, 256-276, 365-377 (G5) |
| Badge | SLIM:apps/users/views/admin_badges.py:118-126 (G6) |
| Admin actions | SLIM:apps/core/admin.py:314-329 (G6) |
| `review_reply` | No producer exists. |

### Frontend (WT:frontend/src)
| File | Role |
|---|---|
| `pages/Notifications.jsx` (355) | Infinite feed (`notificationKeys.feed(userId, 30)`, gcTime 0). Client-side filter chips. Per-item image lookups. Its own WS. |
| `components/notifications/{NotificationItem.jsx,notificationDisplay.js}` | Row rendering, actor/entity highlighting. |
| `components/navbar/useNavbarNotifications.js` (51) | Badge count plus its own WS. Zeroes the badge on `/notifications`. |
| `components/settings/{NotificationsTab.jsx,useNotificationPreferences.js}` | Four switches. Optimistic save. Defaults come from G1's `settingsUtils.js:81-86`. |
| `hooks/useNotifications.js` | Shared cache helpers, plus `useUnreadNotificationCount`, `useUnreadNotifications`, `useMarkNotificationRead` and `useMarkAllNotificationsRead`. Also used by G6 `AdminLayout.jsx:11-46`. |
| `hooks/useWebSocket.js` (301) | Ticket per attempt, backoff 1 s→30 s, max 10 retries, 30 s ping. Also used by G5 `useForumWebSocket.js:48`. |
| `api/queries/notifications.js` | Keys: `['notifications', uid, 'unread-count' / 'unread' / 'feed' / 'preferences']`, plus `notificationImageKeys`. |
| `api/modules/user.js:80-91` | `notificationApi` (seams will move it to `api/modules/notifications.js`). |
| `utils/notificationUtils.js` | Text and target helpers. |
| `public/service-worker.js` (79) | Push and click handlers. Never registered. No fetch handler (good). |
| `public/site.webmanifest` | `display: standalone`. `favicon.png` is listed as both 192 and 512, but it is actually 480×480. |
| Dead code | `components/NotificationBell.jsx` (267 lines, no importer). `pages/NotificationPreferences.jsx` (not routed: WT:frontend/src/app/routes.jsx:110 has only `/notifications`). |

### Tests
| File | Tests |
|---|---|
| SLIM:apps/core/tests/test_notification_service.py | 10: cache, aggregation, cover enrichment |
| SLIM:apps/core/tests/test_notification_tasks.py | 8: no resend, crash-retry, lock, episode detect and dedupe |
| SLIM:apps/core/tests/test_push_service.py | 3: SSRF and payload JSON |
| SLIM:apps/core/tests/test_notification_consumer.py | 1 |
| SLIM:apps/animes/tests/test_airing_notification_state.py | 3: the transition only, not the cleanup phase |
| WT frontend | `hooks/__tests__/{useNotifications,useWebSocket}.test.*`, `api/queries/__tests__/adminAndNotificationKeys.test.js`. NotificationsTab is tested inside G1's `components/settings/__tests__/SettingsTabs.test.jsx:4-65`. |
| Gaps | No API tests for the notification endpoints, preferences or subscribe views. No page or service-worker tests. |

## Problems found
| ID | Sev | Area | Problem | Evidence path:line | Fix ref. |
|---|---|---|---|---|---|
| N1 | High | push/FE | Web push is not wired. Nothing calls `serviceWorker.register` or `pushManager.subscribe` (grep: only `api/modules/user.js:88-90` defines the API calls). `boot.js` unregisters every SW unless `<meta pwa-enabled=true>`, and `vite.config.js` defaults that to false. No VAPID public key reaches the client. The push toggles therefore do nothing. TODO claims web push and PWA are done. | WT:frontend/public/boot.js:4-16; WT:frontend/vite.config.js:12,41; SLIM:root/settings/base.py:665-666; WT:frontend/src/components/settings/NotificationsTab.jsx:9-25; WT:TODO:17,23 | P1-1 |
| N2 | High | push/data | `endpoint` is varchar(200) but the serializer allows 2048. Long endpoints (Firefox autopush ones are typically longer than 200 chars, unverified) raise DataError and return 500. | SLIM:apps/core/models.py:470; SLIM:apps/core/migrations/0003_notification_pushsubscription.py:40; SLIM:apps/users/views/notifications.py:47 | P0-1 |
| N3 | High | push | 404/410 pruning never runs. `if e.response and …` is false for 4xx because `requests.Response.__bool__` returns `.ok`. Dead endpoints stay active and get retried every 10 min for 24 h. | SLIM:apps/core/services/push_service.py:79 | P0-1 |
| N4 | High | push | `webpush()` is called without ttl, timeout, urgency or topic. pywebpush 2.3.0 defaults ttl=0 (unverified), so a phone that is offline or dozing loses the message. With no timeout, a stuck push service blocks the worker. | SLIM:apps/core/services/push_service.py:56-67; SLIM:uv.lock:2740-2749 | P0-1 |
| N5 | Med | push | The VAPID claim `sub` is `mailto:AniShows <onboarding@resend.dev>`, which is not a valid mailto. Apple's push service rejects bad `sub` claims (unverified). | SLIM:apps/core/services/push_service.py:20-24; SLIM:root/settings/base.py:502 | P0-1 |
| N6 | High | security | Endpoints are not unique. `update_or_create(user, endpoint)` lets two accounts own the same browser endpoint. Logout never unsubscribes, so on a shared device the device keeps getting the previous account's pushes. Concurrent subscribes create duplicates. | SLIM:apps/core/services/push_service.py:128-138; SLIM:apps/core/models.py:480-485; WT:frontend/src/context/AuthContext.jsx:143-146 | P0-1, C-G1-3 |
| N7 | Med | email | Email goes out without checking `email_verified` or `is_active`. Combined with a default-True flag, anyone who signs up with someone else's address sends that person a mail per episode. | SLIM:apps/core/services/celery_tasks.py:434-453; SLIM:apps/users/models.py:56,71 | P0-3 |
| N8 | Med | email | The HTML is an f-string with unescaped title and message. The colours (#e94560) are off-brand. There is no List-Unsubscribe header or unsubscribe token. The footer links to `/settings/notifications`, which hits NotFound, and the Settings tab is local state, so it cannot be deep-linked. | SLIM:apps/core/services/celery_tasks.py:456-483 (478); WT:frontend/src/app/routes.jsx:110,140; WT:frontend/src/pages/Settings.jsx:19 | P0-3, C-G1-1/2 |
| N9 | Med | badge | Unread counter drift. On a cache miss the code runs `cache.add(key, 0)` then `incr`, so after TTL expiry or eviction the first new notification sets the badge to 1 whatever the real count is. Decrement has the same problem. | SLIM:apps/core/services/notification_service.py:294-322 | P0-2 |
| N10 | Med | prefs | Push is always on for forum reply, mention and like, badge and system, with no toggle. There are no in-app toggles. `_should_notify_user` is dead and costs a profile query per call. `push_review_replies` gates review likes, while `review_reply` has no producer. The UI copy promises "replies to your reviews". | SLIM:apps/core/services/celery_tasks.py:421-431; SLIM:apps/core/services/notification_service.py:184-193,433-451; WT:frontend/src/components/settings/NotificationsTab.jsx:126-135 | P0-4 |
| N11 | Med | perf | Episode dedupe loads every new_episode row from the last 7 days, for all users, and filters in Python. There is no unique constraint. Each recipient costs one INSERT, one cache incr and one group_send, and the list query loads full user and profile rows. | SLIM:apps/core/services/celery_tasks.py:356-364,381-397,522-534 | P1-3 |
| N12 | Med | episodes | Plan-to-watch users get every episode. Users who already watched the episode (`episodes_watched >= n`) still get it. Events are keyed by anime, so one run sees only one episode, and the latest episode (`next_airing_episode-1`) is ignored. The 6-hour cadence means alerts can be up to 6 h late. | SLIM:apps/core/services/celery_tasks.py:359-362,486-519; SLIM:root/settings/celery_schedule.py:141-145 | P1-3, C-INT-4 |
| N13 | Med | episodes (FROZEN) | The airing cleanup phase clears `next_airing_*` without recording `last_aired_*`, in both the RELEASING/FINISHED branches and the batch finished clear. A row the sync phase did not advance (rate-limited or skipped) loses that episode's alert. | SLIM:apps/animes/tasks/airing.py:221-246,255-263 | C-INT-5 |
| N14 | Med | delivery | Push and email go out only through the 10-minute beat scan over 24 h. Replies and follows reach the phone up to 10 minutes late. Each row costs two subscription queries. | SLIM:apps/core/services/celery_tasks.py:238-296; SLIM:root/settings/celery_schedule.py:146-150 | P1-2 |
| N15 | Med | race | When no unread aggregate exists yet, two concurrent likes both insert, giving duplicate "liked your review" rows. `select_for_update` cannot lock a row that does not exist. | SLIM:apps/core/services/notification_service.py:563-610,634-676 | P0-2 |
| N16 | Med | API | A non-integer pk on mark_read or destroy reaches `filter(id=pk)` and raises ValueError, returning 500. The router has no `lookup_value_regex`, and `api_exception_handler` has no ValueError branch (grep). | SLIM:apps/users/views/notifications.py:184-215; SLIM:apps/core/services/notification_service.py:343,377; SLIM:apps/core/api_errors.py:120 | P0-5 |
| N17 | Med | WS/FE | Navbar and the Notifications page each open `/ws/notifications/`, so there are two sockets and two tickets per tab. After 10 failures the hook gives up for good, with no online/visibility resume. The feed does not resync after a reconnect, so events are missed. | WT:frontend/src/components/navbar/useNavbarNotifications.js:44-48; WT:frontend/src/pages/Notifications.jsx:175-179; WT:frontend/src/hooks/useWebSocket.js:21,130-135 | P1-4 |
| N18 | Med | UX honesty | Visiting `/notifications` zeroes the badge locally without telling the server, and the count comes back on reload. | WT:frontend/src/components/navbar/useNavbarNotifications.js:23-28 | P1-4 |
| N19 | Med | UX | Filter chips only filter pages already loaded, so "No notifications for this filter" shows while older matching rows exist. The API `type` accepts one value, and the Forum chip needs three. | WT:frontend/src/pages/Notifications.jsx:26-37,214-219; SLIM:apps/users/views/notifications.py:159-161 | P1-5 |
| N20 | Med | perf/FE | Client-side N+1. The page fetches the full anime detail for each slug and the public profile for each follower, in batches of 12 and 8. Avatars for likers and repliers never appear. | WT:frontend/src/pages/Notifications.jsx:104-136; WT:frontend/src/api/queries/notifications.js:64-84 | P1-5 |
| N21 | Low | a11y | The page has no `<h1>`. Chips have no `aria-pressed`. Raw spinners are used instead of PageLoader or skeletons. NotificationsTab decides success with `.includes('success')`, uses ✓ and ! glyph icons, and has no `role=status`. | WT:frontend/src/pages/Notifications.jsx:249-304; WT:frontend/src/components/settings/NotificationsTab.jsx:71-84 | P1-5, P1-6 |
| N22 | Low | dead code | Dead: `NotificationBell.jsx`, `pages/NotificationPreferences.jsx` (unrouted), the `forum_thread_reply` type, the unused `CACHE_NAME`, the missing icons `/icon-192x192.png` and `/badge-72x72.png`, `Notification.mark_as_read`, `_should_notify_user`, and `create_review_reply_notification`. | WT:frontend/src/components/NotificationBell.jsx; WT:frontend/src/utils/notificationUtils.js:175; WT:frontend/public/service-worker.js:2,34-35; SLIM:apps/core/models.py:457 | P1-8 |
| N23 | Low | SW | The click handler compares `client.url === '/anime/x'`, but client URLs are absolute, so it never matches and always opens a new window. There is no same-origin check on `url`, no mark-read, and no `pushsubscriptionchange`. | WT:frontend/public/service-worker.js:47-72 | P1-1 |
| N24 | Med | security (latent) | With `VITE_ENABLE_PWA=true`, Workbox caches `/api/v1/*` responses for 24 h in CacheStorage. Authenticated payloads survive logout on shared devices. Its `sw.js` would also replace `service-worker.js` at scope `/`. | WT:frontend/vite.config.js:46-81 | C-INT-7 |
| N25 | Low | WS | The consumer closes before `accept`, so the handshake is rejected and the client sees 1006, not 4401. The hook's "stop on 4401" branch never runs (Channels behaviour, unverified). `group_expiry` of 86400 s silently drops sockets alive longer than 24 h from the group. | SLIM:apps/core/consumers.py:35-37; WT:frontend/src/hooks/useWebSocket.js:224; SLIM:root/settings/base.py:620 | P1-4 |
| N26 | Low | retention | Cleanup only deletes read rows older than 90 days, in one unbatched DELETE, so unread rows grow forever. The G6 admin action ignores the selection, deletes every row older than 90 days, and its `update()` bypasses the counter cache. | SLIM:apps/core/services/notification_service.py:400-408; SLIM:apps/core/admin.py:314-329 | P1-7, C-G6-1 |
| N27 | Low | abuse | Mention fan-out is unbounded: one notification per `@name` in a post. | SLIM:apps/forums/services/interactions.py:51-64 | P0-2 (cap), C-G5-2 |
| N28 | Med | tests | None of these are tested: endpoint IDOR, 404s, preferences, subscribe with a long endpoint, 410 pruning, email gating and escaping, the cleanup phase, or the page, tab and SW on the frontend. | see Current state › Tests | AC |
| N29 | Info | Jikan | No Jikan, MAL-via-Jikan, Mongo, Typesense or theme-sync references in any G4 file, in either tree (grep over every file listed in this spec). Outside G4: `anime.anilist_id or anime.mal_id` as a cache key at airing.py:146 (FROZEN, harmless). | — | — |

## Proposed scope

### P0 (bugs, security, data integrity)
**P0-1 Push transport correctness (M).** Files: `apps/core/models.py` (PushSubscription), `apps/core/services/push_service.py`, migration 0010.
- `endpoint`: `URLField(max_length=2048)` with a unique constraint `core_pushsub_endpoint_uniq`, replacing the plain index.
- `subscribe_user` (`update_or_create(endpoint=…, defaults={user, keys, is_active=True, failure_count=0}`) moves an endpoint to whichever account subscribes last.
- Add `failure_count` (PositiveIntegerField).
- On a WebPushException, read `e.response is not None` and the status code:
  - 404/410: deactivate.
  - 400/403/413: log the error and deactivate (bad keys, VAPID mismatch, oversized payload).
  - 429/5xx/timeout: `failure_count += 1`, deactivate after 5 failures, and report as "retry" so the notification stays pending.
- Pass `ttl` (by category, see the contract), `timeout=10`, `headers={"Urgency": …, "Topic": …}` (Topic ≤32 chars, base64url-safe), and one `requests.Session` per batch through `requests_session=` (parameter name to verify against pywebpush 2.3.0).
- Payload is the frozen v1 JSON (below). Body is truncated to 180 chars and the whole payload is asserted ≤ 1 KB.
- VAPID subject: `settings.VAPID_SUBJECT` if present (via `getattr`, so no settings change is required), else `mailto:` + `parseaddr(DEFAULT_FROM_EMAIL)[1]`.
- `PushService.is_configured()` returns True only when both keys are set. When it is False, sends are skipped and rows are marked `is_push_sent=True`, so nothing is retried.
- New management command `apps/core/management/commands/generate_vapid_keys.py` prints `VAPID_PUBLIC_KEY` (base64url uncompressed point, for `applicationServerKey`) and `VAPID_PRIVATE_KEY` (base64url raw, py_vapid format).

**P0-2 Producer API + model integrity (M).** Files: `notification_service.py`, new `apps/core/services/notification_types.py`, `apps/core/models.py` (Notification), migration 0010.
- Add `dedupe_key`, `group_key` and `actor`. Constraints:
  - `UniqueConstraint(user, dedupe_key, condition=dedupe_key IS NOT NULL)`
  - `UniqueConstraint(user, group_key, condition=group_key IS NOT NULL AND is_read=false)`
- Implement `notify()`, `notify_many()` and `retract()` (contract below).
- Aggregation: look up by `group_key` with `select_for_update`. If no row exists, insert. On IntegrityError, retry once as a merge. All of this runs inside an inner savepoint, so a caller's outer transaction is never poisoned.
- Unread counter: on a miss, recompute from the DB instead of `add(0)` + `incr`. Bulk paths call `invalidate_unread_counts(user_ids)` (`cache.delete_many`).
- `notify_many` caps recipients at 50 for every type except `new_episode`. This caps mention fan-out (N27).
- Keep the seven `NotificationService.create_*` methods and `remove_review_like_from_notification` as thin shims over `notify` and `retract`, so G5 and G6 call sites keep working unchanged.
- Delete `_should_notify_user`.

**P0-3 Email safety (M).** Files: new `apps/core/services/notification_email.py`.
- Send only if `user.is_active and profile.email_verified and prefs.episodes.email`.
- Build HTML with `format_html` or `escape`, in brand colours (#8b5cf6 link, #7c3aed button, near-black header), plus a plain-text alternative.
- Footer: "Manage notifications" → `{FRONTEND_URL}/settings?tab=notifications`, and "Unsubscribe from episode emails" → `{FRONTEND_URL}/notifications/unsubscribe?token=…`.
- Token: `signing.dumps({"u": id, "c": "episodes"}, salt="core.notifications.email-unsubscribe")`, with no expiry.
- Headers: `List-Unsubscribe: <{API}/api/v1/notifications/email-unsubscribe/?token=…>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. These need C-G1-1. Until it lands, send without headers but keep the footer link.
- New view `EmailUnsubscribeView`: AllowAny, POST only, throttled (`AnonRateThrottle`). It accepts the token from the query or body, sets `episodes.email=false` and returns 200. Never mutate on GET, because link scanners prefetch.

**P0-4 Preference model + enforcement (M).** Files: `apps/core/models.py` (new `NotificationPreference`), new `apps/core/services/notification_preferences.py`, `apps/users/views/notifications.py`, migration 0011. The schema is in the contracts section.
- In-app off means no row is written (except `account`, which is locked on).
- Push and email are decided at notify time and stored as `is_push_sent=not wants_push` and `is_email_sent=not wants_email`, so the sweeper index only sees real work.
- `GET` returns `{preferences, schema}`. `PATCH` takes a partial nested object. `PUT` is kept as a full-replace alias.
- 400 on an unknown category or channel, or on a locked toggle.
- Bulk read for fan-out: `preferences_for(user_ids) -> dict` in one query. A missing row means defaults.

**P0-5 API hardening (S).** `NotificationViewSet.lookup_value_regex = r"\d+"`, so non-integer ids return 404 from the router. Validate `is_read` as true/false (400 otherwise). Add the `category=` filter, with `type=` still accepted and allowed to be comma-separated against the known types. Keep throttling at the defaults.

### P1 (daily-use UX and missing tests)

**P1-1 Web push end to end (L).** FE: new `components/notifications/{pushClient.js,useWebPush.js,PushDeviceCard.jsx}`, plus `public/service-worker.js` and `public/site.webmanifest`. BE: `GET notifications/push/config/` → `{enabled, public_key}`, and `DELETE notifications/subscriptions/{id}/`.
- **pushClient.js**
  - `support()` returns one of `unsupported`, `ios-needs-install`, `denied`, `default` or `granted`. iOS is detected via `navigator.standalone === false` and the absence of `PushManager` in a browser tab.
  - `enable()`, called from a click only:
    1. Register `/service-worker.js` with scope `/` and `updateViaCache: 'none'`.
    2. `Notification.requestPermission()`.
    3. `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`.
    4. POST the subscription JSON plus `device_info` `{label}`. The label is derived from the UA, for example "Chrome on Android".
    5. Remember the endpoint in localStorage (wrapped in try/catch).
  - `disable()`: unsubscribe and DELETE the server row.
  - `syncOnLoad()`: when permission is granted, compare `getSubscription()` with the stored endpoint and re-POST if it changed (handles `pushsubscriptionchange` without auth inside the SW).
  - `detachOnLogout()`: best effort, 1.5 s timeout.
- **service-worker.js** (no fetch handler; a comment says caching is intentionally absent)
  - `push` parses the v1 payload and calls `showNotification(title, {body, tag, renotify: !!tag, icon: '/favicon.png', data: {url, id}})`. It calls `navigator.setAppBadge?.(unread_count)`.
  - `notificationclick` validates `new URL(url, origin).origin === self.location.origin`. It appends `?notification=<id>`, then `matchAll({type: 'window', includeUncontrolled: true})`. If a same-origin client exists it calls `focus()` and then `navigate(url)` (falling back to `postMessage({type: 'navigate', url})`); otherwise `openWindow(url)`.
  - `pushsubscriptionchange` calls `postMessage` to clients so they run `syncOnLoad`.
- **App side.** `useNavbarNotifications` (mounted on every page) calls `syncOnLoad()` once. On a `?notification=<id>` param it marks that notification read and strips the param with `navigate(replace)`.
- **Manifest.** Add `id: "/"`, `start_url: "/"`, `scope: "/"`, and icons with true sizes (`favicon.png` is 480×480: declare it as 480x480, purpose any).

**P1-2 Event-driven delivery (M).** Files: new `apps/core/services/notification_delivery.py`, `apps/core/tasks/notifications.py`.
- `notify` enqueues `deliver_notifications.delay([ids])` on_commit, but only when `wants_push and has_active_subscription` or when `wants_email`.
- Claim each channel with a conditional update: `filter(pk=…, is_push_sent=False).update(is_push_sent=True) == 1`. On a transient failure, reset the flag to False. This gives at-most-once delivery even when the task and the sweeper race.
- `send_pending_notifications` keeps its name and beat entry (snapshot unchanged) and becomes a sweeper for rows aged between 2 min and 24 h. It selects ids only, in chunks of 200.
- Replace the two boolean indexes with a single partial index `core_notif_pending_idx` (on `created_at`, where push or email is still pending).

**P1-3 New-episode detection (M).** Files: new `apps/core/services/episode_notifications.py`.
- Episode number = max(event episode, `next_airing_episode - 1` when `next_airing_date > now`).
- Candidates: list entries where status=Watching, or status=Plan to Watch and the episode is 1 ("premiere"), and `episodes_watched < episode`. Read them with `values_list(user_id, anime_id, status, episodes_watched)`.
- Preferences in one query.
- Each recipient keeps at most one unread episode row per anime (`group_key="new_episode:{anime_id}"`):
  1. One UPDATE per anime rolls existing unread rows forward. It is `filter(group_key=…, is_read=False, user_id__in=recipients, data__episode_number__lt=ep)`, and it sets `dedupe_key="new_episode:{anime_id}:{ep}"`, `data` (the same dict for every recipient, with `grouped: true`), the message "New episodes of X are out, latest is Episode 7" and `created_at=now`.
  2. Then `bulk_create(…, ignore_conflicts=True, batch_size=500)` with the same keys. A conflict on either partial unique index is a no-op, so reruns are idempotent.
- Then re-select the affected ids by `dedupe_key`, run `invalidate_unread_counts`, send one `group_send` per recipient (chunked), and enqueue delivery in chunks of 200.
- Query count is constant in the number of recipients (asserted).
- Cadence change to hourly is a request (C-INT-4). The 24 h window stays as catch-up, and idempotency comes from the constraint.

**P1-4 One socket, honest badge (M).** Files: new `components/notifications/notificationSocket.js` (a module-level, ref-counted singleton built on the same ticket flow), `useNavbarNotifications.js`, `pages/Notifications.jsx`, `hooks/useWebSocket.js`.
- `useWebSocket`: additive `resumeOnFocus` (default true). It resets retries and reconnects on `online` and on `visibilitychange→visible` after giving up. The signature and return shape stay unchanged for G5.
- On a reopen after a drop, call `invalidateQueries(['notifications', uid])`.
- Remove the local badge zeroing. The badge always reflects the server's unread count.
- `consumers.py`: `accept()` then `close(4401)` for anonymous users. Re-run `group_add` on a `ping` when more than 1 h has passed since the last add, to counter `group_expiry`.

**P1-5 Notifications page (M).** Files: `pages/Notifications.jsx`, `components/notifications/*`, `api/queries/notifications.js`, `apps/users/views/notifications.py`.
- Server-side category filter. The key becomes `feed(uid, 30, category)`.
- The serializer adds `category`, `url` (server-built target, shared with the SW), and `actor: {username, avatar}` via `select_related("actor", "actor__userprofile")`. Delete `notificationImageQueries` and the client lookups.
- Add an `<h1>Notifications</h1>` using `SectionHeader`. Chips get `aria-pressed`. Use PageLoader or skeletons and ErrorState for errors. Add a per-row Delete button (aria-label) using the existing DELETE.
- Grouped episode rows (`data.grouped`) render "New episodes of X, latest is Episode 7".
- Empty state per category: "No episode alerts yet. Add airing shows to Watching to get them."

**P1-6 Preferences UI (M).** Files: `components/settings/{NotificationsTab.jsx,useNotificationPreferences.js}`, new `components/notifications/NotificationPreferenceMatrix.jsx`.
- One card with rows = 5 categories and columns = In-app, Push, Email, driven by `schema` (the Email column exists only for Episodes). On phones each row stacks its switches with labels.
- The Push column is disabled with the hint "Enable push on this device first" until `useWebPush` reports a subscription.
- `PushDeviceCard` shows this device's state with an Enable/Disable button, honest copy for unsupported, denied and iOS-not-installed, and a list of other devices with Remove.
- Status goes to a `role="status"` live region. Optimistic toggle per key with rollback. Use existing switch styles and no new tokens.
- Keep the hook signature `useNotificationPreferences({user, queryClient})` and the `notifications` prop name, so G1's `Settings.jsx` is untouched. Stop importing G1's `DEFAULT_NOTIFICATION_PREFERENCES`.

**P1-7 Retention (S).** `cleanup_old_notifications(days=90, unread_days=180, batch_size=5000)` deletes by id batches, then invalidates the counters of affected users. Beat kwargs stay unchanged.

**P1-8 Dead code (S).** Delete `components/NotificationBell.jsx`, the `forum_thread_reply` branch and `Notification.mark_as_read`. Repurpose `pages/NotificationPreferences.jsx` as the email-unsubscribe landing page: route `/notifications/unsubscribe` (C-INT-6), a one-button POST, then a link to settings.

**P1-9 Tests.** See Acceptance criteria.

### P2
- A "seen" marker (badge = unseen, list = unread), stored as `NotificationPreference.last_seen_at`.
- A daily email digest instead of one mail per episode.
- Quiet hours using `preferred_timezone`.
- A monochrome 96 px `notification-badge.png` (C-INT-8).
- Marking a new_episode notification read when G3 records that episode as watched (needs a G3 hook).

### Out of scope
- A desktop bell dropdown (Navbar.jsx is FROZEN).
- SMS or native apps.
- Review comments (G5 owns that feature; `review_reply` stays reserved).
- Admin broadcast UI (G6).
- Changing ws-ticket auth (G1).

## File ownership
Paths are post-seams. G4 may change:

**Prep commit (`revamp/base`), see overview section 4a.** These requests are done, and the files now exist and are G4's:
- C-INT-1: `apps/core/services/notification_tasks_service.py` holds `NotificationTaskService.{send_pending_notifications,
  check_new_episodes, cleanup_old_notifications}` and their helpers. `CoreTaskService` keeps delegating methods,
  `tasks/notifications.py` calls the new class, and the `test_notification_tasks.py` patch paths moved.
- C-INT-2: superseded. `apps/core/models/notifications.py` is G4's whole module, header included.
- `apps/users/serializers/notifications.py`, moved out of the view module.
- `apps/users/urlconf/notifications.py` (router route + the three pre-router paths).
- C-INT-3, settings half: `VAPID_SUBJECT` goes in `root/settings/features/notifications.py` (G4). The env half
  (`.env.production.example`, prod compose) is G7's.
- `_notification_entries()` in `celery_schedule.py`: C-INT-4 (hourly at :50) is G4's own edit, plus those snapshot keys.
- C-INT-6: `frontend/src/app/routes/notifications.jsx` is G4's own file.
- C-INT-7: `public/boot.js` and `frontend/src/pwa/serviceWorker.js` (`clearAppRuntimeCaches`, moved from `main.jsx`)
  are G4's, so change the unregister filter there. The `vite.config.js` part (drop the `/api/v1` runtime cache) is
  applied by the integrator at G4's merge; it was kept out of the behaviour-neutral prep commit.
- `frontend/src/api/modules/notifications.js`.
- Contract stub (keep the signatures): module-level `notify`, `notify_many`, `retract`, `invalidate_unread_counts` at the
  end of `notification_service.py` (+ `apps/core/tests/test_notify_contract.py`). Today `notify` loads the objects named in
  `data` and calls the matching `create_*`, so it writes the same row. It ignores `dedupe_key`/`group_key` and
  suppresses only self-notifications. P0-2 replaces the internals.
- Migration space: `core` `0010`–`0011`.

- **Backend:**
  - `apps/core/models/notifications.py`: the whole module (header included): `Notification`, `PushSubscription` and the new `NotificationPreference` (add it to the module's `__all__`).
  - `apps/core/services/{notification_service,push_service}.py`
  - New `apps/core/services/{notification_types,notification_preferences,notification_delivery,notification_email,episode_notifications}.py`
  - `apps/core/tasks/notifications.py`, `apps/core/{consumers,routing}.py`, `root/asgi.py`
  - `apps/users/views/notifications.py`, new `apps/users/serializers/notifications.py`, `apps/users/urlconf/notifications.py`
  - `apps/users/signals.py::handle_new_follower`: the notify call only
  - New `apps/core/management/commands/generate_vapid_keys.py`
  - `apps/core/migrations/0010_notifications_dedupe_actor_push.py`, `0011_notifications_preferences.py`
  - Tests `apps/core/tests/test_notification_*.py`, `test_push_*.py`, `test_episode_notifications.py`, `test_notification_api.py`
- **Frontend:**
  - `pages/{Notifications,NotificationPreferences}.jsx`
  - `components/notifications/**` (including new files and `__tests__`)
  - `components/navbar/useNavbarNotifications.js`
  - `components/settings/{NotificationsTab.jsx,useNotificationPreferences.js}`
  - `hooks/{useNotifications,useWebSocket}.js` and their existing `hooks/__tests__/` files
  - `utils/notificationUtils.js`, `api/queries/notifications.js` (+ its test), `api/modules/notifications.js`
  - Deletion of `components/NotificationBell.jsx`
  - `public/service-worker.js`, `public/site.webmanifest`

**Precedence (prep commit):** where this list names a file or directory that the *Prep commit* block above grants (a `root/settings/features/` module, a `celery_schedule.py` function, an `app/routes/` file, `boot.js`, a split module), the grant wins; everything else in this list stays forbidden. The frozen shells and shims (overview section 4) stay forbidden.

**Must not touch:**
- `apps/core/services/celery_tasks.py` (G6). Its notification code is moved by the integrator (C-INT-1).
- `apps/core/admin.py`, `apps/users/views/admin_badges.py` (G6).
- `apps/forums/**` and `apps/animes/services/reviews.py` (G5).
- `apps/users/models.py` and any users migration (legacy flags stay).
- `apps/users/services/email_service.py`, `root/ws_auth.py`, `context/AuthContext.jsx`, `pages/Settings.jsx`, `components/settings/{settingsUtils.js,__tests__/SettingsTabs.test.jsx}`, `components/navbar/UserMenu.jsx` (G1).
- `AdminLayout.jsx` (G6), `useForumWebSocket.js` (G5).
- All FROZEN files, including `root/settings/*`, `celery_schedule.py` + snapshot, `boot.js`, `main.jsx`, `vite.config.js`, `routes.jsx`, `airing.py`, and `base.py` providers.

## Cross-group contracts

### Frozen: producer API (`apps/core/services/notification_service.py`)
```python
def notify(recipient, type: str, *, actor=None, data: dict | None = None,
           dedupe_key: str | None = None, group_key: str | None = None) -> Notification | None
def notify_many(recipient_ids: Iterable[int], type: str, *, actor=None, data=None,
                dedupe_key: str | None = None, group_key: str | None = None) -> int   # rows created
def retract(recipient, type: str, *, actor, group_key: str) -> None   # remove actor from unread aggregate
def invalidate_unread_counts(user_ids: Iterable[int]) -> None
```
- `recipient`: a user or a user id. `type` is a `Notification.NotificationType` value. Title, message, category, URL, push TTL and urgency come from `notification_types.TYPES[type]`, so producers never write copy.
- Returns None, and never raises, when:
  - the recipient is the actor;
  - the recipient is inactive;
  - in-app is off for the category;
  - the `dedupe_key` already exists;
  - the write fails (logged).
- Safe inside a caller's `transaction.atomic()`: it runs in its own savepoint, and broadcasts and delivery run on_commit.

Required `data` keys and keys per type:

| Type | data | Keys |
|---|---|---|
| new_follower | `{}` (actor=follower) | `dedupe_key=f"follow:{follower_id}"`, so a refollow never renotifies |
| review_like | `{review_id, anime_id}` | `group_key=f"review_like:{review_id}"` (plus `retract`) |
| forum_reply | `{thread_id, post_id, parent_post_id?}` | `dedupe_key=f"forum_reply:{post_id}"` |
| forum_mention | `{thread_id, post_id?}` | `dedupe_key=f"forum_mention:{'t' or 'p'}:{id}"`, so edits never renotify |
| forum_like | `{thread_id, post_id?}` | `group_key=f"forum_like:{'t' or 'p'}:{id}"` |
| badge_awarded | `{badge_id}` | `dedupe_key=f"badge:{badge_id}"` |
| new_episode | internal to G4 | — |

The existing `create_*` shims stay until post-integration cleanup.

### Frozen: preference schema (`core.NotificationPreference`)
Fields: `user` (OneToOne PK), `preferences` (JSON), `updated_at`. Stored and returned shape: `{category: {channel: bool}}`. Unknown keys are dropped on read, and defaults are merged on read.

| Category | Types | Defaults (new users) | Locked |
|---|---|---|---|
| `episodes` | new_episode | in_app ✓, push ✓, email ✗ (see Q1) | — |
| `replies` | forum_reply, forum_mention, review_reply | in_app ✓, push ✓ | — |
| `likes` | review_like, forum_like | in_app ✓, push ✗ | — |
| `follows` | new_follower | in_app ✓, push ✓ | — |
| `account` | badge_awarded, system | in_app ✓, push ✓ | in_app |

Legacy mapping, used by migration 0011:
- `episodes.push = push_new_episodes`
- `episodes.email = email_new_episodes`
- `replies.push = likes.push = push_review_replies`
- `follows.push = push_new_follower`
- every other key takes its default.

### Frozen: push payload v1 (backend → service worker)
`{"v": 1, "title", "body", "url", "tag", "notification_id", "unread_count"}`. The whole payload is ≤ 1 KB, and `url` is a same-origin path.

Policy per category:

| Category | TTL | Urgency | Topic |
|---|---|---|---|
| episodes | 86400 | normal | `ep{anime_id}` |
| replies | 86400 | normal | — |
| follows | 86400 | low | — |
| likes | 21600 | low | hash of `group_key` |
| account | 604800 | normal | — |

### REST and WS (stable for G6 `AdminLayout` and G5 `useForumWebSocket`)
- Existing paths and response shapes stay. New fields are additive only: `category`, `url`, `actor`.
- WS event names stay unchanged.
- The exports of `hooks/useNotifications.js` and `notificationKeys` stay. `feed` gains an optional third argument.
- `useWebSocket(path, handlers, options)` keeps its signature and return value.
- New endpoints: `GET notifications/push/config/`, `PATCH notifications/preferences/`, `DELETE notifications/subscriptions/{id}/`, `POST notifications/email-unsubscribe/`.

### Requests
- **C-INT-1 (seams).** Move `CoreTaskService.{send_pending_notifications, check_new_episodes, cleanup_old_notifications}` and their module helpers (SLIM:apps/core/services/celery_tasks.py:238-534) into a new G4 file `apps/core/services/notification_tasks_service.py`. `CoreTaskService` keeps one-line delegating staticmethods. The test patch paths in `test_notification_tasks.py` move with them.
- **C-INT-2 (seams). Superseded** by the models package: G4 owns the header of `apps/core/models/notifications.py`.
- **C-INT-3.** Add `VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "")` to `root/settings/base.py`, and the `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` lines to `.env.example` and the prod compose env.
- **C-INT-4.** Change `check-new-episodes` to `crontab(minute=50)` (hourly) and regenerate the beat snapshot. Leave the other two entries alone.
- **C-INT-5 (slim-down owner).** In `airing.py::_cleanup_finished`, apply `_apply_recent_airing_transition` (or set `last_aired_*` from the old `next_airing_*` when `next_airing_date <= now`) before clearing, in both branches and in the batch clear. Add a test in `test_airing_notification_state.py`.
- **C-INT-6.** Append a route block to `routes.jsx`: `notifications/unsubscribe` → lazy `pages/NotificationPreferences.jsx`.
- **C-INT-7.** In `boot.js` and `main.jsx::clearAppRuntimeCaches`, unregister only registrations whose `active?.scriptURL` does not end with `/service-worker.js`. In `vite.config.js`, delete the `api-cache` runtime rule, or drop VitePWA outright, because it would replace the push SW.
- **C-INT-8 (P2).** Add `public/notification-badge.png` (96×96, monochrome).
- **C-G1-1.** `send_email_task(…, headers: dict | None = None)` passes `headers` to the Resend payload and to `EmailMessage(headers=)` for local backends (SLIM:apps/users/services/email_service.py:81).
- **C-G1-2.** `Settings.jsx` takes its initial tab from `?tab=` (`profile`, `account`, `notifications`, `badges`) and keeps it in the URL on switch.
- **C-G1-3.** In `AuthContext.logout`, `await detachOnLogout()` from `components/notifications/pushClient.js` before clearing the session (best effort; it never blocks logout for more than 1.5 s).
- **C-G1-4.** After G4 merges, delete the NotificationsTab block from `SettingsTabs.test.jsx` (G4 adds `components/notifications/__tests__/NotificationsTab.test.jsx`) and `DEFAULT_NOTIFICATION_PREFERENCES` from `settingsUtils.js`.
- **C-G5-1.** Optionally migrate the forum and review call sites to `notify`/`retract` with the keys above. The shims keep the old calls working.
- **C-G5-2.** Cap mentions at 10 distinct users per post (`notify_many` hard-caps at 50 anyway). Confirm the post anchor id (`#post-{id}`) so `url` can deep-link.
- **C-G6-1.** `core/admin.py` "mark read" action calls `invalidate_unread_counts`. The "delete >90d" action uses the selected queryset. Badge award keeps calling the shim.
- **C-G3 (consume only).** G4 reads `UserAnimeList.status`, `episodes_watched` and `anime_id`, and relies on the `(anime, status)` index. Please don't rename these fields.

**Collision avoidance.** G6 also writes `core` migrations: G4 has the reserved 0010/0011, G6 0012/0013 (overview section 7), so no renaming. G4 never edits `celery_tasks.py`; its own new file takes over after C-INT-1.

## Acceptance criteria and test plan

### Criteria
- [ ] Chrome (Android and desktop), Firefox and Edge: Enable on this device → the permission prompt only after a click → a row is created. A follow sent while the tab is closed arrives within 30 s. Tapping it focuses an existing tab, or opens one, at `/u/<name>` and marks it read.
- [ ] iPhone Safari tab: honest "Add aniShows to your Home Screen to get push" copy. Installed PWA: the full flow works.
- [ ] A 300-char endpoint subscribes (201). The same endpoint subscribed by user B moves to B. Logging out removes the device row.
- [ ] 410 and 404 deactivate. 429 and 5xx leave the notification pending and increment `failure_count`.
- [ ] When VAPID keys are missing: `push/config` returns `enabled:false`, the UI hides the Push column with an explanation, and nothing is retried.
- [ ] Episode emails reach only verified, active users. The title is HTML-escaped. One-click unsubscribe (POST) turns `episodes.email` off. A GET has no effect.
- [ ] Two `check_new_episodes` runs create 0 duplicates. A user who already watched episode n gets nothing. A plan-to-watch user is notified only for episode 1. The query count is identical for 1 and 50 recipients.
- [ ] The badge equals the DB unread count after cache eviction (`cache.clear()`, then a new notification).
- [ ] One `/ws/notifications/` socket per tab on every page. After an `online` event it reconnects, even after giving up.
- [ ] Category filters return server-side results, including older pages. The list page makes ≤ 5 queries for 30 items. No anime or profile lookup requests are made from the page.
- [ ] The preferences matrix is keyboard operable, each switch has an accessible name ("Push for Replies"), there is a `role=status` live region, it fits at 360 px with no horizontal scroll, and it has AA contrast.

### Backend tests (pytest)
- **`apps/core/tests/test_notify_api.py`**
  - self and inactive recipients are suppressed;
  - in-app off writes no row, except `account`, which is locked;
  - dedupe returns None and leaves 1 row;
  - group merge updates the message and count;
  - when the unread aggregate is missing, an IntegrityError in the race path becomes a merge;
  - a dedupe conflict inside an outer `atomic()` leaves the outer transaction usable;
  - broadcasts fire once on commit;
  - the shims delegate;
  - `notify_many` caps at 50.
- **`test_notification_preferences.py`**
  - defaults and deep merge;
  - PATCH partial updates;
  - 400 on an unknown key or a locked toggle;
  - migration mapping via `importlib.import_module("apps.core.migrations.0011_notifications_preferences")`;
  - `preferences_for` runs 1 query.
- **`test_notification_api.py`**
  - owner scoping, and another user's id returns 404 on mark_read and delete (IDOR);
  - `/notifications/abc/mark_read/` returns 404;
  - `is_read=maybe` returns 400;
  - category and comma-separated type filters;
  - `CaptureQueriesContext` ≤ 5 for a 30-item page with actors;
  - push config;
  - subscribe with a long endpoint, reassignment, and device delete;
  - email-unsubscribe with a valid, tampered or missing token, and a throttle check.
- **`test_push_service.py`** (extend)
  - 410, 404 and 403 deactivate;
  - 429 increments `failure_count` and reports retry;
  - ttl, timeout, Urgency and Topic are passed to the mocked `webpush`;
  - the payload is ≤ 1 KB with a long body;
  - the VAPID sub is parsed from a display-name address;
  - nothing is sent when keys are missing.
- **`test_notification_delivery.py`**
  - task and sweeper racing produce one send (claim update);
  - the sweeper skips rows younger than 2 min;
  - email gating on verified and active users;
  - escaping of `<script>`;
  - `headers` reach `send_email_task` (mocked).
- **`test_episode_notifications.py`**
  - Watching vs Plan to Watch (episode 1 only), with Completed and Dropped excluded;
  - `episodes_watched` skip;
  - idempotent across runs;
  - `next_airing_episode - 1` derivation;
  - an unread episode-6 row is rolled forward to episode 7 (no second unread row), and a read episode-6 row gets a new episode-7 row;
  - query-count equality for 1 vs 50 users;
  - counters invalidated;
  - preferences off writes no row.
- **`test_notification_cleanup.py`**: read older than 90 days and unread older than 180 days are deleted, in batches, and counters are invalidated.
- **`test_notification_consumer.py`** (extend): anonymous connections get close code 4401 after accept, `ping` gets `pong`, and the count is sent on connect.
- **`test_notification_service.py`** (extend): a cache miss followed by an increment returns the DB count.

### Frontend tests (vitest)
| File | Covers |
|---|---|
| `components/notifications/__tests__/pushClient.test.js` | support states (unsupported, ios-needs-install, denied), enable posting the subscription, `syncOnLoad` re-posting on endpoint change, `detachOnLogout` timeout |
| `__tests__/serviceWorker.test.js` | Evaluates `public/service-worker.js` against a mocked `self`: push parse, cross-origin URL rejected, focus+navigate vs openWindow |
| `__tests__/notificationSocket.test.js` | Three subscribers share one socket, ref-counted close, invalidation on reconnect |
| `__tests__/NotificationsTab.test.jsx` | Matrix rendering from the schema, locked switch disabled, Push column disabled without a device, optimistic rollback, live region |
| `__tests__/NotificationsPage.test.jsx` | h1, `aria-pressed`, category in the query key, no image-lookup calls, delete row, grouped episode label |
| `hooks/__tests__/useWebSocket.test.js` (extend) | Resume on `online` after max retries, stop on 4401 |

### Manual QA (phone at 360 px and desktop)
1. Settings → Notifications: tab through every switch, toggle with Space, check reduced-motion.
2. Enable push on this device, then close the tab. From a second account, follow, reply and like.
   - Expect the follow and reply pushes. The like is off by default, so no push.
   - Tap the follow push: lands on the profile, and the badge drops.
3. Firefox desktop: same flow. This exercises the long endpoint.
4. iPhone: tab copy, then Add to Home Screen, then the flow.
5. Log out, then send an event: no push arrives.
6. Admin: run `check_new_episodes` against seeded airing data. One email arrives (verified account only). Use Gmail's one-click unsubscribe.
7. `/notifications`: chips filter server-side, Load more works, the empty state is honest, and DevTools shows one socket.

### Gates
`ruff check`, `ruff format --check`, `makemigrations --check --dry-run`, `pytest -n auto --cov`, `npm run lint`, `npm run test:run`, `npm run build`. The beat snapshot changes only through C-INT-4.

## Migration plan
- **`apps/core/migrations/0010_notifications_dedupe_actor_push.py`** (depends on `core.0009` and `users.0037` on the G4 branch; at rebase, on the users leaf present at G4's merge, i.e. G1's `0039`)
  1. AddField `Notification.dedupe_key` CharField(160, null) and `group_key` CharField(160, null).
  2. AddField `actor` FK→users.CustomUser, SET_NULL, null, `related_name="+"`.
  3. RunPython backfill (batched 2000, ordered by id, reverse no-op):
     - `dedupe_key="new_episode:{anime_id}:{episode_number}"` for new_episode rows, keeping the earliest when there are duplicates;
     - `group_key` on the newest unread row per target only (`review_like:{review_id}`, `forum_like:{t|p}:{id}`, `new_episode:{anime_id}`), so the partial unique index can be built;
     - `actor_id` from `follower_id`, `replier_id` or `liker_user_ids[0]` where present.
  4. AddConstraint `core_notif_user_dedupe_uniq` and `core_notif_user_group_unread_uniq` (both partial).
  5. Remove the indexes on `(is_email_sent, created_at)` and `(is_push_sent, created_at)`, and add the partial `core_notif_pending_idx`.
  6. AlterField `PushSubscription.endpoint` to URLField(max_length=2048).
  7. RunPython: dedupe endpoints, keeping the newest active row.
  8. Replace `Index(endpoint)` with `UniqueConstraint(endpoint)`.
  9. AddField `failure_count`.

  Reversible: the schema ops reverse automatically and the data steps reverse as no-ops. Reversing the unique constraints first requires no duplicates, which holds because the forward step removed them.
- **`apps/core/migrations/0011_notifications_preferences.py`**
  1. CreateModel `NotificationPreference`.
  2. RunPython: iterate `users.UserProfile.values_list("user_id", 4 flags)` in batches of 1000 and `bulk_create(ignore_conflicts=True)` with the frozen mapping. The mapping function is defined inside the migration so later code changes cannot alter it.
  3. Reverse: delete all rows. Lossless, because the legacy fields stay untouched.

  No users migration. Dropping the legacy fields is deferred to post-integration cleanup (integrator).

**Rollout.**
1. Deploy the migrations.
2. Set the VAPID env (generate with `manage.py generate_vapid_keys`).
3. Ship C-INT-7 in the same frontend deploy as P1-1, otherwise `boot.js` unregisters the push SW.
4. Existing `PushSubscription` rows were never created by the current frontend, so they are expected to be empty or test-only.

## Risks and open questions
- **Q1 Email default.** The legacy `email_new_episodes` defaulted True and users never chose it. A faithful copy means every verified legacy user gets one mail per episode. Recommendation: copy faithfully (as required) but gate on `email_verified`, and make new users default off. The owner may prefer `email = legacy AND email_verified`. Resend quota and cost are unverified.
- **Q2 Plan-to-watch behaviour change.** Today every episode notifies; the proposal sends the premiere only. This is a product call, and it is reversible inside the episode service.
- **R1 Schedule-based alerts.** The pending path trusts the stored `next_airing_date`, which is refreshed once a day. A postponed episode can produce a false "aired" alert. Accepted; the hourly cadence (C-INT-4) does not change it.
- **R2 pywebpush details.** The `ttl=0` default and the `requests_session` and `timeout` kwargs are unverified for 2.3.0. The implementer should check them in the venv, and the tests mock `webpush` with keyword assertions.
- **R3 iOS.** Push works only for installed PWAs (iOS 16.4+) and requires a user gesture. Badging and `renotify` support varies. The copy must not promise more than that.
- **R4 Fan-out.** A popular show with thousands of watchers means thousands of `group_send` calls from one worker, an estimated seconds of work (unverified). Chunking plus the hourly cadence keeps it bounded. Watch the Redis channel-layer capacity (3000, base.py:618).
- **R5 Seams dependency.** P1-2 and P1-3 cannot land cleanly until C-INT-1 moves the notification code out of the G6 file. If the seams commit skips it, G4 needs G6's consent per line.
- **R6 Matrix gap.** The ownership matrix gives G4 `apps/core/tasks/notifications.py` but not the service those tasks call (`celery_tasks.py`, G6). It also omits `templates/` and the `core` management commands for new files. C-INT-1 fixes the first; G4 creates only new files for the others.
- **R7 Group expiry.** Re-adding the group on ping is a heuristic. If the hourly re-add proves noisy, an alternative is a 23 h client reconnect.
