# Feature revamp 1: Accounts & auth
> Base: backend fix/anilist-only-and-fixes@17f082a, frontend feat/visual-ux-overhaul@ab5b3c2. Planning only.

Path shorthands: `S/` = SLIM backend snapshot, `F/` = `WT/frontend/src/`. Line numbers are from those trees.

## Summary
The auth core is in better shape than the old AUDIT suggested. The refresh cookie is httpOnly with the CSRF header and Origin checks, rotation and the blacklist work (with a row lock against races), JWT claims are minimal, WS tickets are single-use, and the verify-email single-use fix landed (PR #7, merge `017b6c5` on `main`, also in SLIM). What is left is a set of concrete bugs that people hit every day, plus a few security gaps:
- Registration 500s when `email` is missing.
- "Resend verification" on the pending page always fails.
- Every Settings save re-sends social links, which burns the 5/day social-links throttle and re-runs WHOIS/DNS checks.
- The query cache leaks the previous account's data after logout on a shared device.
- Google login leaves a Django session behind that outlives logout.
- Passwordless (Google) accounts can set a password, change email or delete the account with only an access token.
- Deleted accounts leave their images in S3.

This group fixes those (P0), then makes auth and settings pleasant on phones and keyboards: labelled forms with autocomplete, linkable settings tabs, a pending-email state, "sign out other devices", contrast-safe profile colours and image normalisation (P1). It adds no services. It proposes two `users` migrations and one new Celery task, but no new beat entry.

## Current state

### Models (`S/apps/users/models.py`)
| Model | Fields relevant to G1 | Notes |
|---|---|---|
| `CustomUser` (35-45) | AbstractUser + `UniqueConstraint(Lower("email"), condition=~Q(email=""))` (migration 0037) | `username` has a unique index but is case-sensitive; there is no CI constraint |
| `UserProfile` (48-74) | avatar, banner (`MediaStorage`), bio, last_username_change, is_private, show_adult_content, email_verified, social_links (JSON), profile_primary_color, preferred_timezone, last_activity | `points` is G5's; `email_new_episodes`/`push_*` are G4 legacy (do not touch) |
| `SocialLinkChangeLog` (247-269) | action, old/new JSON, ip_address | audit only |
| simplejwt `OutstandingToken`/`BlacklistedToken` | used for rotation and revocation | never flushed (see A20) |

### Endpoints (all under `/api/v1/`; `S/apps/users/urls.py` → post-seams `apps/users/urlconf/accounts.py`)
| Method + path | View | Auth / throttle |
|---|---|---|
| POST `auth/login/` | `CustomTokenObtainPairView` views/auth.py:76-87 | none / `login` 5/min per IP |
| POST `auth/refresh/` | `LoggingTokenRefreshView` auth.py:288-323 | cookie + `X-Requested-With` + Origin (auth_cookies.py:71-78) |
| POST `auth/refresh/logout/` | `LogoutView` auth.py:326-347 | cookie + CSRF header |
| POST `auth/ws-ticket/` | `WebSocketTicketView` auth.py:350-356 | JWT; 30 s single-use ticket (ws_ticket_service.py) |
| POST `auth/register/` | `RegisterView` auth.py:90-132 | none / `register` 3/h |
| POST `auth/google/` | `GoogleLogin` views/google.py:14-96 | none; refresh moved to cookie at google.py:93-96 |
| POST `verify-email/<uid>/<token>/` | `AuthViewSet.verify_email` auth.py:156-175 | `strict_user` 10/min; logs the user in on first use |
| POST `auth/resend-verification/`, `auth/password-reset/` | `AuthViewSet` auth.py:177-203 | **shared** `password_reset` 3/h bucket (auth.py:149-151) |
| POST `auth/password-reset-confirm/` | auth.py:205-221 | `strict_user`; revokes all sessions (auth_flow_service.py:120-123) |
| POST `auth/change-password/` | `AccountManagementViewSet` account_management.py:42-54 | JWT; revokes all, re-issues for this device |
| POST `auth/change-email/`, `auth/confirm-email-change/` | account_management.py:71-98 | `strict_user` 10/min |
| DELETE `auth/delete-account/` | account_management.py:56-69 | `strict_user` |
| GET/PATCH `users/me/` | `UserProfileView` views/users.py:31-110 | PATCH adds `SocialLinksRateThrottle` when `social_links` is in the body (users.py:42-46) |
| GET `users/<username>/` | `PublicUserProfileViewSet.retrieve` users.py:123-163 | `user_profile_lookup` 90/min anon |
| GET `/u/<username>[/<section>]` (root, not API) | `ProfileSharePreviewView` share_preview.py | Caddy sends crawler UAs here only (Caddyfile.prod:212-218) |

Throttle rates are in `S/root/settings/base.py:526-541`. JWT settings (base.py:550-560): 15 min access, 30 d refresh, rotate + blacklist, `UPDATE_LAST_LOGIN` unset (False). `DEFAULT_AUTHENTICATION_CLASSES` still includes `SessionAuthentication` (base.py:511).

### Celery
- `apps.users.tasks.cleanup_unverified_accounts` (tasks.py:76-79). Its implementation, `UserTaskService.cleanup_unverified_accounts` in `services/celery_tasks.py:26-66`, is **G1's** (overview amendment 3: the file has function-level ownership; G1 owns this method and `warm_profile_cache`, G3 the rest) and it runs through `run_user_maintenance_workflow` (beat `user-maintenance-daily`, celery_schedule.py:89-98).
- `apps.users.tasks.warm_profile_cache` (tasks.py:183-186). Its implementation is at celery_tasks.py:431-474; beat `warm-profile-cache-hourly` (celery_schedule.py:106-110).
- `apps.core.tasks.metadata.fetch_multiple_link_metadata` / `fetch_link_metadata_async` → G6's `CoreTaskService` (core/services/celery_tasks.py:139-218).
- `send_email_task` (services/email_service.py:80-190) sends via the Resend HTTP API.

### Frontend (`F/`)
- Pages: `Auth.jsx` (Login/Register), `VerifyEmail`, `VerificationPending`, `ConfirmEmailChange`, `PasswordReset`, `PasswordResetConfirm`, `GoogleCallback`, `Settings` (tabs: profile/badges/account/notifications in local state, Settings.jsx:19), `Profile` (546 lines; tab routing from the path), `Terms`, `Privacy`.
- Session: `api/httpClient.js` keeps the access token in memory, uses a `localStorage` hint `auth_session`, a cross-tab Web Lock around refresh (158-161), a 401→refresh retry (221-244), and a toast for `email_verification_required` (246-253). `context/AuthContext.jsx` exposes `{user, loading, login, register, logout, startSession, refreshProfile, isAuthenticated}`.
- Query keys (`api/queries/user.js` → post-seams `api/queries/profile.js`): `profileKeys.own = ['ownProfile']` (26), `profileKeys.byUsername`, `miniProfileKeys`.
- Tests that exist today: `pages/__tests__/{Auth,VerifyEmail,ConfirmEmailChange}.test.jsx`, `components/navbar/__tests__/UserMenu.test.jsx`, `components/settings/__tests__/SettingsTabs.test.jsx`, `api/__tests__/httpClient.test.js`.

### Backend tests (`S/apps/users/tests/`)
`test_auth.py` (registration, login, verify, social serializer, change password, reset), `test_auth_cookies.py` (cookie flow, CSRF header, rotation, WS ticket), `test_email_verification_flow.py`, `test_email_verification_gating.py`, `test_account_management.py`, `test_email_uniqueness.py`, `test_profile_features.py` (query-count tests at 127, 244, 311), `test_profile_share_preview.py`, `test_profile_update_service.py`, `test_oauth_avatar.py`, `test_social_signals.py`, `test_concurrency.py` (refresh race).

### Verified OK (no action)
- Refresh/logout CSRF: header and Origin check (auth_cookies.py:71-78), tests at test_auth_cookies.py:88-98,139.
- Rotation and blacklisting with `select_for_update` (auth.py:240-249), plus a race test (test_concurrency.py:47).
- No email or role claims in the JWT (auth.py:53-60; test_auth_cookies.py:63).
- Verify-email tokens are single-use: the hash covers `email_verified` (tokens.py:21-36), and a replay mints no session (auth_flow_service.py:55-60).
- Email-change tokens are bound to the old and new address (tokens.py:48-58).
- The 14-day username cooldown and the admin switch are enforced (profile_update_service.py:105-122).
- Share-preview attributes are `html.escape(quote=True)`'d (share_preview.py:195-202).
- Metadata fetch is HTTPS-only, re-validates every redirect hop, and caps the body (metadata_service.py:92-125).
- Jikan, MongoDB, Typesense and theme-sync are absent from every G1 file in both trees. The only "MyAnimeList" hits are G3's import labels (models.py:158-159, AccountTab.jsx:220).

## Problems found
| ID | Sev | Area | Problem | Evidence path:line | Fix ref |
|---|---|---|---|---|---|
| A01 | High | Register | `RegisterSerializer` is a ModelSerializer over `AbstractUser.email` (`blank=True`), so `email` is optional. A missing email → `KeyError` → 500 at `validated_data["email"]`. `email: ""` creates an account that can never verify. | S/apps/users/serializers/users.py:400-416; S/apps/users/views/auth.py:103-108 | P0-1 |
| A02 | High | Verify UX | The pending page calls `resendVerification({email})`, but the API wraps it again as `{email: {email}}`. The backend then calls `.strip()` on a dict → 500, shown as "Something went wrong". Register passes the email in `state`, while the page reads `?email=`, so the field is never prefilled. | F/pages/VerificationPending.jsx:8,21; F/api/modules/auth.js:26; S/apps/users/services/auth_flow_service.py:66-71; F/pages/Auth.jsx:221-226 | P0-2 |
| A03 | High | Settings | The links state is normalised to `{platform,value}` but compared with the stored `{platform,url,normalized_url,...}`. They always differ, so every save sends `social_links`. That (a) consumes `SocialLinksRateThrottle` (5/day), (b) re-runs DNS/WHOIS/Safe Browsing, and (c) means "No changes to save" never shows. | F/components/settings/useProfileSettings.js:95-98,155,182-185; S/apps/users/views/users.py:42-46; S/apps/users/throttling.py:87-120; S/root/settings/base.py:538; S/apps/core/services/social_links_service.py:94-107 | P0-3 |
| A04 | High | Privacy | The query cache is never cleared on logout, session expiry or a user switch. `['ownProfile']`, `['user','list','watching']`, recommendations and per-slug `user_status` are not keyed by user, so the next account on the same tab sees the previous one's data for up to `staleTime` (5 min). | F/context/AuthContext.jsx:143-153; F/api/queries/user.js:26,38,102-104; F/api/queries/notifications.js:8; F/app/providers.jsx:13-22 | P0-4 |
| A05 | Med | Session | Google login performs a Django session login: `SocialLoginView.process_login` calls `adapter.login`, bypassing `REST_AUTH.SESSION_LOGIN=False`, and allauth's `complete_social_login` logs in too. `LogoutView` never flushes the session, DRF still has `SessionAuthentication`, and axios sends cookies on every call. So after "logout" GET API calls are still authenticated as the user, and anonymous POSTs get a CSRF 403 instead of 401. (Verify with the test in P0-5.) | S/apps/users/views/social_auth.py:12-13; S/apps/users/serializers/social_auth.py:133; S/root/settings/base.py:224,511; S/apps/users/views/auth.py:336-347; F/api/httpClient.js:29 | P0-5 |
| A06 | Med | Account takeover | For accounts with no usable password, a bare access token is enough to set a password (no old password), change the email (password skipped) or delete the account. No notice goes to the old address. An XSS-stolen 15-min token becomes permanent takeover. | S/apps/users/serializers/users.py:609-627; S/apps/users/services/account_management_service.py:34-45,56-67; S/apps/users/services/email_service.py:40-63 | P0-6 |
| A07 | Med | OAuth | The social serializer accepts a raw `access_token`/`id_token` from the client, which allows token substitution: a Google token minted for another app is accepted with no audience check. The SPA only uses the code flow. | S/apps/users/serializers/social_auth.py:77-82,127-130; F/components/GoogleLoginButton.jsx:16 | P0-7 |
| A08 | Med | Login CSRF | `/auth/login/`, `/auth/google/` and `/verify-email/` accept form-encoded simple POSTs and set the refresh cookie without the `X-Requested-With` check that refresh/logout enforce. A cross-site form can log a victim into an attacker's account. | S/apps/users/views/auth.py:76-87,156-175; S/apps/users/views/google.py:18,76-96; S/apps/users/auth_cookies.py:71-78 | P0-8 |
| A09 | Med | Throttles | Login is limited per IP only (5/min); nothing limits attempts per account, so distributed guessing is unbounded. Resend-verification and password-reset share one 3/h bucket. Change-email allows 10/min to arbitrary addresses (mail-relay abuse; for Google accounts no password is needed). | S/apps/users/throttling.py:33-57,78-84; S/apps/users/views/auth.py:149-151; S/apps/users/views/account_management.py:37-40 | P1-1 |
| A10 | Med | Data integrity | No `post_delete` for `UserProfile`, so account deletion and the 7-day unverified purge leave avatars and banners in S3. Replacing an avatar or "remove banner" only rewrites the field. Old files stay forever. | S/apps/users/signals.py (no receiver); S/apps/users/services/profile_update_service.py:29-38; S/apps/users/services/account_management_service.py:47-48; S/apps/users/services/celery_tasks.py:52-53 | P0-9 |
| A11 | Med | XSS-adjacent | The bio sanitizer allows `class` on every tag (`"*": ["class","align"]`), and `MarkdownRenderer` spreads `{...props}` after its own `className`. Users can apply any Tailwind class (`fixed inset-0 z-50 …`) and overlay or spoof the UI on their profile. | S/apps/users/serializers/users.py:80-86,342-352; F/components/common/MarkdownRenderer.jsx:241,248 | P1-6 |
| A12 | Med | Uploads | Avatars and banners are stored byte-for-byte after magic and Pillow `verify()`. EXIF/GPS from direct API uploads is kept, nothing is re-encoded, and there is no dimension cap below Pillow's bomb limit. The OAuth avatar is saved as `.jpg` without that validation, inside the login request (10 s timeout). | S/apps/animes/serializers/base.py:21-66; S/apps/users/adapters.py:81-103 | P1-5 |
| A13 | Med | Usernames | There is no case-insensitive uniqueness. OAuth `populate_user` checks exact case and bypasses `validate_username` (reserved names, admin length limits). The public API looks up the exact name while the share preview uses `iexact().first()`, so `/u/bob` 404s for "Bob". | S/apps/users/models.py:35-45; S/apps/users/adapters.py:63-79; S/apps/users/services/public_profile_service.py:59,124-126; S/apps/users/share_preview.py:34-38 | P1-2 |
| A14 | Med | Token leakage | Reset, verify and email-change tokens (and the base64 new email) are in URL paths. They are sent to Umami on pageview and land in the Caddy access log and browser history. | F/app/routes.jsx:114-120; S/apps/users/services/email_service.py:20,32,46-48; F/components/UmamiAnalytics.jsx:48; S/Caddyfile.prod:234-236 | P1-3, P1-4 |
| A15 | Med | A11y | A viewed profile's colour overwrites the global `--color-accent*` tokens. Toning only caps lightness from above, so a dark choice (#111) makes links, focus rings and buttons fail AA site-wide while on that profile. | F/pages/Profile.jsx:252-280; F/utils/profileAccent.js:89-100 | P1-7 |
| A16 | Med | Perf | Social-link validation runs WHOIS (`whois.whois`, no timeout), DNS and Safe Browsing synchronously inside `PATCH /users/me/`, blocking a web worker. | S/apps/core/services/url_validator.py:208-233,408-437; S/apps/users/services/profile_update_service.py:95-97 | P1-8 |
| A17 | Low | Share preview | The inline `<script>window.location.replace()</script>` is blocked by its own `PAGE_CSP` (`script-src 'self'`), so every human hit logs a CSP violation. The meta refresh already redirects. `json.dumps` inside `<script>` does not escape `<`. | S/apps/users/share_preview.py:201-207; S/apps/users/middleware/csp_middleware.py:29-41 | P1-15 |
| A18 | Low | Enumeration | Change-email says "This email is already in use", and registration's generic "may already be in use" still distinguishes taken emails. Login, reset and resend are generic (OK). | S/apps/users/services/account_management_service.py:84-88; S/apps/users/views/auth.py:103-114 | P1-1 (accepted risk, documented) |
| A19 | Low | Email/PII | The reset email body is just "Click to reset: {link}" (no expiry, no "ignore if not you"). Recipient addresses are logged at INFO on every send. | S/apps/users/services/email_service.py:36,104-109,147-151 | P1-13 |
| A20 | Low | Ops | Expired `OutstandingToken`/`BlacklistedToken` rows are never flushed (about one row per ~10 min of activity per tab). `revoke_all_sessions` scans them all. | S/root/settings/base.py:550-560; S/root/settings/celery_schedule.py (no entry); S/apps/users/services/auth_service.py:25-33 | P1-11 |
| A21 | Low | Cache | `warm_profile_cache` runs hourly with a 3-way `Count(distinct)` join over all users. It writes a different payload (PublicUserSerializer, no `total_badges_count`) with TTL 1800 s, while the live path uses 300 s. Cost is high and value low. | S/apps/users/services/celery_tasks.py:431-474; S/apps/users/services/public_profile_service.py:81-115; S/root/settings/celery_schedule.py:106-110 | P1-12 |
| A22 | Low | Dead code | `hooks/useLinkValidation.js` (342 lines, 0 importers); `SocialLinksService.validate_single_url` (no caller); `AuthService.validate_registration_credentials`; profile_service `ImportError` fallback and a no-op `is_full`; the `password_confirm` sent on register; the hard-coded `kiyo` route; the `accounts/` allauth HTML routes (not routed by Caddy). | F/hooks/useLinkValidation.js:64; S/apps/core/services/social_links_service.py:228-277; S/apps/users/services/auth_service.py:73-78; S/apps/users/services/profile_service.py:14-19,66-84; F/context/AuthContext.jsx:137; F/app/routes.jsx:108; S/root/urls.py:25 | P1-14 |
| A23 | Low | Observability | Sentry's user is set to the *viewed* profile and never cleared on logout. | F/pages/Profile.jsx:245-250; F/sentry.js:125-145 | P0-4 |
| A24 | Low | A11y/phone | Auth labels have no `htmlFor`/`id` and inputs have no `autocomplete`/`autoCapitalize` (phones capitalise usernames; password managers misfire). Errors lack `role="alert"`. Settings tabs are plain buttons (no tablist, not linkable). The privacy switch has no name or state. The crop modal has no dialog semantics (`aria-labelledby="Zoom"` points to no id). | F/pages/Auth.jsx:104-135,274-344; F/components/settings/SettingsTabs.jsx:5-43; F/components/settings/AccountTab.jsx:195-202; F/components/ImageCropModal.jsx:91,149 | P1-9, P1-10 |
| A25 | Low | Flow UX | Login ignores `location.state.message`, so "Password reset successfully" is lost, and it always lands on `/browse` (no return-to). Google callback likewise, with a 3 s auto-redirect and no button. Register shows "deleted after 7 days" even when verification is optional. | F/pages/Auth.jsx:22-27,44-46,221-226; F/pages/PasswordResetConfirm.jsx:33-35; F/pages/GoogleCallback.jsx:24,32,50-53; S/apps/users/services/auth_flow_service.py:133-137 | P1-9 |
| A26 | Low | Errors | The profile-save error parser renders "detail: …" because it ignores the `{detail,code,errors}` envelope. Change-password drops the fresh `access` it gets back. | F/components/settings/useProfileSettings.js:229-245; F/components/settings/useAccountSettings.js:46-49; S/apps/users/views/account_management.py:47-54 | P1-10 |
| A27 | Low | Requests | A public-profile 404 (private or missing) is retried twice. The hover card fires 3 queries per hover, and 2 are useless for private users. | F/pages/Profile.jsx:162-170; F/components/common/MiniProfileHoverCard.jsx:110-160 | P1-16 |
| A28 | Low | Delete cascade | Deleting an account cascades forum threads (including other users' replies) and reviews. | S/apps/forums/models.py:60,100; S/apps/animes/models/reviews.py:20 | Contract → G5 |
| A29 | Low | is_private | `?user=<name>` on reviews and `author__username` on forum threads ignore `is_private`. Lists, activity and favorites check it. | S/apps/animes/services/reviews.py:101-103; S/apps/forums/views.py:142; vs S/apps/users/services/list_service.py:25-30 | Contract → G5 |
| A30 | Low | Gaps | No "remove avatar". No share-profile action. The adult toggle exists only in Browse/Schedule (duplicated logic), not in Settings. | F/components/settings/ProfileTab.jsx:88-116; F/pages/Browse.jsx:133-152; F/pages/Schedule.jsx:177-183 | P1-10, P2-2 |
| A31 | Low | OAuth UX | Google sign-in for an email that already has a password account dead-ends with "User is already registered with this e-mail address." and no guidance. | S/apps/users/services/auth_service.py:102-107 | P2-4 |
| A32 | Low | Sessions | Confirming an email change does not revoke other sessions. After a password change other devices keep their access tokens for up to 15 min (acceptable; document it). | S/apps/users/services/account_management_service.py:126-140 | P0-6 |
| A33 | Low | Tokens | `UPDATE_LAST_LOGIN` is off, so `last_login` (part of the reset-token hash) never changes on JWT login. An unused reset link stays valid for the full `PASSWORD_RESET_TIMEOUT` (3 d default) even after a normal sign-in. | S/root/settings/base.py:550-560; Django `PasswordResetTokenGenerator._make_hash_value` | Integrator request |
| A34 | Low | Cache | After link metadata is stored, the own-profile cache (`user_profile:<id>:*`, 300 s) is not invalidated. Only the public version is bumped (via the post_save signal), so Settings shows `metadata_pending` for up to 5 min. | S/apps/core/services/celery_tasks.py:166-169; S/apps/users/signals.py:118-123 | P1-8 |
| A35 | High | Login | **Smoke-test finding S-3.** `POST auth/login/` with no `username` and no `email` returns **500**: `CustomTokenObtainPairSerializer.validate` passes `attrs` to simplejwt's `validate`, which reads `attrs["username"]` (`KeyError`). With an email that has no account, `normalize_login_identifier(email=…)` returns `None`, so `username` is never set: also 500, while an unknown *username* gives 401. The 500-vs-401 difference reveals whether an email is registered. Measured on `revamp/base`: `{password}` → 500, `{email: unknown, password}` → 500, `{username: unknown, password}` → 401. | `apps/users/views/auth.py:62-73`; `apps/users/services/auth_service.py:40-60` | P0-10 |

Missing tests (today): registration without email; resend with a non-string body; session cookie after Google login; access-token social path rejected; media deletion on account delete; share preview with hostile bio or username; username case collisions; Settings change detection for links; AuthContext cache clearing; VerificationPending; PasswordResetConfirm; GoogleCallback; profileAccent contrast.

## Proposed scope

### P0 (bugs / security / data integrity)
1. **Registration requires email** (A01). Declare `email = EmailField(required=True, allow_blank=False)` on `RegisterSerializer` (keep the lowercase/strip). The view reads with `.get`. Files: `serializers/accounts.py`, `views/auth.py`. Size S.
2. **Fix resend verification** (A02). FE: `authApi.resendVerification(resendEmail)`; prefill from `location.state.email ?? ?email`; show `state.message`. BE: `resend_verification_flow`/`password_reset_flow` return 400 unless `email` is a non-empty `str`. Files: `pages/VerificationPending.jsx`, `services/auth_flow_service.py`. Size S.
3. **Stop phantom social-link updates** (A03).
   - FE: compare `(platform, value||url)` pairs and send `social_links` only when they differ.
   - BE: in `UserProfileView.patch`, normalise the incoming links and compare them with `_hash_links(profile.social_links)` before validating. If they are equal, drop the key: no network validation, no throttle. Apply `SocialLinksRateThrottle` only when the links really change (move it from `get_throttles` into `patch` via `self.check_throttles`-style manual `allow_request`).
   - Files: `useProfileSettings.js`, `views/users.py`, `services/profile_update_service.py`. Size S-M.
4. **Clear per-user client state on identity change** (A04, A23).
   - In `AuthProvider`, `useQueryClient()`. On `logout`, on `AUTH_EXPIRED_EVENT`, on the cross-tab `storage` sign-out, and in `startSession` when the new user id differs from the last one: call `queryClient.clear()`, then `clearUserContext()`.
   - Call `setUserContext(user)` from AuthContext and remove the call in `Profile.jsx`.
   - Files: `context/AuthContext.jsx`, `pages/Profile.jsx`. Size S.
5. **No Django session from social login** (A05).
   - Override `SocialLoginView.process_login` as a no-op.
   - In `GoogleLogin.post`, after a successful `super().post()`, call `request._request.session.flush()`. That removes allauth's session login; keep it on our side even after the integrator change below.
   - `LogoutView` also flushes the session.
   - Integrator: drop `SessionAuthentication` from DRF defaults.
   - Files: `views/social_auth.py`, `views/google.py`, `views/auth.py`. Size S.
6. **Re-auth and notice for sensitive account changes** (A06, A32).
   - Add an `auth_time` claim (epoch seconds) in `CustomTokenObtainPairSerializer.get_token`. That covers password and Google logins, since `REST_AUTH.JWT_TOKEN_CLAIMS_SERIALIZER` points at it. Also add it in `build_auth_response` (verify-email) and in change-password's re-issued token, where it is copied from `request.auth`. Rotation copies custom claims, so it survives refreshes.
   - New helper `services/auth_service.py::require_recent_auth(request, max_age=600)`. When the user has no usable password, set-password, change-email and delete-account return 403 `{code:"reauth_required"}` unless `auth_time` is recent.
   - FE: on that code, show "Confirm it's you" and run the Google flow again (`prompt=select_account`, `state` carries `return_to=/settings?tab=account`).
   - Send a security notice to the *old* address on email change (request and confirm) and on password change or reset.
   - Revoke other sessions on a confirmed email change.
   - Files: `views/auth.py`, `views/account_management.py`, `services/{account_management_service,auth_flow_service,auth_service,email_service}.py`, `serializers/accounts.py`, `components/settings/{AccountTab.jsx,useAccountSettings.js}`, `components/GoogleLoginButton.jsx`, `pages/GoogleCallback.jsx`. Size M.
7. **Code flow only for Google** (A07). `SocialLoginSerializer.validate` rejects requests without `code` (400 `code_required`) and removes the access_token/id_token branch and its test helpers. Files: `serializers/social_auth.py`, `tests/test_auth.py`. Size S.
8. **Login-CSRF guard** (A08). Apply `cookie_csrf_failure` (header + Origin) to login, Google login and verify-email before they set the cookie. The SPA already sends the header on every request (httpClient.js:21-28). Files: `views/auth.py`, `views/google.py`. Size S.
9. **Media cleanup** (A10).
   - Add a `post_delete` receiver on `UserProfile` that deletes `avatar.name` and `banner.name` from their storage in `transaction.on_commit`.
   - In `update_user_profile`, remember the old names and delete them on commit when they are replaced or removed.
   - Storage errors are logged, never raised.
   - Covers account delete, the unverified purge and admin deletes.
   - Files: `signals.py` (profile receivers), `services/profile_update_service.py`. Size S-M.
10. **Login never 500s and does not leak which emails exist** (A35, smoke finding S-3).
    - In `CustomTokenObtainPairSerializer.validate`: if neither `username` nor `email` is a non-empty string, raise `ValidationError({"username": "Enter a username or email."})` (400, the `{detail, code, errors}` envelope).
    - An email with no account must fail exactly like a wrong password: set `attrs["username"]` to the stripped email (or another value that cannot authenticate), so simplejwt returns its usual 401 `no_active_account`. No `KeyError` path remains.
    - Treat non-string `username`/`email`/`password` (numbers, objects) as missing → 400, not 500.
    - Unify the response time of the two 401 paths where it is cheap (they already both run one user lookup plus a password hash check through `authenticate`; verify that simplejwt's dummy hashing covers the unknown-user path).
    - Tests (in `test_accounts_registration.py` or a new `test_accounts_login.py`): `{password}` → 400 with `errors.username`; `{email: unknown}` → 401 with the same body as `{username: known, password: wrong}`; `{username: 5}` → 400; a login with the email of an existing account still works.
    - Files: `views/auth.py`. Size S.

### P1 (daily-use UX, hardening, tests)
1. **Throttles** (A09, A18). These are all class-level defaults inside throttling.py; DRF reads a class `rate` and falls back to settings when the scope is defined, and `test.py` stays effective because scope rates override.
   - `LoginIdentifierThrottle`: a cache counter keyed by the normalised identifier (sha256). After 10 failures in 15 min, return 429 with Retry-After. Count failures only; clear on success.
   - Separate `resend_verification` scope.
   - `ChangeEmailRateThrottle` at 5/hour per user.
   - Keep the generic register message and document the residual enumeration as accepted.
   - Files: `throttling.py`, `views/auth.py`, `views/account_management.py`. Size S-M.
2. **Usernames** (A13).
   - Migration 0038: a CI-unique constraint, refusing to migrate with instructions when duplicates exist (same pattern as 0037).
   - `MySocialAccountAdapter.populate_user` runs the candidate through `validate_username` (falling back to `user<id-ish>`) and loops `iexact` for the suffix.
   - Public profile and share preview look up `username__iexact`. The API returns the canonical `username`; `Profile.jsx` replaces the URL when the case differs.
   - Cache keys use `username.lower()`.
   - Files: `models.py`, `adapters.py`, `services/{public_profile_service,cache,username_sanitizer}.py`, `share_preview.py`, `pages/Profile.jsx`. Size M.
3. **Pending email change** (A14). Migration 0039 adds `UserProfile.pending_email` and `pending_email_requested_at`.
   - `request_email_change` stores the pending address. `EmailChangeTokenGenerator` hashes `pending_email`. The link becomes `/confirm-email-change/<uid>/<token>` and the body is `{uid, token}`.
   - `/users/me/` adds `pending_email`.
   - AccountTab shows "Waiting for confirmation at x@y" with Resend and Cancel. `POST auth/cancel-email-change/` clears the pending email.
   - Files: `models.py`, `tokens.py`, `services/{account_management_service,email_service,profile_service}.py`, `views/account_management.py`, `urlconf/accounts.py`, `pages/ConfirmEmailChange.jsx`, `components/settings/{AccountTab.jsx,useAccountSettings.js}`, `api/modules/auth.js`. Size M.
4. **Tokens out of the address bar** (A14). VerifyEmail, PasswordResetConfirm and ConfirmEmailChange read params, keep them in a ref, then `navigate('<param-less path>', {replace:true})` before rendering (no Umami pageview carries the token). This needs the param-less routes (integrator). Size S.
5. **Image normalisation** (A12). New `apps/users/utils/image_processing.py::normalize_profile_image(file, kind)`.
   - Validate (own copy of the magic + Pillow checks), `ImageOps.exif_transpose`, strip metadata, downscale (avatar 512², banner 2560 px wide), re-encode as WebP q≈85.
   - GIF: keep it if frames ≤ 120 and size ≤ the limit; otherwise reject with a clear message.
   - Use it for uploads and for the OAuth avatar. Move the OAuth avatar download to `transaction.on_commit` + the existing `send`-style Celery queue? No: keep it synchronous but with a 3 s timeout, since this adds no task (open question Q3).
   - Files: `utils/image_processing.py` (new), `serializers/accounts.py`, `adapters.py`. Size M.
6. **Bio class allowlist** (A11). Replace `"*": ["class","align"]` with an attribute callable that allows `class` only from a fixed set: what `RichTextEditor` emits (to be enumerated by the implementer from G5's editor output; unverified) plus `align`/`data-align`. Add a data migration? No: sanitise on read in `normalize_bio` is frozen (shared/text.py), so instead run a one-off management command `resanitize_bios` (G1-owned, new) that re-cleans stored bios in batches. Files: `serializers/accounts.py`, `apps/users/management/commands/resanitize_bios.py` (new). Size S.
7. **Contrast-safe profile accent** (A15). In `toneProfileAccentColor`, raise lightness until the WCAG contrast against `--color-dark` (#0a0a0a, read from tokens) is ≥ 4.5:1, keeping the hue. The settings colour picker previews the toned value and says "adjusted for readability". Files: `utils/profileAccent.js`, `components/settings/ProfileTab.jsx`. Size S.
8. **Link validation off the hot path** (A16, A34). Sync checks stay as they are: scheme, IP, shortener, subdomains, homograph, DNS with `socket.setdefaulttimeout`-free `getaddrinfo` is OK. WHOIS domain-age and Safe Browsing move to `fetch_multiple_link_metadata`. Links failing the async check are marked `trust_level="suspicious"` (rendered with the existing warning style) rather than rejected after save. Wrap the WHOIS call in a 3 s timeout. Invalidate own-profile caches after metadata is stored (request to G6, or move `_store_link_metadata` into `metadata_service.py`; see contracts). Files: `apps/core/services/{url_validator,social_links_service,metadata_service}.py`, `apps/core/tasks/metadata.py`. Size M.
9. **Auth pages on phones and keyboards** (A24, A25).
   - `id`/`htmlFor` on every field.
   - `autoComplete` (`username`, `email`, `current-password`, `new-password`), `autoCapitalize="none"`, `spellCheck={false}`, `inputMode="email"`.
   - A show/hide password toggle (button, `aria-pressed`).
   - Errors in `role="alert"`; card `p-6 sm:p-8`.
   - Login honours `state.message` and `state.from`/`?next=` (same-origin path only).
   - Register logs in directly when verification is optional (the response message tells which).
   - GoogleCallback: within the Layout container, with an explicit "Back to sign in" button instead of the 3 s timer, and an honest message for `access_denied` and for an existing-email conflict.
   - Pull shared field markup into `components/auth/AuthField.jsx` (new).
   - Files: `pages/{Auth,GoogleCallback,PasswordReset,PasswordResetConfirm,VerificationPending,VerifyEmail}.jsx`, `components/auth/*` (new). Size M.
10. **Settings polish** (A24, A26, A30).
    - Tabs become `role="tablist"`/`tab`/`tabpanel` with roving arrow keys, synced to `?tab=` via `useSearchParams` (no route change). The Settings link and VerificationBanner deep-link to `?tab=account`.
    - The privacy switch becomes `role="switch"` + `aria-checked` + a label, and states that reviews and forum posts stay public in their own pages.
    - Add a "Content" card with the adult toggle via a new shared hook `hooks/useAdultContentPreference.js` (G2 adopts it).
    - "Remove avatar" (`remove_avatar` flag).
    - Use `getApiErrorMessage`/`getApiFieldErrors`; take the `access` returned by change-password with `setAccessToken`.
    - The crop modal gets `role="dialog"`, `aria-modal`, a labelled title, `useFocusTrap`, and a valid label for the zoom range.
    - Files: `pages/Settings.jsx`, `components/settings/{SettingsTabs,AccountTab,ProfileTab,useProfileSettings,useAccountSettings}.*`, `components/ImageCropModal.jsx`, `components/VerificationBanner.jsx`, `hooks/useAdultContentPreference.js` (new), `views/users.py`, `serializers/accounts.py`, `services/profile_update_service.py`. Size M.
11. **Sign out other devices + token flush** (A20).
    - `GET /auth/refresh/sessions/` returns `{active: n, current_since}`: live, non-blacklisted, unexpired outstanding tokens of the cookie's user.
    - `POST /auth/refresh/sessions/revoke-others/` blacklists all except the cookie's jti.
    - Both sit under the cookie path and use the CSRF header check.
    - AccountTab card: "Signed in on N devices · Sign out everywhere else".
    - New task `apps.users.tasks.flush_expired_auth_tokens` deletes expired outstanding tokens (blacklist rows cascade) in batches of 5k. G3 calls it from `run_user_maintenance_workflow`, so there is no new beat entry.
    - Files: `views/auth.py`, `urlconf/accounts.py`, `services/auth_service.py`, `tasks.py`, `components/settings/SessionsCard.jsx` (new), `api/modules/auth.js`. Size S-M.
12. **Retire `warm_profile_cache`** (A21). Delete the task wrapper; request removal of the beat entry and the service method. Size S.
13. **Email copy and PII** (A19). Reset/verify/change emails state the expiry ("valid for 3 days") and include "If this wasn't you, ignore this email". The task logs `user_id`/masked address (`a***@domain`), not the full recipients. Plain text stays. Files: `services/email_service.py`. Size S.
14. **Dead code** (A22). Delete `hooks/useLinkValidation.js`, `validate_single_url`, `validate_registration_credentials`, the ImportError fallback, the `is_full` cache split (keep the query param accepted), and `password_confirm`. Request removal of the `kiyo` route. Size S.
15. **Share preview** (A17). Drop the inline script (meta refresh only). Escape `<`/`>`/`&` in any JSON. Use iexact plus the canonical username in the redirect. Add tests with a hostile bio (`"><script>`) and a section path. Files: `share_preview.py`. Size S.
16. **Fewer wasted requests** (A27). `retry: (n, err) => err.response?.status >= 500 && n < 2` for profile queries. The hover card fetches watching/favorites only after the profile resolves and is not private. Files: `pages/Profile.jsx`, `components/common/MiniProfileHoverCard.jsx`, `api/queries/profile.js`. Size S.

### P2 (nice to have)
1. Password checklist (length, not numeric, matches confirm) live under the field, using `utils/password.js`; no new dependency. S.
2. "Share profile" button in `ProfileHeader` (`navigator.share`, else clipboard + toast; URL `/u/<username>`). S.
3. Privacy/Terms copy refreshed to match reality: refresh cookie, Google sign-in, Umami, Sentry, data export at `/export`, account deletion and media removal. S.
4. Google sign-in for an existing email: a clear message ("Sign in with your password, then connect Google in Settings") plus the open question on allauth auto-connect (Q4). S.
5. Old-username redirect: optional `UserProfile.previous_username` + `previous_username_changed_at` (only if taken, folded into 0039). For 30 days the public lookup resolves the old name to the new user and blocks others from claiming it. M.

### Out of scope
2FA/WebAuthn, magic-link login, more OAuth providers, HTML email templates, react-hook-form/TypeScript, notification preferences (G4), badges (G5), list/stats/activity tab bodies (G3/G5), the data export itself (G3; AccountTab already links `/export`).

## File ownership
Post-seams paths. Everything below may be changed; new files are marked (new).

**Prep commit (`revamp/base`), see overview section 4a.** These now exist and are G1's:
- `apps/users/models/accounts.py` (CustomUser, UserProfile, SocialLinkChangeLog; add new models to its `__all__`)
- `apps/users/serializers/accounts.py`
- `apps/users/urlconf/accounts.py` (also holds `users/me/stats/`)
- `root/settings/features/accounts.py`, where the D-1 `API_SESSION_AUTH_ENABLED` flag goes
- `_account_entries()` in `root/settings/celery_schedule.py` (removing `warm-profile-cache-hourly` is G1's own edit, plus that key in the beat snapshot)
- `frontend/src/app/routes/accounts.jsx`: Integrator request (2) is now G1's own edit. Delete `kiyo`, and add the param-less `verify-email`, `reset-password` and `confirm-email-change` routes here.
- `frontend/src/api/queries/profile.js` (profile, user and mini-profile keys)
- `frontend/src/components/profile/ProfileContent.jsx`: the shell only. The tab bodies are in `components/profile/tabs/*` (G3/G5).
- Contract stubs (keep the signatures, own the implementation): `apps/users/services/profile_visibility.py` (+ `tests/test_profile_visibility.py`), `send_email_task(..., headers=None)` (+ `tests/test_email_headers.py`), and `frontend/src/hooks/useAdultContentPreference.js` (+ `hooks/__tests__/useAdultContentPreference.test.jsx`).
- `revoke_all_sessions` already existed, so there was nothing to stub.

Integrator requests after the prep commit:
- (1) is D-1: G1 adds the flag in `features/accounts.py` (default on, current behaviour).
- (2) and (3) are G1's own edits, as above.
- (4): G1 sets `SIMPLE_JWT["UPDATE_LAST_LOGIN"] = True` in `features/accounts.py` itself, as a documented override.
- (5) stays with the integrator (`root/urls.py` is frozen).
- (6) is done.

Backend:
- `apps/users/views/{auth,account_management,google,social_auth,users}.py`
- `apps/users/serializers/accounts.py`: `UserSerializer`, `UserLightweightSerializer`, `PublicUserSerializer`, `UserProfileUpdateSerializer`, `RegisterSerializer`, `ChangePasswordSerializer`, bio constants. `serializers/users.py` stays an integrator shim. Also `apps/users/serializers/social_auth.py`.
- `apps/users/services/{account_management_service,auth_flow_service,auth_service,avatar_service,email_service,profile_service,profile_update_service,public_profile_service,username_sanitizer,ws_ticket_service,user_queryset,cache}.py`
- `apps/users/services/profile_visibility.py` (new; see contracts)
- `apps/users/{adapters,auth_cookies,tokens,throttling,permissions,share_preview}.py`, `apps/users/middleware/*`
- `apps/users/utils/file_security.py`, `apps/users/utils/image_processing.py` (new)
- `apps/users/urlconf/accounts.py` (seams target)
- `apps/users/signals.py`: only `create_user_profile`, `verify_social_email`, `verify_oauth_signup`, `_verify_user_profile`, `invalidate_profile_cache`, `handle_profile_update`, plus the new `delete_profile_media` receiver
- `apps/users/tasks.py`: only `cleanup_unverified_accounts`, `warm_profile_cache` (delete), `flush_expired_auth_tokens` (new)
- `apps/users/models.py`: `CustomUser`, `UserProfile` identity/privacy/appearance fields, `SocialLinkChangeLog`
- `apps/users/migrations/0038_accounts_username_ci_unique.py`, `0039_accounts_pending_email.py` (new)
- `apps/users/management/commands/resanitize_bios.py` (new)
- `root/ws_auth.py`; `apps/core/services/{social_links_service,url_validator,metadata_service}.py`; `apps/core/tasks/metadata.py`
- Tests (new): `apps/users/tests/test_accounts_{registration,sessions,reauth,media_cleanup,username,email_change,throttles,social_login}.py`; extend `test_auth.py`, `test_auth_cookies.py`, `test_profile_share_preview.py`, `test_profile_features.py`, `test_oauth_avatar.py`, `apps/core/tests/` link-validation tests owned by G1 (new `test_social_links_async_checks.py`).

Frontend (`frontend/src/`):
- `pages/{Auth,VerifyEmail,VerificationPending,ConfirmEmailChange,PasswordReset,PasswordResetConfirm,GoogleCallback,Settings,Profile,Terms,Privacy}.jsx`
- `components/{GoogleLoginButton,VerificationBanner,ImageCropModal,SmartLinkInput}.jsx`; `components/auth/*` (new)
- `components/settings/*` except `NotificationsTab.jsx`, `useNotificationPreferences.js`, `BadgesTab.jsx`; `components/settings/SessionsCard.jsx` (new)
- `components/profile/{ProfileHeader,ProfileTabs,ProfileContent(shell),OverviewTab,ProfileErrorBoundary,SocialLinks,index}.jsx`
- `components/common/MiniProfileHoverCard.jsx`, `components/navbar/UserMenu.jsx`
- `context/AuthContext.jsx`, `api/{httpClient,errors}.js`, `api/modules/auth.js`, `api/queries/profile.js` (seams target; profile/auth keys)
- `hooks/{useUserProfile,useAdultContentPreference(new)}.js`; delete `hooks/useLinkValidation.js`
- `utils/{password,cropImage,profileAccent}.js`
- Tests (new): `context/__tests__/AuthContext.test.jsx`, `pages/__tests__/{VerificationPending,PasswordResetConfirm,GoogleCallback,Settings}.test.jsx`, `components/settings/__tests__/{useProfileSettings,AccountTab}.test.jsx`, `utils/__tests__/profileAccent.test.js`, `components/__tests__/ImageCropModal.test.jsx`; extend `pages/__tests__/Auth.test.jsx`, `api/__tests__/httpClient.test.js`.

**Precedence (prep commit):** where this list names a file or directory that the *Prep commit* block above grants (a `root/settings/features/` module, a `celery_schedule.py` function, an `app/routes/` file, `boot.js`, a split module), the grant wins; everything else in this list stays forbidden. The frozen shells and shims (overview section 4) stay forbidden.

Must not touch:
- `root/settings/*`, `root/urls.py`, `root/celery_schedule` (beat), `apps/users/services/celery_tasks.py` except `UserTaskService.cleanup_unverified_accounts` and `warm_profile_cache` (G1's methods; A10's purge-media fix goes there), `apps/core/services/celery_tasks.py` (G6), `apps/animes/serializers/{base,serializers_mixins}` (G2), `apps/shared/*`, other receivers/tasks in `signals.py`/`tasks.py`, models other than those above.
- `F/app/{routes,providers}.jsx`, `App.jsx`, `sentry.js` (call its exports only), `UmamiAnalytics.jsx`, `Navbar.jsx`, `navbar/MobileNav.jsx`, `common/MarkdownRenderer.jsx` and `forums/RichTextEditor` (G5), `pages/{Browse,Schedule}.jsx` (G2), `FollowButton`/`FollowersModal` (G5), profile tab bodies under `components/profile/tabs/*` owned by G3/G5, `index.css`/design tokens.

## Cross-group contracts

Provides (frozen once merged; additive changes only):
- `/users/me/` payload (profile_service `_build_profile_data`): current keys stay. Adds `pending_email` (str|null). Consumers: G2 (`show_adult_content`, `preferred_timezone`), G6 (`is_staff`), G4/G5 (id, username, avatar).
- `GET /users/<username>/` shape (PublicUserSerializer + live dict) unchanged. Lookup becomes case-insensitive, and the response `username` is canonical.
- Privacy rule, implemented as `apps/users/services/profile_visibility.py`: `can_view_profile(target_user, viewer) -> bool` (owner only; staff go through admin APIs) and `get_visible_user_or_404(username, viewer)` (iexact). Lists, activity, stats, favorites (all three kinds), followers/following, friends-watching and `?user=`/author aggregations must use it. Content stays visible in its anime/thread context.
- Unchanged: `invalidate_user_caches(user_id, username=None, trigger_stats_update=True)`, `has_verified_email`, `VerifiedEmailForWrites`, `get_user_avatar_url`, `issue_ws_ticket` + `POST auth/ws-ticket/` (G4).
- New error code `reauth_required` (403) on set-password/change-email/delete.
- `AuthContext` value shape unchanged. New behaviour: the query cache is cleared on logout or identity change, so other groups must not rely on cached data surviving logout. Every `httpClient` export stays.
- `profileKeys.own/all/byUsername` keep their key arrays.
- `hooks/useAdultContentPreference()` → `{enabled, toggle, isUpdating}`. It owns the PATCH, `refreshProfile`, `removeQueries(animeKeys.all)` and `profileKeys` invalidation.

Consumes:
- G2 `serializers_mixins.UserProfileMixin`/`BadgesMixin` (unchanged). G1 stops importing `validate_image_content` from `animes/serializers/base.py` (own copy in `image_processing.py`), so G2 is free to change it.
- G5 `MarkdownRenderer` (bio), `RichTextEditor` (bio editor), `FollowButton`, `FollowersModal`; G3/G5 tab bodies via the `ProfileContent` shell props (unchanged prop names).

Requests:
- **G5**:
  - (a) Apply `can_view_profile` to `?user=` in `animes/services/reviews.py:101-103`, to forum `author__username` filtering (forums/views.py:142) and to follower/following lists (replace `follow_service.ensure_profile_visible` with the shared helper).
  - (b) In `MarkdownRenderer` put the component's `className` after `{...props}` (or drop `className` from props) at lines 241/248.
  - (c) Decide the delete cascade for `ForumThread.author`/`ForumPost.author` (SET_NULL + "[deleted]" keeps other users' replies).
  - (d) Confirm which `class` values `RichTextEditor` emits (for P1-6).
  - (e) `FollowButton` reads `is_follower`, which no profile payload provides (ProfileHeader.jsx:97,180); either drop it or ask G1 to add it.
- **G3**:
  - (a) Call `flush_expired_auth_tokens.delay()` from `run_user_maintenance_workflow`, keeping its kwargs (snapshot unchanged).
  - (b) Delete `UserTaskService.warm_profile_cache`.
  - (c) Use `can_view_profile` in `list_service`, `activity_service`, `stats_service`/`user_stats_service`, the mini-profile lists, and anything exposing another user's lists.
- **G2**: Replace the adult-toggle handlers in `Browse.jsx:133-152` and `Schedule.jsx:177-183` with `useAdultContentPreference()`.
- **G6**:
  - (a) After `_store_link_metadata` saves, call `invalidate_user_caches(user_id, username, trigger_stats_update=False)`. Alternatively agree to move `fetch_link_metadata`/`_store_link_metadata` into G1's `metadata_service.py`, with `CoreTaskService` delegating.
  - (b) The admin user-delete path must still go through `user.delete()` so the media receiver fires.
- **Integrator**:
  - (1) Remove `rest_framework.authentication.SessionAuthentication` from `DEFAULT_AUTHENTICATION_CLASSES` (base.py:511; AUDIT §3 still open).
  - (2) `routes.jsx` G1 block: delete `kiyo` (108); add param-less `verify-email`, `reset-password`, `confirm-email-change` routes alongside the existing param routes; change the confirm route to `confirm-email-change/:uid/:token` while keeping the 3-segment form for one release.
  - (3) Remove the `warm-profile-cache-hourly` beat entry and update `beat_schedule_and_jazzmin.json`.
  - (4) `SIMPLE_JWT["UPDATE_LAST_LOGIN"] = True` (A33).
  - (5) Optionally drop `path("accounts/", include("allauth.urls"))` (urls.py:25) if `manage.py check` and the tests pass (Q5).
  - (6) Seams split of `serializers/users.py` and `urls.py` as planned.

Collision avoidance: G1 touches `users` migrations only for `CustomUser`/`UserProfile`, at most two, named `0038_accounts_*`/`0039_accounts_*` (reserved, overview section 7). G1 edits only the receivers and tasks listed. Route changes go in G1's own `app/routes/accounts.jsx`. `ProfileContent.jsx` shell props stay stable, so tab-body owners need not rebase.

## Acceptance criteria and test plan

Checklist:
- [ ] `POST auth/login/` without `username`/`email` → 400 `errors.username`; with an unregistered email → 401, the same body as a wrong password (no 500 anywhere; S-3).
- [ ] `POST auth/register/` without email → 400 with `errors.email`. With `email:""` → 400. No user is created.
- [ ] The pending page resend returns 200 and a generic message. A dict or number `email` → 400, never 500.
- [ ] Saving only the bio of a user with 3 links sends no `social_links` and runs no `URLValidator.validate`. Six bio-only saves in a day by a new account all succeed.
- [ ] Log out as A, log in as B in the same tab: Home "continue watching", Settings and own profile show only B. The query cache is empty right after logout.
- [ ] Google login response sets no `sessionid`. After logout, `GET /users/me/` with cookies only → 401.
- [ ] A Google-only account with a token older than 10 min gets 403 `reauth_required` on set-password, change-email and delete. A fresh Google login within the window succeeds. The old address gets a notice on email change and on password change.
- [ ] `POST auth/google/` with `access_token` and no `code` → 400.
- [ ] Login, Google and verify-email without `X-Requested-With`, or with a foreign `Origin` → 403 `csrf_failed`.
- [ ] Account delete, the unverified purge and avatar replace/remove delete the old storage objects (mock storage asserts `delete(name)` after commit).
- [ ] 11 failed logins for one identifier from rotating IPs → 429. A success resets the counter.
- [ ] `Bob` and `bob` cannot coexist (DB constraint). `/users/BOB/` returns `username: "Bob"`, and the SPA replaces the URL.
- [ ] The email-change link has no address in it. Settings shows the pending address with Resend and Cancel.
- [ ] After loading `/reset-password/<uid>/<token>`, the address bar shows `/reset-password`, and Umami's first track sees no token.
- [ ] An uploaded JPEG with GPS EXIF is stored as WebP with no EXIF, ≤ 512 px (avatar) or ≤ 2560 px wide (banner).
- [ ] A bio containing `<div class="fixed inset-0">` is stored without that class.
- [ ] A profile colour of `#111111` renders with contrast ≥ 4.5:1 against `--color-dark` (unit test across 50 random colours).
- [ ] `PATCH /users/me/` with a new unknown-domain link performs no WHOIS call in-request (mock asserts it is not called).
- [ ] The share preview with bio `"><script>alert(1)</script>` contains no raw `<script` except none at all (inline script removed).
- [ ] Settings `?tab=account` opens Account. Tabs work with arrow keys. The privacy switch announces its state. axe has no violations on Login, Register, Settings (vitest + `axe-core` if already installed; otherwise check roles and labels by assertion).
- [ ] "Sign out everywhere else" leaves this device signed in, and another browser's next refresh → 401.

Backend tests (pytest, new files as listed under File ownership):
- `test_accounts_registration.py`: missing or blank email, non-string resend/reset bodies, verification-optional message.
- `test_accounts_social_login.py`: code-only, session flushed (patch `complete_social_login` to call `django.contrib.auth.login`, assert no `sessionid` in `response.cookies` and `SESSION_KEY` not in the session), CSRF header required, OAuth username sanitised, case collisions.
- `test_accounts_reauth.py`: `auth_time` present after login, refresh and Google; 403 when stale; notice emails (locmem outbox via eager tasks).
- `test_accounts_media_cleanup.py`: profile delete, unverified cleanup, replace, remove, storage error swallowed.
- `test_accounts_sessions.py`: sessions count, revoke-others, flush task deletes only expired rows.
- `test_accounts_throttles.py`: identifier throttle; `social_links` throttle only on a real change (scope already live in test.py:35).
- `test_accounts_username.py`: migration refusal on duplicates (TransactionTestCase like test_email_uniqueness.py:44), iexact lookup, cache key lowercasing.
- `test_accounts_email_change.py`: pending_email lifecycle, token bound to the pending address, cancel, link without email.
- Extend `test_profile_share_preview.py` (escaping, no inline script, iexact) and `test_oauth_avatar.py` (normalised WebP, size cap).
- Query budgets (`django_assert_max_num_queries`): pin the measured value + 0 for `POST auth/login/`, `POST auth/refresh/`, `GET users/me/` cold and warm (warm = 0 DB queries apart from auth), `GET users/<u>/` cold, `PATCH users/me/` bio-only. Keep the existing assertions in test_profile_features.py:127,244 green.

Frontend vitest:
- `AuthContext.test.jsx`: clear on logout, on expiry and on a different user. Sentry `setUser`/`clearUserContext` mocked.
- `VerificationPending.test.jsx`: calls `resendVerification('a@b.c')` with a string; prefill from state.
- `useProfileSettings.test.jsx`: no `social_links` in FormData when unchanged; envelope error rendering.
- `Auth.test.jsx`: label association (`getByLabelText`), autocomplete attrs, `state.message` shown, `next` honoured but external URLs ignored.
- `GoogleCallback.test.jsx`: state mismatch, `access_denied`, `reauth` return-to.
- `Settings.test.jsx`: `?tab=` sync, tablist roles and arrow keys, privacy switch `aria-checked`.
- `profileAccent.test.js`: contrast floor.
- `ImageCropModal.test.jsx`: dialog role, Escape, focus returns.

Manual QA script:
- Phone, 375×667 iOS Safari and Android Chrome:
  - Register: no capitalised username, password manager offers to save, show/hide works, 16 px gutters.
  - Wrong email → log in → Settings `?tab=account` → change email → pending card → confirm link from the mail app → banner gone.
  - Forgot password → link → the address bar loses the token → login shows the success message.
  - Google sign-in, cancel and retry.
  - Upload a HEIC/JPEG photo (EXIF gone), a GIF avatar, remove the avatar.
  - Toggle private, open the profile from a logged-out browser (404 page), share-profile button.
  - Visit a profile with a near-black colour (accent readable).
- Desktop:
  - Keyboard-only through login, settings tabs, the crop modal (focus trapped, Escape) and the account menu.
  - Two tabs: logout in one → the other signs out and shows no stale data.
  - "Sign out everywhere else" with a second browser.
  - Discord/Telegram preview of `/u/<name>` (curl with a Discordbot UA) shows escaped tags.
- Gates: `ruff check`, `ruff format --check`, `makemigrations --check --dry-run` (after adding 0038/0039), `pytest -n auto --cov`, `npm run lint`, `npm run test:run`, `npm run build`. Beat snapshot changes only via integrator request (3).

## Migration plan
1. `apps/users/migrations/0038_accounts_username_ci_unique.py`
   - Depends on `users.0037_customuser_email_ci_unique` (re-point to the leaf at integration).
   - Ops: `RunPython(refuse_duplicate_usernames, noop)`, which mirrors 0037: it lists up to 20 groups and raises with instructions. Then `AddConstraint(UniqueConstraint(Lower("username"), name="users_customuser_username_ci_unique"))`.
   - Reversible (constraint removal; RunPython noop backwards). No data backfill. Nothing is deployed, so the refusal path is for dev DBs only.
2. `apps/users/migrations/0039_accounts_pending_email.py`
   - `AddField(UserProfile.pending_email, EmailField(blank=True, default=""))`, `AddField(UserProfile.pending_email_requested_at, DateTimeField(null=True, blank=True))`.
   - Optional P2-5: `AddField(UserProfile.previous_username, CharField(max_length=150, blank=True, default="", db_index=True))`, `AddField(UserProfile.previous_username_changed_at, DateTimeField(null=True, blank=True))`.
   - Reversible (RemoveField). No backfill.

Rollout: there are no live users, so in-flight email-change links in the old 3-segment format are accepted for one release (the backend reads the `new_email` field if present and matches it to `pending_email`, else rejects). `resanitize_bios` runs once after deploy (batched with `iterator(chunk_size=500)` and `bulk_update`), and is idempotent.

## Risks and open questions
- **R1** Flushing the session after Google login relies on allauth not needing it later in the same request. The test covers it. If allauth's `complete_social_login` behaviour changes on upgrade, the test catches it.
- **R2** The `auth_time` re-auth gate adds friction for Google users who keep a tab open for weeks. The window is 10 min after a fresh Google round-trip, and only for three rare actions.
- **R3** WebP re-encoding of banners may soften detail. q≈85 and the 2560 px cap are tunable. GIFs stay as-is, so the GIF size limit is still the only GIF control.
- **R4** Moving WHOIS async means a link to a 2-day-old domain is saved and then flagged "suspicious" instead of being rejected up front. That is acceptable for a profile link with a visible warning.
- **R5** The per-identifier login throttle can be used to lock a known username out for 15 min. A successful login from the owner still works (successes are not blocked; only failures count), and the response is a 429 with Retry-After.
- **Q1** Is reviews/forum visibility for private profiles as proposed (visible in context, hidden in per-user aggregation) the product intent? It needs G5 and owner sign-off.
- **Q2** Should staff see private profiles in the public UI? The share preview allows it (share_preview.py:69-73) and the API does not. The proposal is owner-only everywhere; staff use admin.
- **Q3** Should the OAuth avatar download move to Celery (no new beat, one more task) to keep the login request fast? The default is to keep it inline with a 3 s timeout.
- **Q4** Should allauth email auto-connect for Google-verified addresses be enabled (`SOCIALACCOUNT_EMAIL_AUTHENTICATION(_AUTO_CONNECT)`, settings frozen)? It is safe because Google verifies emails, and it removes A31's dead end.
- **Q5** Whether dj-rest-auth or allauth reverse any URL names from `accounts/` at runtime (unverified). Keep the include unless the tests prove it removable.
- **Q6** Which `class` values the forum `RichTextEditor` emits (unverified). P1-6's allowlist depends on G5's answer.
- **Ownership-matrix notes**:
  - "mixins" in `serializers/users.py` are imports from G2's `animes/serializers_mixins.py`, not classes in users.py.
  - `cleanup_unverified_accounts`, `warm_profile_cache` and the metadata tasks are G1 wrappers whose logic sits in G3's and G6's `celery_tasks.py`.
  - `sentry.js` and `components/auth/*` are unassigned. G1 claims `components/auth/*` (new).
  - The adult-content field is G1 while its only UI is G2's.
