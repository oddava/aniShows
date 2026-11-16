# Feature revamp 5: Community (forums, reviews, favorites, badges, follows)
> Base: backend fix/anilist-only-and-fixes@17f082a, frontend feat/visual-ux-overhaul@ab5b3c2. Planning only.

Path conventions: backend paths are relative to the repo root (SLIM snapshot; the WT backend copies of every
community file are byte-identical to 17f082a, checked with `git diff --stat HEAD 17f082a`). Frontend paths
are relative to `frontend/src` (WT). The Django app label for `apps/animes` is `anime`.

## Summary
G5 owns the social layer: forums (threads, threaded replies, likes, live updates), reviews (ratings, votes,
reactions, reports, spoilers, points), favorites (anime/character/staff, ordering), badges (user side) and
follows (friends, friends-watching). The code mostly works and already has decent concurrency care (F()/Greatest
counters, versioned cache keys, a buffered view counter, an XSS corpus test). What's left is integrity bugs that
show wrong data (replies past depth 10 disappear, follow counts come back multiplied, favorite order gets corrupted
across pages, reviews can be moved to another anime), weak abuse controls (no throttles on reviews/follows/favorites,
reports that reopen themselves, unbounded mentions), missing day-to-day pieces (moderation, "edited" marker, thread
subscriptions, report button, keyboard/touch reorder) and a markdown pipeline that sanitizes markdown *source* as
HTML. The plan adds no services and no beat entries, and needs 2 forums + 1 anime + 1 users migrations.

## Current state

### Models
| Model | File | Notes |
|---|---|---|
| `Category`, `Tag`, `Thread`, `Post`, `ThreadLike`, `PostLike` | `apps/forums/models.py:22-147` | Denormalized `thread_count`, `reply_count`, `like_count`, `view_count`; `Post.parent` + `depth` (capped 10); counters adjusted via `Greatest(F()+d, 0)` |
| `Review`, `ReviewVote`, `ReviewReaction`, `ReviewReport` | `apps/animes/models/reviews.py:19-144` | unique (user, anime); votes helpful/dislike; 5 emoji reactions; report status open/in_review/resolved/dismissed |
| `UserFavorite` (+`order`), `UserFavoriteCharacter`, `UserFavoriteStaff` | `apps/animes/models/user_data.py:22-72` | only anime favorites have `order` |
| `UserFollow` | `apps/users/models.py:193-208` | unique (follower, following); no self-follow constraint |
| `Badge`, `UserBadge` (`is_featured`) | `apps/users/models.py:272-340` | featured limit 3 is enforced only in the view |
| `UserProfile.points` | `apps/users/models.py:57` | ±1 per helpful/dislike vote on own reviews (`apps/users/signals.py:133-192`) |

### Endpoints (all under `/api/v1/`)
| Method + path | View |
|---|---|
| GET `forums/categories/`, `forums/categories/{slug}/` | `CategoryViewSet` (`apps/forums/views.py:102-136`, cached 600/300 s) |
| GET `forums/tags/` | `TagViewSet` (`views.py:83-99`, cached 1 h) |
| GET/POST `forums/threads/`, GET/PATCH/DELETE `forums/threads/{id}/` | `ThreadViewSet` (`views.py:139-227`; anon list/detail via `get_or_build_public_payload`, 300 s) |
| POST `forums/threads/{id}/like/`, `/unlike/`, `/toggle_pin/` (admin) | `views.py:229-260` |
| GET/POST `forums/posts/?thread__id=`, PATCH/DELETE `forums/posts/{id}/`, POST `/like/`, `/unlike/` | `PostViewSet` (`views.py:263-355`; top-level posts paginated, all descendants appended) |
| WS `ws/forums/threads/{id}/` | `ForumThreadConsumer` (`apps/forums/consumers.py`), events `new_post`, `post_liked`, `thread_liked` |
| GET/POST `reviews/`, GET/PATCH/DELETE `reviews/{id}/`, GET `reviews/stats/?anime=` | `ReviewViewSet` (`apps/animes/views/reviews.py:30-55`) |
| POST `reviews/{id}/votes/`, `/reactions/`, `/report/` | `views/reviews.py:57-105` |
| GET/POST `favorites/` (+ full ModelViewSet), POST `favorites/toggle/`, `favorites/reorder/` | `FavoriteViewSet` (`apps/animes/views/favorites.py:27-64`) |
| GET/DELETE `character-favorites/`, `staff-favorites/` + POST `toggle/` | `views/favorites.py:67-110` |
| POST `follows/toggle/`; GET `follows/{followers,following,mutuals,check}/{username}/`; GET `follows/friends/watching/?anime_id=` | `FollowViewSet` (`apps/users/views/follows.py`) |
| GET `badges/mine/`, PUT `badges/featured/` | `UserBadgeViewSet` (`apps/users/views/badges.py`) |

Throttles: forum writes `forum_write` 10/min, likes `forum_like` 30/min (`apps/users/throttling.py:123-138`,
`root/settings/base.py:539-540`). Everything else falls back to the global `user` 150/min.

### Celery
`apps.core.tasks.cleanup_tasks.flush_forum_view_counts` (G6 file) runs every minute (`root/settings/celery_schedule.py:180-184`)
→ `CoreTaskService.flush_forum_view_counts` (`apps/core/services/celery_tasks.py:123-126`) →
`apps/forums/cache_utils.py:230 flush_buffered_thread_views(max_threads=)`. Buffer: Redis INCR + dirty SET, read-and-clear in one
MULTI (`cache_utils.py:204-256`). The buffering looks correct to me: a view landing between SMEMBERS and the pipeline is
either counted in the GET or stays in the key.

### Notification producers (G4's `NotificationService`, `apps/core/services/notification_service.py`)
forum reply (`:470`), reply-to-post (`:487`), mention (`:506`), forum like aggregated on unread (`:527-611`), review like
aggregated + retract (`:613-745`), new follower (`:454`, not deduped), badge awarded (`:747`, called by G6).
`create_review_reply_notification` (`:433`) has no producer (there are no review comments).

### Frontend
| Area | Files |
|---|---|
| Forum pages | `pages/forums/{ForumCategoryList,ForumThreadList,ForumThreadDetail,CreateThread}.jsx`; `styles/pages/forums.css` |
| Forum components | `components/forums/{ThreadOriginalPost,ThreadReplies,ThreadedPost,RichTextEditor,Avatar,ForumSkeletons,buildPostTree,useThreadMutations}`; `hooks/useForumWebSocket.js` |
| Forum API/keys | `api/modules/forums.js`; `api/queries/forums.js` (`forumKeys`: `forumCategories`, `forumCategory`, `forumTags`, `forumThreads`, `forumActiveThreads`, `forumNewThreads`, `forumSearch`, `forumRailFeed`, `forumThread`, `forumPosts`) |
| Reviews | `components/{ReviewCard,ReviewForm,ReviewSummary}.jsx`, `components/animeDetail/{ReviewsSection.jsx,useAnimeReviews.js}`; keys `reviewKeys` (`['reviews',…]`, `['reviewStats', slug]`) in `api/queries/user.js:73-78` |
| Favorites | `components/DraggableFavoritesGrid.jsx`, `components/common/EntityFavoriteButton.jsx`; `favoriteApi`, `characterFavoriteApi`, `staffFavoriteApi` (`api/modules/user.js:3-17`) |
| Social | `components/{FollowButton,FollowersModal,FriendsWatching}.jsx`, `components/profile/FriendsTab.jsx`, `hooks/useFriendsWatching.js`; `followApi` (`api/modules/user.js:70-78`) |
| Badges | `components/profile/{UserBadges,BadgesSettings}.jsx`, `components/settings/BadgesTab.jsx`; `badgeApi` (`api/modules/user.js:93-96`) |
| Markdown | `components/common/MarkdownRenderer.jsx` (also renders G1's bio in `components/profile/OverviewTab.jsx:364`) |

### Tests
Backend: `apps/forums/tests/{test_forums,test_integrity,test_cache_behavior}.py` (27 tests), `apps/animes/tests/test_reviews.py` (22, incl. a
query-count test at `:462`), `apps/animes/tests/test_character_and_staff_favorites.py` (6), `apps/users/tests/test_review_points.py` (2),
`apps/users/tests/test_concurrency.py:25,32` (follow), `apps/users/tests/test_profile_features.py:278,311` (followers list).
Frontend: `components/common/MarkdownRenderer.xss.test.jsx` (15 payloads), `components/forums/__tests__/buildPostTree.test.js`,
`components/ReviewCard.test.jsx`, `components/profile/__tests__/BadgesSettings.test.jsx`.
Note: the brief's suspected `apps/forums/test_forums.py` outside `tests/` doesn't exist. All forum tests are in `apps/forums/tests/`.

## Problems found
| ID | Sev | Area | Problem | Evidence path:line | Fix ref |
|---|---|---|---|---|---|
| F1 | High | Forums | Replies below tree level 10 are accepted but never returned. Depth is clamped to 10 while the parent link still nests deeper, and the fetch walks only 10 levels. In focus mode ("Continue this thread") the client depth restarts at 0, so Reply shows on level-10 posts, and the reply disappears once posted | `apps/forums/services/interactions.py:247`; `apps/forums/services/queries.py:58`; `components/forums/ThreadedPost.jsx:13,205` | P0-1 |
| F2 | Med | Forums | A posts page holds `page_size` top-level posts (client-settable up to 200) plus *all* their descendants, unbounded; `Count("replies")` GROUP BY over the joined author/profile/thread rows | `apps/shared/pagination.py:8-10`; `apps/forums/views.py:303-316`; `services/queries.py:38-50,53-76` | P0-2 |
| F3 | Med | Forums | `category` is writable on thread PATCH by the author: `thread_count` drifts (receivers only fire on create/delete), and threads can be moved into any category | `apps/forums/serializers.py:144`; `apps/forums/signals.py:119-142` | P0-3 |
| F4 | Med | Forums | Every like/unlike/post takes `SELECT … FOR UPDATE` on the actor's `CustomUser` row, which serializes against login/profile writes; the unique constraints already guard duplicates | `services/interactions.py:112,173,240,344,405` | P0-9 |
| F5 | Med | Forums | Mentions fan out unbounded: every `@name` in a post triggers a notification + WS push with no cap | `services/interactions.py:51-64` | P0-10 |
| F6 | Med | Forums | No moderation API. `is_locked` is read-only and has no endpoint; staff can't remove other users' posts (`IsOwnerOrReadOnly`); an author deleting a thread cascades away everyone's replies | `serializers.py:161-169`; `views.py:68-72`; `models.py:99`; `services/interactions.py:98-106` | P1-1 |
| F7 | Low | Forums | Edits can't be shown: `Thread.updated_at` is bumped by every reply, and there's no `edited_at` | `services/interactions.py:243-244` | P1-2 |
| F8 | Med | Forums | `ThreadListSerializer` returns full `content` for every row although its docstring says it doesn't; the lists only use a preview | `serializers.py:87,104`; `pages/forums/ForumCategoryList.jsx:105`; `pages/forums/ForumThreadList.jsx:96` | P1-5 |
| F9 | Med | Forums FE | Error toasts read `error.response.data.message`, but the envelope is `{detail, code}`, so "This thread is locked." never reaches the user | `components/forums/useThreadMutations.js:34,54,319`; `apps/core/api_errors.py:46-53`; `api/errors.js:7-9` | P1-4 |
| F10 | Med | Forums FE | The thread page shows "Thread not found" for any error (5xx, offline) with no retry; the forum index destructures no `error` and falls back to the empty state | `pages/forums/ForumThreadDetail.jsx:181-190`; `pages/forums/ForumCategoryList.jsx:217-262` | P1-4 |
| F11 | Low | Forums FE | The index requests `threads/?page=1&ordering=-updated_at` twice under two keys (`activeThreads(1)`, `railFeed`); "trending" is just page 1 re-sorted by `reply_count` | `api/queries/forums.js:47-62`; `pages/forums/ForumCategoryList.jsx:227-262,293-297` | P1-4 |
| F12 | Med | Forums a11y | Post edit/delete are icon buttons with `sm:opacity-0 group-hover:opacity-100` (invisible on keyboard focus) and only a `title`; the like button has no accessible name and no `aria-pressed` | `components/forums/ThreadedPost.jsx:119-150` | P1-11 |
| F13 | Low | Forums WS | The consumer accepts any thread id (including ones that don't exist); no edit/remove events, so open tabs show stale content | `apps/forums/consumers.py:28-40` | P2-3 |
| F14 | Low | Forums | Duplicate invalidation: `create_post` invalidates post list + thread caches and the `Post` post_save receiver does it again | `services/interactions.py:277-286`; `signals.py:39-40` | P1-12 |
| F15 | Low | Dead code | `Thread.increment_view_count` (no callers); `CategorySerializer` `prefetched_latest_thread` branch (never prefetched); `forumsApi.toggleThreadLike/togglePostLike` (no callers, identical to `like*`); duplicate view-buffer test | `apps/forums/models.py:92-95`; `serializers.py:71-82`; `api/modules/forums.js:49-52,78-81`; `tests/test_forums.py:156` vs `tests/test_cache_behavior.py:42` | P1-12 |
| M1 | Med | Markdown | DOMPurify runs on the *markdown source* (after string-built HTML), so text `>`/`<`/`&` come out as entities: a line-start `> quote` (inserted by the toolbar) becomes `&gt; quote` and no blockquote renders; inside code fences `<` shows as `&lt;`; HTML in code fences is stripped because fences are restored before sanitizing. (unverified: HTML-serializer behaviour, high confidence; write the failing test first) | `components/common/MarkdownRenderer.jsx:110-168` (sanitize `:164-167`, fence restore `:162`); `components/forums/RichTextEditor.jsx:157` | P1-6 |
| M2 | Low | Markdown | The client mention regex also matches inside emails/URLs (`a@b.com`, `x.com/@u`), while the server uses a lookbehind, so links show mentions nobody is notified of | `MarkdownRenderer.jsx:128-131`; `services/interactions.py:52` | P1-6 |
| M3 | Med | Spoilers | Two syntaxes (`||x||` in forums, `>!x!<` in reviews). Both spoiler elements are click-only `<span>`s (no keyboard, no role), and the hidden text is still read by screen readers (`text-transparent`) | `MarkdownRenderer.jsx:123-126,191-202`; `components/ReviewCard.jsx:48-79` | P1-6 |
| M4 | Low | Markdown | Images from any scheme/host (`![](url|w|a)` builds `<img>` before sanitize) leak the viewer's IP; no https-only rule | `MarkdownRenderer.jsx:143-158` | P1-6 |
| R1 | High | Reviews | `anime_slug` is writable on PATCH. A review can be moved to another anime, skipping the "must be on your list" rule; a uniqueness clash raises `IntegrityError`, which comes back as a 500 | `apps/animes/serializers/reviews.py:49`; `apps/animes/services/reviews.py:216,231-237` | P0-4 |
| R2 | Med | Reviews | `report_review` uses `update_or_create` and resets a resolved/dismissed report to OPEN, wiping `resolved_by`/notes. Any reporter can reopen a moderator's decision indefinitely | `services/reviews.py:374-385` | P0-5 |
| R3 | Med | Abuse | No throttles on review create/update/vote/react/report, follow toggle, favorite toggle/reorder, badge featured; `PublicReviewRateThrottle` is defined but unused | `views/reviews.py:30-32`; `apps/users/views/follows.py:27-32`; `views/favorites.py:56-64`; `apps/users/throttling.py:27-30` | P0-8 |
| R4 | Med | Reviews FE | Stats never refresh after create/edit/delete: the key `['reviewStats', slug]` sits outside the invalidated `['reviews']` prefix. The server aggregate isn't cached either | `api/queries/user.js:77`; `components/animeDetail/useAnimeReviews.js:66,79,88`; `services/reviews.py:163-177` | P1-7 |
| R5 | Med | Reviews perf | Seven `Count(distinct)` over two joined reverse relations (votes × reactions rows per review before GROUP BY); each review also nests `AnimeListSerializer` with genre/studio prefetches, even on that anime's own page | `services/reviews.py:50-58,133-153,37-39`; `serializers/reviews.py:48` | P1-7 |
| R6 | Med | Reviews FE | Every vote/reaction invalidates `['reviews']`, which refetches every loaded page of every review list; no optimistic update | `components/ReviewCard.jsx:133-145` | P1-7 |
| R7 | Med | Reviews UX | Backend report endpoint + G6 admin queue exist, but there's no Report action (`reviewApi` has no `report`) | `api/modules/user.js:31-39`; `pages/admin/AdminReviewReports.jsx` | P1-7 |
| R8 | Med | Reviews a11y | Owner menu: icon trigger without `aria-label`/`aria-expanded`, no Escape, outside-click overlay only; Delete has no confirmation | `components/ReviewCard.jsx:289-318` | P1-7 |
| R9 | Low | Reviews | Users can react to their own review (votes are blocked), which inflates counts | `services/reviews.py:285-289` vs `:328-363` | P1-7 |
| R10 | Low | Privacy | `GET reviews/?user=<private user>` lists their reviews, while favorites/follows hide private users | `services/reviews.py:101-103`; `services/favorites.py:34-37`; `apps/users/services/follow_service.py:40-47` | P1-7 |
| R11 | Low | Indexes | Exact duplicate indexes: `ReviewVote (user, review)`, `ReviewReaction (user, review, reaction_type)`, `UserFollow (follower, following)` duplicate their unique constraints; `Review (anime, user)` is covered by `(anime, -created_at)` + unique | `apps/animes/models/reviews.py:44,63-69,89-95`; `apps/users/models.py:198,203` | Migr. |
| V1 | Med | Favorites | Reorder corrupts the order: the profile loads 20 per page, and the grid sends only the loaded items as `order` 0..n-1, so unloaded items keep old values and collide; new favorites default to `order=0` | `pages/Profile.jsx:184-205`; `components/DraggableFavoritesGrid.jsx:44-45`; `apps/animes/models/user_data.py:26` | P0-7 |
| V2 | Med | Favorites | The reorder payload isn't validated: a non-dict item raises `TypeError` and a non-int `order` a DB error, both 500; no size cap | `apps/animes/services/favorites.py:172-193` | P0-7 |
| V3 | Med | Favorites | Toggle with a non-numeric id raises `ValueError`, which comes back as a 500; it also locks the catalog row (`Anime`/`Character`/`Staff` FOR UPDATE) and the `CustomUser` row, which contends with catalog sync | `services/favorites.py:95-96` | P0-7, P0-9 |
| V4 | Med | Favorites | `FavoriteViewSet` is a full ModelViewSet. POST of a duplicate raises `IntegrityError` → 500 (no unique validator because `user` isn't a serializer field); PATCH is dead surface. The frontend uses only list/toggle/reorder | `views/favorites.py:27-54`; `apps/users/serializers/users.py:430-436`; `api/modules/user.js:3-7` | P0-7 |
| V5 | Low | Favorites | Errors come back as `{"error": …}` in a plain `Response`, outside the `{detail, code}` envelope | `views/favorites.py:58-64`; `services/favorites.py:90-91` | P0-7 |
| V6 | Med | Favorites UX | Reorder is HTML5 drag only: no touch, no keyboard; the grip shows only on hover; failure silently reverts | `components/DraggableFavoritesGrid.jsx:26-70,84-101,47-49` | P1-8 |
| V7 | Low | a11y | `EntityFavoriteButton` has no `aria-pressed`; its accessible name is the count | `components/common/EntityFavoriteButton.jsx:31-48` | P1-8 |
| V8 | Info | Jikan remnant | slim-down's cast refresh (3161be3) moves character/staff favorites off Jikan synthetic-ID rows (`anilist_id ≥ 1.6e9/1.7e9`) with queryset `update`/`delete` (no signals → no cache/stats refresh). Favorites on legacy rows that never get matched stay attached to stale people. No other Jikan/MAL/Mongo/Typesense references in G5 code in either tree | `apps/animes/services/providers/anilist/persistence.py:40-43,69-73,85-104` (FROZEN) | P2-5, Contracts |
| S1 | High | Follows | `toggle_follow` returns wrong counts: one aggregate with two `Count`s over two reverse FKs multiplies rows (followers × following of the same user). `FollowButton` writes these numbers into the profile caches | `apps/users/services/follow_service.py:81-84`; `components/FollowButton.jsx:113-140` | P0-6 |
| S2 | Med | Follows | No DB guard against self-follow (service check only); the signal even has a self-follow branch | `apps/users/models.py:193-208`; `follow_service.py:58`; `apps/users/signals.py:86-88` | P0-6, Migr. |
| S3 | Med | Abuse | Follow → unfollow → follow creates a new "started following you" notification every time (no dedupe), and the endpoint is unthrottled | `apps/users/signals.py:77-100`; `notification_service.py:454-468` | P0-8, Contracts |
| S4 | Med | Social FE | `useFriendsWatching` is a hand-rolled `useEffect` fetch: no cache/dedupe, refetches on every mount, never refreshed after a follow change; errors render the same as "no friends" | `hooks/useFriendsWatching.js:11-36`; `components/FriendsWatching.jsx:96` | P1-9 |
| S5 | Low | Social perf | Friends-watching scans all list rows for the anime and joins `UserFollow` twice; fine today, degrades for popular titles (unverified, needs EXPLAIN on prod-like data) | `follow_service.py:174-193` | P1-9 |
| S6 | Low | Social a11y | `FollowersModal` handles Escape but has no focus trap/return; its search filters only loaded pages; `FollowButton` is icon-only on phones with `title` only | `components/FollowersModal.jsx:89-96,141-149,176-178`; `components/FollowButton.jsx:219,227,234,282-313` | P1-9 |
| B1 | Low | Badges | `featured`: non-int ids → 500; inactive badges count toward the limit of 3 but are hidden by `BadgesMixin`; reset+set isn't atomic | `apps/users/views/badges.py:37-56`; `apps/animes/serializers_mixins.py:206-208` | P1-10 |
| B2 | Low | Points | Points semantics undocumented (±1 per vote, can go negative); `backfill_points` runs one query per profile and duplicates `recalculate_user_points` | `apps/users/signals.py:160-192`; `apps/users/management/commands/backfill_points.py:35-47` | P1-10 |
| B3 | Low | Points | Deleting a review cascades its votes; each vote's post_delete re-fetches `instance.review.user` (N+1 on delete) | `apps/users/signals.py:148-157` | P1-10 |
| B4 | Low | Badges | Grant logic (notification, cache) lives in G6's view rather than a badge domain service | `apps/users/views/admin_badges.py:54-121` | P1-10, Contracts |
| T1 | Med | Tests | Untested: depth cap, edit/delete permissions on posts/threads/reviews (IDOR), thread move, reorder/toggle validation, follow counts, friends-watching privacy, featured badges, report workflow, stats invalidation, markdown rendering correctness | test files listed above | Test plan |

Checked and fine (no change needed): edit/delete IDOR on threads/posts (`views.py:68-72`), reviews (`services/reviews.py:233,242`)
and favorites (`services/favorites.py:74-77`); self-vote on reviews blocked (`services/reviews.py:285`); forum like
notifications aggregate (`notification_service.py:566-603`); view-count buffer flush atomicity (`cache_utils.py:243-248`); the XSS
corpus passes by construction (DOMPurify strips `javascript:` from `src`/`href`; react-markdown 10 `urlTransform`).

## Proposed scope

### P0 (bugs, security, data integrity)
- **P0-1 Forum depth contract (F1), M.** Add `Post.MAX_DEPTH = 10`. `PostSerializer.validate` rejects `parent.depth >= MAX_DEPTH` with 400
  `{"parent": "This conversation is too deep to reply here. Reply higher up."}`. `get_threaded_posts_page` loops `MAX_DEPTH` levels
  (levels 1..10, now complete). Data migration (forums 0010) re-parents existing too-deep posts onto their depth-9 ancestor.
  Frontend: show Reply only when the absolute `post.depth < 10` (from the API), keeping the visual nesting cap of 8 with "Continue this thread".
  Files: `apps/forums/{models,serializers}.py`, `services/{interactions,queries}.py`, `components/forums/ThreadedPost.jsx`.
- **P0-2 Bounded post pages (F2), M.** A forums-local `ForumPostPagination(page_size=20, max_page_size=50)` in `apps/forums/pagination.py`
  (new; does not touch G2's `apps/shared/pagination.py`). Cap descendants per page at `MAX_DESCENDANTS_PER_PAGE = 300`, breadth-first;
  posts whose children were cut get `has_hidden_replies: true` (additive field). Add `?root=<post_id>`: returns that post and its
  subtree (same cap), so "Continue this thread" works even when the post isn't on the current page; `buildPostTree` focus mode uses it.
  Replace `annotate(reply_count=Count("replies"))` with a correlated `Subquery` count (no GROUP BY over joined rows). Keep the 20 per page assumption in
  `ForumThreadDetail.jsx:319-325` but read `page_size` from the response (`results.length`/`count`), not a literal.
- **P0-3 Thread category immutable for authors (F3), S.** `ThreadSerializer.validate`: drop `category` on update unless `request.user.is_staff`;
  a staff move in `update_thread` adjusts both categories' `thread_count` and invalidates both category caches.
- **P0-4 Review anime immutable (R1), S.** On update, `anime_slug` that differs from `instance.anime` is a 400 (`anime_slug: "A review cannot be
  moved to another anime."`); also catch `IntegrityError` in `update_review` → 400. Files: `apps/animes/{serializers,services}/reviews.py`.
- **P0-5 Report workflow (R2), S.** `report_review`: if the report is OPEN/IN_REVIEW, update reason/description (200); if RESOLVED/DISMISSED,
  return 200 `{status, created: false}` without changing it. A reporter may file at most 20 reports/day (count query). The admin side (G6)
  sees the same model; no schema change.
- **P0-6 Follow counts + self-follow (S1, S2), S.** Two independent `count()` queries (or `Subquery`) for `followers_count`/`following_count`.
  DB `CheckConstraint(~Q(follower=F("following")), name="users_userfollow_no_self")` (users migration). Remove the dead self-follow branch
  from `handle_new_follower` only after G4 agrees (the notify call is theirs; the branch around it is G5's receiver).
- **P0-7 Favorites API hardening (V1-V5), M.** (a) `FavoriteViewSet` → `ListModelMixin, DestroyModelMixin, GenericViewSet` + `toggle`,
  `reorder` (drop create/update; nothing calls them). (b) Validate ids as positive ints (400 envelope). (c) `reorder` takes
  `{"ids": [favorite_id, …]}` (keep accepting legacy `items:[{id,order}]` for one release), max 500 entries, ints, unique, each owned by the
  user. In one transaction it locks the user's favorites, renumbers the listed ones 0..n-1 and appends any unlisted favorites after them in
  their current order (no collisions). (d) New favorites get `order = min(order) - 1`, so they appear first without disturbing a custom
  order. (e) Errors go through `api_response` (`{detail, code}`). Files: `apps/animes/{views,services}/favorites.py`, `apps/users/serializers/favorites.py`.
- **P0-8 Rate limits (R3, S3), S.** Only existing scopes (settings are FROZEN): `StrictUserRateThrottle` (10/min) on review create/update/
  destroy/report and follow toggle; `UserActionRateThrottle` (120/min) on review votes/reactions, favorite toggle/reorder, badge featured.
  Forum scopes stay. The frontend shows the existing "You are doing that too fast" copy for 429 in review/follow/favorite mutations.
- **P0-9 Drop needless row locks (F4, V3), S.** Remove `User.objects.select_for_update()` from forum like/post paths and favorites toggle;
  don't lock catalog rows. Rely on unique constraints and catch `IntegrityError` → idempotent outcome (pattern already in `toggle_follow`).
  Keep the `Thread`/`Post` locks where they protect `like_count`.
- **P0-10 Mention cap (F5), S.** At most 10 distinct mentions notified per post/thread; mentions only resolve to active users. On edit, notify
  only mentions added since the previous content (diff of username sets).

### P1 (daily-use UX, missing tests)
- **P1-1 Basic moderation (F6), M/L.** Staff-only actions: `POST forums/threads/{id}/toggle_lock/`, `POST forums/{threads|posts}/{id}/remove/`
  and `/restore/` (soft: `is_removed=True`, `removed_by`, `removed_at`, `removal_reason` ≤ 200 chars). Removed threads are excluded from
  lists and counters (category `thread_count`, thread `reply_count` adjusted) and return 404 to non-staff. Removed posts keep their place in the tree
  as "This reply was removed" (content/author withheld from non-staff). Author delete: a post *with replies* is soft-removed (placeholder
  "[deleted]") instead of cascading; a thread with replies from others → 409 `{detail: "Threads with replies can only be removed by a moderator."}`.
  Each moderator action writes an audit row through G6's helper (Contracts). UI: in `ThreadOriginalPost.jsx`/`ThreadedPost.jsx` a staff "Moderate" disclosure
  (Lock/Unlock, Remove, Restore) with confirm.
- **P1-2 "Edited" marker (F7), S.** `edited_at` on Thread and Post, set when `title`/`content` actually changes. Shown as "edited" next to the
  timestamp with a `<time title>` tooltip; serializers expose `edited_at`.
- **P1-3 Thread subscriptions, M.** Model `ThreadSubscription(user, thread, created_at)`, unique pair. `POST/DELETE forums/threads/{id}/subscription/`;
  `is_subscribed` on `ThreadSerializer` (Exists annotation, auth only). Auto-subscribe the author on create and a replier on their first post (no
  setting). New post → `transaction.on_commit` → Celery task `apps.forums.tasks.notify_thread_subscribers(post_id)` (default queue, no beat entry).
  It notifies subscribers except the post author and anyone already notified for this post (thread author/parent author/mentioned), capped at 500
  recipients via G4's bulk notify. Removed/locked threads don't notify. UI: Follow-thread toggle (bell, `aria-pressed`) in the thread header.
- **P1-4 Honest states + error envelope (F9-F11, V5), S/M.** All forum/review/follow/favorite mutations use `getApiErrorMessage(error, fallback)`.
  Thread page: 404 → current "Thread not found"; other errors → `ErrorState` with retry. Forum index: `ErrorState` per failed block. Drop
  `railFeed` (derive the rail from `activeThreads(1)`) and rename "Trending" to "Most replies" (honest label), or fetch `ordering=-reply_count`
  if added to `CACHEABLE_THREAD_ORDERINGS` with a matching index (decide in implementation; prefer the label change).
- **P1-5 Thread list excerpt (F8), S.** `ThreadListSerializer` drops `content` and adds `excerpt` (server-side: markdown/spoiler syntax stripped,
  spoiler text replaced by "[spoiler]", 200 chars). `getThreadPreview` in both list pages reads `excerpt`.
- **P1-6 Markdown pipeline (M1-M4), L.** `MarkdownRenderer` gains `mode` prop: `"markdown"` (forums, reviews if adopted) parses markdown
  with **no raw HTML** (no `rehype-raw`, no string-built HTML, no DOMPurify step). Spoilers (`||x||` and `>!x!<`), mentions (server-equivalent
  lookbehind regex, not inside links/code), YouTube embeds and sized images (`![](url|w|a)`, https only) become small local remark plugins
  (mdast nodes with `data.hName`, no new deps). The default `"legacy"` mode stays byte-for-byte what it is today, because G1's bio is stored as allowlisted HTML
  (`apps/users/serializers/users.py:53-85`) and must keep rendering. New shared `components/common/Spoiler.jsx`: a `<button aria-expanded>`
  showing "Spoiler, activate to reveal"; the hidden text isn't in the accessibility tree until revealed; respects reduced motion. Used by
  both MarkdownRenderer and ReviewCard. Existing stored forum content is bleach-stripped of all tags (`serializers.py:29-30`), so nothing
  depends on raw HTML in forum posts.
- **P1-7 Reviews (R4-R10), M.** Vote/reaction responses add the review's `helpful_count`, `dislike_count`, `reactions`, `user_votes`
  (additive). `ReviewCard` patches the cached infinite pages with `setQueryData` (optimistic, rollback on error) instead of invalidating
  `['reviews']`. Create/update/delete also invalidate `reviewKeys.stats(slug)`. Server stats cached with `get_or_build_public_payload`
  key `review_stats:{slug}`, 300 s, invalidated in the Review post_save/post_delete receiver. Queryset: per-review counts via `Subquery`
  (one subquery per counter), `Exists` for viewer state, no `distinct` joins. When `?anime=` is given, serialize `anime` with a compact
  serializer (id, slug, title, image) and skip genre/studio prefetches (profile/`?user=` keeps `AnimeListSerializer`; G3's insights call
  uses `?user=`). Report dialog for non-owners (reason via `CustomSelect`, optional 500-char note, done/duplicate copy). Owner/report menu
  becomes a disclosure (`aria-expanded`, Escape, focus return). Delete asks for confirmation. Self-reactions → 400. `?user=<private>` returns
  empty unless the viewer is that user (reviews on the anime page stay visible: they're public contributions; see open question).
  "Most helpful" sort already exists and stays the default.
- **P1-8 Favorites reorder UX (V6, V7), M.** Owner "Reorder" toggle on the Favorites tab. In reorder mode it fetches all favorites (page_size
  200, follow `next`, cap 500), shows Move earlier/Move later buttons per card (keyboard + touch; arrow keys on a focused handle), keeps HTML5
  drag as a desktop extra, and saves the full id list (P0-7c). Saving state is inline; a failure shows an `ErrorState`-style message and
  reverts. `EntityFavoriteButton`: `aria-pressed`, `aria-label="Favorite <label>"` / "Unfavorite …", count as visible text.
- **P1-9 Social (S4-S6), S/M.** `socialQueries.friendsWatching(animeId)` (`['friendsWatching', animeId]`, staleTime 60 s, auth only),
  invalidated by follow toggle; `useFriendsWatching` becomes a thin wrapper (keeps its return shape for `FriendsWatching.jsx`).
  Backend: filter `user_id__in=<mutual-follow subquery for request_user>` (uses the unique (user, anime) index); return `{results, total}`
  with `total` for "+N more" (the frontend tolerates both shapes today). `FollowersModal` uses `useFocusTrap` (frozen hook, consume only) and
  returns focus to the opener; `?search=` (username icontains, ≥2 chars) on followers/following/mutuals instead of filtering loaded pages.
  `FollowButton` gets `aria-label` and `aria-pressed`.
- **P1-10 Badges + points (B1-B4), S.** New `apps/users/services/badge_service.py`: `MAX_FEATURED_BADGES = 3`; `set_featured_badges(user, ids)`
  (ints, unique, owned, active badge; atomic); `grant_badge(user, badge, granted_by, reason)` / `revoke_badge(...)` (cache invalidation +
  `badge_awarded` notify), for G6 to call. `mine` returns `is_active` per badge so settings can explain inactive ones. Points: document
  "points = Σ over votes on the user's reviews (helpful +1, dislike −1); may be negative; not affected by reactions or forum likes" in the
  service docstring. Move the recalculation into `apps/users/services/points_service.py` (new) with a single grouped query used by
  `recalculate_user_points` and `backfill_points` (one UPDATE … FROM per batch of 500). Vote post_delete uses `instance.review.user_id` via
  `select_related` or a values lookup (no N+1).
- **P1-11 Forum accessibility (F12), S.** Post actions visible on `:focus-within`; `aria-label`s ("Edit reply by X", "Delete reply", "Like
  reply, N likes" + `aria-pressed`); disabled-for-guests buttons get "Sign in to like" text. `window.confirm` stays for now (it's accessible),
  styled confirm is P2.
- **P1-12 Cleanup (F14, F15), S.** Remove the duplicate invalidation in `create_post` (keep the receiver's), the dead model method,
  serializer branch and frontend aliases, and the duplicate test.
- **P1-13 Tests (T1), M.** See the test plan.

### P2 (nice to have)
- P2-1 Styled `ConfirmDialog` in `components/forums/ConfirmDialog.jsx` (focus trap, Escape), reused by ReviewCard; S.
- P2-2 Unread marker per thread for subscribers (last-seen post id stored on `ThreadSubscription`); S.
- P2-3 WS consumer: reject unknown/removed thread ids (close 4404, one DB query); broadcast `post_updated`/`post_removed`; S.
- P2-4 Followers/following lists show "Follows you" via the existing `_is_follower` annotation (already in the payload); S.
- P2-5 Management command `report_legacy_favorites` (read-only): counts favorites still on `anilist_id ≥ 1.6e9/1.7e9` rows, for the integrator to
  decide on cleanup after slim-down's refresh has run; S.
- P2-6 Review helpfulness: "Most helpful" uses a Wilson lower bound on helpful vs dislike instead of the raw helpful count; S.

### Out of scope
Review comments/replies (`create_review_reply_notification` stays dead in G4); DMs/blocks; follow requests for private profiles (a private
profile can still be followed; nothing is revealed); forum full-text search (keep `SearchFilter` icontains); image uploads in posts; new
throttle scopes; admin pages (G6); the notification/push transport (G4); `NotificationsTab` (G4); moving catalog favorites (slim-down).

## File ownership
Post-seams paths (current file in brackets where the seams commit splits it).

**Backend, may change:**
- `apps/forums/**` (all), plus new: `apps/forums/pagination.py`, `apps/forums/tasks.py`, `apps/forums/services/{moderation,subscriptions,excerpt}.py`,
  `apps/forums/migrations/0009_community_moderation_subscriptions.py`, `0010_community_reparent_deep_posts.py`, `apps/forums/tests/test_*.py`.
- `apps/animes/views/{reviews,favorites}.py`, `apps/animes/services/{reviews,favorites}.py`, `apps/animes/serializers/reviews.py`.
- Models `Review*`, `UserFavorite*` in `apps/animes/models/{reviews,user_data}.py` (only those classes) + `apps/animes/migrations/00NN_community_review_index_cleanup.py`.
- Review/favorite receivers in `apps/animes/signals.py` (`handle_user_favorite_change`, `handle_review_change` + new stats-cache invalidation receiver).
- `apps/users/views/{badges,follows}.py`, `apps/users/services/follow_service.py`, new `apps/users/services/{badge_service,points_service}.py`.
- `apps/users/serializers/badges.py` (BadgeSerializer, UserBadgeSerializer), `apps/users/serializers/favorites.py` (Favorite*, FavoriteCompactSerializer),
  `apps/users/serializers/social.py` (FollowSerializer, UserFollowListSerializer, FriendWatchingSerializer) [all from `apps/users/serializers/users.py`].
- `apps/users/urlconf/social.py` (follows + badges routes) [from `apps/users/urls.py`].
- Models `Badge`, `UserBadge`, `UserFollow` in `apps/users/models.py` (only those classes) + `apps/users/migrations/00NN_community_follow_no_self.py`.
- In `apps/users/signals.py`: points receivers (`update_points_on_vote_*`, `_adjust_points`, `recalculate_user_points`) and the cache-invalidation
  parts of `handle_new_follower`/`handle_unfollow` (not the notify call).
- `apps/users/management/commands/backfill_points.py`; tests `apps/animes/tests/test_{reviews,favorites_api,review_stats}.py`,
  `apps/users/tests/test_{follows,badges,points}.py`, `apps/animes/tests/test_character_and_staff_favorites.py`, `apps/users/tests/test_review_points.py`.

**Frontend, may change (under `frontend/src`):**
- `pages/forums/*`, `components/forums/*` (+ new `ConfirmDialog.jsx`, `remarkCommunity.js` plugins), `styles/pages/forums.css`, `hooks/{useForumWebSocket,useFriendsWatching}.js`.
- `components/{ReviewCard,ReviewForm,ReviewSummary,DraggableFavoritesGrid,FollowButton,FollowersModal,FriendsWatching}.jsx` (+ tests).
- `components/animeDetail/{ReviewsSection.jsx,useAnimeReviews.js}`.
- `components/common/{EntityFavoriteButton,MarkdownRenderer}.jsx`, `MarkdownRenderer.xss.test.jsx`, new `components/common/Spoiler.jsx` (+ test).
- `components/profile/{FriendsTab,UserBadges,BadgesSettings}.jsx` and the favorites/reviews/friends tab bodies under `components/profile/tabs/`
  [from `components/profile/ProfileContent.jsx`]; `components/settings/BadgesTab.jsx`.
- `api/modules/{forums,favorites,reviews,social,badges}.js` [from `api/modules/user.js`], `api/queries/{forums,favorites,reviews,social,badges}.js`
  [from `api/queries/user.js`], and the rows for these keys in `api/queries/__tests__/queryKeys.test.js`.

**Must not touch:** `apps/core/**` (G4/G6; notification and audit code are consumed), `apps/admin_api/**`, `apps/{forums,animes,users}/admin.py`
(G6), `apps/users/views/admin_badges.py` (G6), `apps/users/throttling.py`/`permissions.py` (G1, consume only), `apps/animes/serializers_mixins.py`
and `serializers/{anime,base}.py` (G2), `UserAnimeList`/`UserStats` (G3), `apps/shared/*` (FROZEN, consume `public_cache`), catalog
ingestion incl. `providers/anilist/persistence.py` (FROZEN), `root/**`, `package.json`, `App.jsx`, `app/routes.jsx`, `pages/{AnimeDetail,
CharacterDetail,VoiceActorDetail,Profile}.jsx` (G2/G1), `components/profile/{ProfileContent,ProfileHeader,OverviewTab}.jsx` shells (G1),
`components/common/{CustomSelect,ErrorState,…}` and shared hooks (FROZEN, consume).

## Cross-group contracts

**Provided by G5 (frozen interfaces, keep stable):**
- REST shapes: `favorites/toggle` → `{is_favorite, favorite_count, message}` (used by G2's `AnimeDetail.jsx:81`, `CharacterDetail.jsx:133`,
  `VoiceActorDetail.jsx:97`); character/staff favorites list items `{id, character|staff, added_at}`; `reviews/?user=` item shape incl.
  full `anime` (G3's `insightsQueries.reviews`, `api/queries/user.js:214-217`). Changes are additive only: `has_hidden_replies`, `edited_at`,
  `is_subscribed`, `excerpt` (with `content` removed from thread *lists* only; G5 is the only consumer), vote/reaction counts.
- Exported names stay: `favoriteApi`, `characterFavoriteApi`, `staffFavoriteApi`, `reviewApi` (+ new `report`), `followApi`, `badgeApi`,
  `forumsApi` (minus the two dead aliases), keys `favoriteKeys`, `characterFavoriteKeys`, `staffFavoriteKeys`, `reviewKeys`, `followKeys`,
  `friendKeys`, `badgeKeys`, re-exported from `api/client.js` / `api/queries/user.js`.
- `EntityFavoriteButton` props unchanged (`isAuthenticated, isFavorite, favoriteCount, isPending, onToggle, entityLabel`).
- `MarkdownRenderer` default (`mode` omitted) = current behaviour, for G1's bio; `mode="markdown"` is opt-in.
- `flush_buffered_thread_views(*, max_threads=None) -> {"flushed","missing","processed_threads"}` (called by G6's `cleanup_tasks.py`).
- `badge_service.grant_badge/revoke_badge/set_featured_badges`, `MAX_FEATURED_BADGES` (for G6 admin and G2's `BadgesMixin`).
- `UserProfile.points` meaning (read by G1 serializers and `ReviewUserSerializer`/`UserFollowListSerializer`).
- Model field names `UserFavoriteCharacter.{user,character}`, `UserFavoriteStaff.{user,staff}` stay (slim-down's `_move_favorites` writes them).

**Consumed by G5:**
- G4 `NotificationService`; requested contract below. G6 `AuditLog`. G1 `CustomUser`/`UserProfile.is_private` (read only),
  `VerifiedEmailForWrites`, throttle classes. G3 `UserAnimeList` (review gating, friends-watching, `_is_completed`). G2 `AnimeListSerializer`,
  `CharacterCompactSerializer`, `StaffCompactSerializer`, `public_cache.get_or_build_public_payload`.

**Requests:**
- **G4 (notifications):** expose `notify(recipient, type, *, actor=None, data: dict, aggregate_key: str|None=None, dedupe_key: str|None=None,
  dedupe_window=timedelta(hours=24), priority="medium") -> Notification|None`. It must never raise, must be safe inside `on_commit`, and
  must aggregate on unread rows by `aggregate_key` (today's forum/review like behaviour). Also `retract(recipient, type, aggregate_key, actor)` (review/forum
  unlike) and `notify_many(recipients, type, *, actor, data)` doing `bulk_create` + one unread-count bump per user (subscriber fan-out ≤ 500).
  Types G5 emits: `forum_reply` (thread reply, reply-to-post, and subscription activity with `data.reason in {"thread","parent","subscription"}`),
  `forum_mention`, `forum_like` (aggregate `forum_like:{thread_id}:{post_id|thread}`), `review_like` (aggregate `review_like:{review_id}`),
  `new_follower` (dedupe `follow:{follower_id}:{following_id}`), `badge_awarded`. Please make the follower notification deduped (S3) in
  `handle_new_follower`'s notify call, which is G4's. Until `notify` lands, G5 keeps calling the existing `create_*` methods (names unchanged).
- **G6 (admin):** (1) a helper `apps/core/services/audit.py::record_audit(actor, action, entity_type, entity_id, entity_repr, changes=None,
  metadata=None, ip=None)` (wrapping `log_audit_async`), used for lock/remove/restore/move; (2) `admin_badges.py` calls G5's `grant_badge`/
  `revoke_badge`; (3) `apps/forums/admin.py`: show `is_removed`, `removed_by`, `edited_at`, add `ThreadSubscription` read-only; (4) review-report
  status semantics change (P0-5): resolved/dismissed reports no longer reopen; the admin queue needs no code change. Optionally a forum moderation
  queue later (out of scope here).
- **G2 (browse):** optionally adopt a G5 hook `useToggleFavorite(kind)` from `api/queries/favorites.js` in AnimeDetail/CharacterDetail/
  VoiceActorDetail (today `AnimeDetail.jsx:78-92` swallows toggle errors silently). `BadgesMixin` (`serializers_mixins.py:206-208`): replace the
  literal `[:3]` with `MAX_FEATURED_BADGES`. No shape changes requested.
- **G1 (accounts):** none required. FYI: `MarkdownRenderer` legacy mode is frozen for bios; if G1 wants the safer mode for bios later, that's a G1
  data decision (stored HTML).
- **G3 (lists):** none. FYI: `UserStats.followers_count/following_count` come from G3's stats task; G5 only invalidates caches. The matrix's
  "follow-count receivers" don't exist as count writers.
- **Integrator:** (1) seams: put `UserBadgeViewSet` + `FollowViewSet` routes in `apps/users/urlconf/social.py`; serializers into `badges.py`,
  `favorites.py`, `social.py` as listed. (2) Optional explicit route `"apps.forums.tasks.*": {"queue": "default"}` in `root/celery.py`
  (autodiscovery already picks the task up; default queue is fine). (3) `rehype-raw` stays in `package.json` (legacy mode still uses it).
  (4) Migration renumbering at merge: anime (slim-down may take 0057), users (G1/G3 also add).

**Collision avoidance:** G5 edits `apps/animes/signals.py` only inside its two receivers + one new receiver block at the end of the file;
`apps/users/signals.py` only below the "Points signals" banner and the cache lines of follow receivers. No edits to `apps/animes/urls.py`
(routes unchanged). New endpoints are actions on existing viewsets.

## Acceptance criteria and test plan

**Criteria (each verifiable):**
- [ ] Replying to a depth-10 post → 400 with the depth message; every stored post in a seeded 12-level chain is returned by the posts endpoint
  after the 0010 migration; `?root=<id>` returns the subtree.
- [ ] A posts page never exceeds 50 top-level + 300 descendants; `page_size=200` is clamped to 50.
- [ ] An author PATCHing `category` doesn't move the thread; a staff move updates both `thread_count`s.
- [ ] PATCH review with another `anime_slug` → 400; nothing is moved; no 500 path for review update.
- [ ] Re-reporting a dismissed report keeps `status=dismissed`, `resolved_by`, notes.
- [ ] `follows/toggle` returns counts equal to `UserFollow.objects.filter(...).count()` for a user who follows 3 and is followed by 2.
- [ ] Inserting a self-follow row raises `IntegrityError`.
- [ ] Favorites: reorder with `ids` covering 5 of 25 favorites yields a strict total order (no duplicate `order` among the user's rows);
  malformed payloads (`[1]`, `[{"id":"x"}]`, 501 ids, someone else's id) → 400, never 500; toggle with `"abc"` → 400; POST `/favorites/` → 405.
- [ ] 429 is returned by the 11th review create in a minute; the frontend shows the throttle copy.
- [ ] A thread with 15 mentions creates exactly 10 mention notifications.
- [ ] Staff lock → non-staff reply 400; staff remove → thread hidden from lists/404 for others, counters adjusted, one audit row; restore reverses.
- [ ] Editing content sets `edited_at`; posting a reply does not.
- [ ] A reply notifies subscribers once each, not the replier, and not someone already notified as parent author; unsubscribe stops it.
- [ ] Thread page on 500 shows `ErrorState` with retry; on 404 shows "Thread not found".
- [ ] `> quote` renders a `<blockquote>`; "```\nif (a < b) {}\n```" renders `a < b` literally inside `<code>`; all 15 existing XSS payloads still pass in both modes.
- [ ] Spoilers are reachable with Tab, toggle with Enter/Space, and their text isn't in the accessibility tree before reveal.
- [ ] Voting updates the card without refetching other pages (assert a single network call in vitest); stats update after creating a review.
- [ ] Favorites can be reordered by keyboard only and on a 375 px touch viewport.

**Backend tests to add:**
- `apps/forums/tests/test_tree_depth.py` (depth cap, migration re-parent via `MigrationExecutor`, `?root=`, descendant cap, page_size clamp).
- `apps/forums/tests/test_permissions.py` (edit/delete others' thread/post → 403; category move; locked thread; staff remove/restore/lock; 409 on thread delete with replies).
- `apps/forums/tests/test_subscriptions.py` (auto-subscribe, fan-out exclusions, cap, task runs eagerly: `root/settings/test.py:53` sets `CELERY_TASK_ALWAYS_EAGER = True`).
- `apps/forums/tests/test_mentions.py` (cap 10, edit-diff, no self-mention).
- `apps/forums/tests/test_query_budget.py`: thread list (20 rows) ≤ 6 queries; posts page (20 top-level + 40 replies) ≤ 8; thread detail ≤ 6 (use `django_assert_max_num_queries`).
- `apps/animes/tests/test_reviews.py` (+ anime immutability, report reopen, self-reaction, private `?user=`, stats cache invalidation, vote response counts);
  keep `test_review_list_query_count_stays_constant` and assert ≤ 8 queries for 20 reviews with votes and reactions.
- `apps/animes/tests/test_favorites_api.py` (reorder validation + total order, legacy payload, toggle validation, 405 on create, envelope).
- `apps/users/tests/test_follows.py` (counts, self-follow constraint, throttle, friends-watching: mutual only, private excluded, ≤ 4 queries, `total`).
- `apps/users/tests/test_badges.py` (featured: ints, unique, owned, inactive rejected, atomic; grant/revoke service notify + cache).
- `apps/users/tests/test_points.py` (backfill grouped equals per-user recalc; review delete with 30 votes ≤ 6 queries).
- Delete the duplicate `test_public_thread_detail_buffers_view_count` in `apps/forums/tests/test_forums.py`.

**Frontend vitest:**
- `components/common/MarkdownRenderer.xss.test.jsx`: run the payload corpus for both modes; add a rendering-correctness block (blockquote, code with `<`/`&`, mention not inside email/URL, https-only images).
- `components/common/Spoiler.test.jsx` (keyboard toggle, `aria-expanded`, hidden from a11y tree).
- `components/forums/__tests__/buildPostTree.test.js` (+ focus root from `?root=` payload, `has_hidden_replies`).
- `components/forums/__tests__/ThreadedPost.test.jsx` (Reply hidden at depth 10, accessible names, actions visible on focus).
- `components/forums/__tests__/useThreadMutations.test.jsx` (envelope `detail` shown in toast).
- `components/ReviewCard.test.jsx` (+ optimistic vote, rollback on error, report dialog, menu disclosure + Escape, delete confirm).
- `components/animeDetail/__tests__/useAnimeReviews.test.jsx` (stats invalidated after create/delete).
- `components/__tests__/DraggableFavoritesGrid.test.jsx` (keyboard move, full id list saved, revert + message on failure).
- `hooks/__tests__/useFriendsWatching.test.jsx` (single request across two mounts, invalidated by follow).
- `components/__tests__/FollowersModal.test.jsx` (focus trap + return, server search param).

**Manual QA (phone 375×812 and desktop 1440):**
1. Forums index → thread → reply → nested reply 10 deep → "Continue this thread" → reply at depth 10 is refused with the message.
2. Second browser tab sees the new reply live; like counts update live.
3. Staff: lock, remove a reply (placeholder shows to others), restore; check the audit row in admin.
4. Subscribe/unsubscribe a thread; reply from another account; the bell notification arrives once.
5. Edit a post → "edited" shows; keyboard-only: Tab to edit/delete/like on a post, labels announced (VoiceOver/NVDA spot check).
6. Write a review with `>!spoiler!<`, vote from another account (instant update), react, report; check the stats card updates after writing.
7. Profile → Favorites → Reorder with buttons on phone, then reload; order persists across pages.
8. Follow/unfollow quickly 5×: counts correct, one follower notification; Friends watching appears on the anime page for a mutual.
9. Settings → Badges: feature 3, try a 4th (disabled), check the profile header.
10. Reduced motion on: spoiler/reorder transitions don't animate.

**Gates:** `ruff check`, `ruff format --check`, `makemigrations --check --dry-run`, `pytest -n auto --cov` (incl. `test_query_budgets.py`,
`test_public_contract.py`, `test_query_sql_snapshot.py`, `beat_schedule_and_jazzmin.json` unchanged: no beat entries added), `npm run lint`,
`npm run test:run`, `npm run build`.

## Migration plan
1. **forums `0009_community_moderation_subscriptions.py`** (schema, reversible): `Thread.edited_at` (DateTime null), `Thread.is_removed`
   (bool default False, db_index), `Thread.removed_by` (FK user SET_NULL null), `Thread.removed_at`, `Thread.removal_reason` (Char 200 blank);
   same five on `Post` (`edited_at`, `is_removed`, `removed_by`, `removed_at`, `removal_reason`); `CreateModel ThreadSubscription(user FK CASCADE,
   thread FK CASCADE, created_at)` + `UniqueConstraint(user, thread)` + `Index(thread)`. Existing thread indexes stay as they are; add a
   removed-aware index only if EXPLAIN on seeded data shows the `is_removed=False` filter defeating them (default: no index change).
2. **forums `0010_community_reparent_deep_posts.py`** (data, batched 500, reversible as no-op): for posts whose ancestor chain is longer than 10,
   set `parent` to the ancestor at depth 9 and `depth=10` (iterative from depth-10 posts with depth-10 parents). Backfill `ThreadSubscription` for
   each thread's author (`bulk_create(ignore_conflicts=True)`, batched). Reverse: delete backfilled subscriptions only (re-parenting isn't undone, which is safe).
3. **anime `00NN_community_review_index_cleanup.py`** (NN = next after slim-down's leaf, currently 0057; reversible `RemoveIndex`):
   remove `anime_revie_user_review_idx` (ReviewVote), `anime_revie_user_id_60a9d1_idx` (ReviewReaction), and Review `Index(anime, user)`.
   Pure index drops, no data.
4. **users `00NN_community_follow_no_self.py`** (after 0037 / the current leaf): RunPython deleting self-follow rows (batched; reverse no-op), then
   `AddConstraint CheckConstraint(~Q(follower=F("following")), name="users_userfollow_no_self")` and `RemoveIndex` of the redundant
   `(follower, following)` index. Reversible (constraint/index ops reverse).

Rollout: nothing is deployed yet, so migrations run at first deploy. 0010 touches only deep-chain posts (expected zero or a handful). If a
later-merged group already took a number, renumber and re-point `dependencies` per the brief; no merge migrations.

## Risks and open questions
- **Markdown rework (P1-6) is the largest risk.** Remark plugins must reproduce the custom image/youtube/spoiler syntax exactly for existing
  posts; ship behind `mode` with the legacy path untouched, and port the XSS corpus first. If it slips, fallback: keep the legacy pipeline,
  sanitize *after* markdown→HTML by rendering with `rehype-sanitize`. That needs a new package (FROZEN `package.json`), so it'd be a request.
- **Bleach on forum content** (`serializers.py:29-30`) escapes `<`/`>`/`&` at write time; the legacy renderer decodes them back
  (`MarkdownRenderer.jsx:376-384`). In `mode="markdown"` content still needs decoding exactly once. Decide whether to stop entity-encoding
  on write (store text as typed, like reviews since `0051_unescape_review_text`), which needs a forums data migration (would be the second
  forums migration, merged into 0010). Recommendation: yes, mirror the review fix; verify with a test on legacy rows.
- Reviews by private users on public anime pages: keep visible (public contributions) or hide? Recommendation: keep visible, hide only on
  `?user=` listing; confirm with the owner.
- Auto-subscribing repliers may feel noisy; alternative: author only + explicit bell. Recommendation: author + repliers, with a one-click
  unsubscribe in the notification (G4 renders the link from `data.thread_id`).
- Soft-deleting an author's post that has replies keeps "[deleted]" placeholders forever; acceptable (Reddit-style) but confirm.
- Throttle reuse: `strict_user` 10/min for follows may be too tight for "follow back" sprees in FollowersModal; alternative
  `user_actions` 120/min + G4 dedupe. Decide during implementation with the council.
- The 3161be3 favorites move bypasses signals, so `UserStats.favorites_count` (G3) may lag until the next stats refresh (unverified whether it
  counts character/staff favorites). Low impact; P2-5 gives visibility.
- Ownership-matrix gaps: `apps/users/urlconf/social.py` and `apps/users/services/{badge_service,points_service}.py` aren't named in the matrix
  (claimed here as follows/badges domain); "follow-count receivers in `apps/users/signals.py`" don't exist; `MarkdownRenderer` is G5-owned
  but renders G1 data, hence the legacy-mode freeze.
