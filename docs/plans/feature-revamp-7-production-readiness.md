# Feature revamp 7: Production readiness
> Base: `revamp/base` (integration/anishows-overnight @ 50dcfba + the seams/contract-stubs prep commit). Planning only.

Paths are repo-relative on `revamp/base`. "Tunnel" means Cloudflare Tunnel (`cloudflared`), which the owner puts in
front of the app on a Hetzner VPS that other projects share.

## Summary
The production stack exists and is careful in places: a non-root image, `collectstatic` at build time, a migration
gate before any process starts (`scripts/run_with_migration_check.sh`), a rolling web deploy with health waits, a
refusal to deploy on well-known default secrets, HSTS and secure cookies, Sentry behind `SENTRY_DSN`, and liveness
and readiness endpoints. What it does not fit is the target host:
- The stack assumes it owns the box: Caddy publishes host ports 80/443 and runs ACME, and the deploy smoke test
  resolves the domain to 127.0.0.1. Behind a tunnel on a shared VPS, the ports may be taken and ACME is pointless.
- Behind the tunnel, the client IP and the scheme no longer arrive the way `production.py` expects (one proxy,
  `X-Forwarded-Proto` from Caddy). That means a likely HTTPS redirect loop, and every user would share one throttle
  bucket, so five failed logins from anyone would lock out login for everyone.
- Postgres is hard-wired to the bundled `db` service, so a shared external Postgres cannot be used.
- Logs are plain text with no request id, and the env template mixes dev and prod values.

This group makes the stack deployable behind the tunnel next to other projects, with an optional external Postgres,
structured logs, honest health checks, a complete secrets template, and a deploy script that checks migrations and
takes a backup first. It adds no application features, and it needs no migrations.

## Current state

### Settings
| File | What it does today |
|---|---|
| `root/settings/production.py` | `DEBUG=False`; `SECURE_SSL_REDIRECT` (env, default True) with the health paths exempt; `SECURE_PROXY_SSL_HEADER=("HTTP_X_FORWARDED_PROTO","https")`; secure session/CSRF cookies; HSTS 1 year + subdomains + preload (hard-coded); `X_FRAME_OPTIONS=DENY`; requires `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` (raises if unset); `NUM_PROXIES` from `DRF_NUM_PROXIES` (default 1, "Caddy only"); `CONN_HEALTH_CHECKS`; Sentry init when `SENTRY_DSN` is set; a text `LOGGING` config |
| `root/settings/base.py` (frozen) | `ALLOWED_HOSTS` from env (default `localhost,127.0.0.1,web`); whitenoise middleware and `CompressedManifestStaticFilesStorage`, `WHITENOISE_MANIFEST_STRICT=False`; DB from `DB_*` env, `DB_POOL_MAX_SIZE` pool, `CONN_MAX_AGE` 600 |
| `root/settings/features/ops.py` | Empty G7 module (prep commit), star-imported at the end of `base.py` |
| `apps/core/utils.get_client_ip` | Trusts `X-Forwarded-For` only from `TRUSTED_PROXY_CIDRS` (compose: private ranges) |

### Processes and images
| Piece | File | Notes |
|---|---|---|
| Image | `Dockerfile` | `python:3.12-slim` (tag, not digest); `uv sync --frozen --no-dev`; uid 1000; `collectstatic` with placeholder env; `HEALTHCHECK` on `/api/v1/health/`; `CMD` = migration gate + gunicorn |
| Web | `gunicorn.conf.py`, `root/gunicorn_tuning.py` | uvicorn workers (HTTP + WS), CPU-based worker count, `max_requests` 2000 + jitter, `timeout` 60, `graceful_timeout` 30, `preload_app`, Prometheus multiprocess dir |
| Stack | `docker-compose.prod.yml` | web (768M), celery (1G, concurrency 2), beat, db (postgres:18, 1G), redis (256mb LRU, AOF), minio, createbuckets, caddy (**publishes 80/443**), umami + umami_db, backup. Backend `DB_HOST: db` is hard-coded and every backend service `depends_on: db: service_healthy` |
| Edge | `Caddyfile.prod` | `{$DOMAIN_NAME}` site with ACME email, HSTS, routes for `/api`, `/ws`, `/django-admin`, `/static`, `/metrics`, `/media` (MinIO, read-only), SPA files, crawler share previews, and an Umami site on `{$UMAMI_DOMAIN}` |
| Deploy | `deploy-prod.sh`, `.github/workflows/deploy.yml` | CI builds and pushes to GHCR, then SSHes in: copy the frontend dist into a volume, pull, `anilist_smoke`, `migrate`, workers, roll web one replica at a time, clear the cache, reload Caddy, smoke-test via `--resolve DOMAIN:80:127.0.0.1`. It refuses placeholder values for `DB_PASSWORD`, `REDIS_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `UMAMI_DB_PASSWORD` and `UMAMI_APP_SECRET`, and requires `UMAMI_DOMAIN` |
| Backups | `backups/` | Alpine cron, daily 03:00 `backup.sh` (pg_dump + MinIO archive), `BACKUP_KEEP=1` by default, restore/export/import scripts, `make verify-backup` |
| Health | `apps/core/views/health.py`, `apps/core/services/migration_health.py`, `apps/core/urls.py` | `GET /api/v1/health/` (liveness, maintenance-aware, always 200); `GET /api/v1/health/ready/` (DB `SELECT 1`, cache round-trip, `MigrationExecutor` pending check on **every** hit; 503 when any fails) |
| Checks | `apps/core/checks.py` | One deploy check: `core.W001` (no Safe Browsing key) |

### Tests already present
`apps/core/tests/test_production_settings.py` (NUM_PROXIES, spoofed XFF, INFO logs kept),
`test_health_redirects.py` (health paths exempt from the SSL redirect), `test_migration_health.py`,
`test_settings_split.py` (imports production settings in a subprocess with `SETTINGS_ENV`),
`apps/admin_api/tests/test_production_readiness.py` (G6's file: settings, maintenance and the liveness payload).

## Problems found
| ID | Sev | Area | Problem | Evidence path:line | Fix ref |
|---|---|---|---|---|---|
| R1 | High | Edge | Behind the tunnel, the origin is reached over plain HTTP. Caddy's site address `{$DOMAIN_NAME}` turns on automatic HTTPS (ACME plus an HTTP→HTTPS redirect) and publishes 80/443 on the host. On a shared VPS those ports may already belong to another project, and ACME there is useless or fails. | `Caddyfile.prod:1-7`; `docker-compose.prod.yml` caddy `ports` | P0-1 |
| R2 | High | Scheme | Caddy sets `X-Forwarded-Proto` to its own inbound scheme (`http` from cloudflared) unless the hop is a trusted proxy. Django then sees `http`, and with `SECURE_SSL_REDIRECT=True` it 301s every request to https, which Cloudflare reports as a redirect loop. (Behaviour inferred from Caddy's documented `trusted_proxies` handling; verify on the box.) | `root/settings/production.py` (`SECURE_SSL_REDIRECT`, `SECURE_PROXY_SSL_HEADER`); `Caddyfile.prod` (no `trusted_proxies`) | P0-2 |
| R3 | High | Client IP | `get_client_ip` and DRF `NUM_PROXIES=1` treat Caddy as the only proxy. Behind cloudflared, Caddy's peer is the cloudflared container, so every request has the same client IP. Login (5/min), register (3/h) and anonymous throttles become global: anyone can lock everyone out. Request logs and forum view counting collapse to one IP too. | `root/settings/production.py` (`NUM_PROXIES`); `apps/core/utils.py:44-60`; `docker-compose.prod.yml` (`TRUSTED_PROXY_CIDRS`) | P0-2 |
| R4 | High | Database | A shared external Postgres is impossible: `DB_HOST: db` is hard-coded in the backend anchor, every backend service waits for `db` to be healthy, the backup service dumps `POSTGRES_HOST: db`, and nothing sets `sslmode`. | `docker-compose.prod.yml` `x-backend.environment`, `depends_on`, `backup.environment` | P0-3 |
| R5 | Med | Secrets | The deploy guard does not check `DJANGO_SECRET_KEY`: the template's `change_me_in_production` deploys fine. `METRICS_PASSWORD=change_me` is guarded only by the view. No check covers `ALLOWED_HOSTS`, which falls back to `localhost,127.0.0.1,web`, so a missed variable gives 400 on the real domain at runtime instead of a failed deploy. | `deploy-prod.sh` (`is_placeholder` loop); `.env.example`; `root/settings/base.py` `ALLOWED_HOSTS` | P0-4 |
| R6 | Med | Env template | `.env.example` mixes dev and prod values (`DJANGO_ENV=development`, `USE_S3=True` with MinIO creds) and lacks the variables production reads or will read: `DRF_NUM_PROXIES`, `SECURE_SSL_REDIRECT`, `GUNICORN_*`, `CELERY_CONCURRENCY`, `SCALE_WEB`, `SENTRY_TRACES_SAMPLE_RATE`/`PROFILES`/`RELEASE`, `VAPID_*` (G4 C-INT-3), `ADMIN_ALLOW_CIDRS` (D-9), the tunnel token, `DB_SSLMODE`. | `.env.example` | P0-5 |
| R7 | Med | Logging | Production logs are text (`{levelname} {asctime} {module} {message}`) with no logger name, no request id and no structured `extra`. Most app logs pass `extra={...}`, which this format drops. Gunicorn's access log is a second, unstructured stream. | `root/settings/production.py` `LOGGING`; `gunicorn.conf.py` `accesslog` | P1-1 |
| R8 | Med | Health | `/api/v1/health/ready/` builds a `MigrationExecutor` graph on every unauthenticated hit (moved here from G6 A20). It is public through Caddy, and Caddy's own upstream health checks use liveness only. | `apps/core/views/health.py:61-87`; `apps/core/services/migration_health.py:5-8`; `Caddyfile.prod` `health_uri` | P1-2 |
| R9 | Med | Deploy | The smoke test pins the domain to 127.0.0.1 on port 80/443. Behind the tunnel the public path is Cloudflare, and the local path is Caddy's internal port. There is no pre-migrate backup, no `migrate --plan` review, and no documented rollback. | `deploy-prod.sh` (`BASE_URL`, `CURL --resolve`, migrate step) | P1-3 |
| R10 | Med | Backups | `BACKUP_KEEP=1` keeps a single copy, on the same disk as the database. There is no off-site copy, and with an external Postgres the bundled backup has nothing to dump. | `.env.example` `BACKUP_KEEP`; `backups/shell/backup.sh`; `backups/entrypoint.sh` | P1-4 |
| R11 | Low | Sentry | There is no scrubbing of tokens in URL paths (reset/verify/email-change links, G1 A14) or of `Authorization`/cookie headers in breadcrumbs. `release` comes only from an env var CI never sets. `profiles_sample_rate` is 0.1 by default, which costs quota on a small VPS. | `root/settings/production.py` `sentry_sdk.init` | P1-5 |
| R12 | Low | HSTS | `SECURE_HSTS_PRELOAD=True` + `includeSubDomains` are hard-coded in Django and in Caddy. Preload is a one-way door for the whole domain, subdomains included (other projects on the same domain). | `root/settings/production.py`; `Caddyfile.prod:19` | P1-6 (⚑ owner) |
| R13 | Low | Image | The base image is pinned by tag only. `PYTHONUNBUFFERED`/`PYTHONDONTWRITEBYTECODE` are unset. `COPY . .` ships tests and docs. There is no `--chown` at copy time (an extra `chown -R` layer). | `Dockerfile` | P2-1 |
| R14 | Low | Footprint | Memory limits add up to about 4.8 GB (web 768M x 2 replicas, celery 1G, db 1G, plus the rest), on a shared 8 GB VPS. Umami is mandatory: the deploy dies without `UMAMI_DOMAIN`. | `docker-compose.prod.yml` `deploy.resources`; `deploy-prod.sh` | P1-7 |

## Proposed scope

### P0 (deployable behind the tunnel, safe by default)
1. **Edge for the tunnel** (R1). Size M.
   - New `infra/cloudflared/config.example.yml` and a `cloudflared` compose service (image pinned by digest, `TUNNEL_TOKEN` from env, no host ports) under a `tunnel` profile. The tunnel routes the public hostnames to `http://caddy:80`.
   - Caddy gets an env switch `CADDY_SITE_ADDRESS`: the default (`{$DOMAIN_NAME}`) keeps today's behaviour; `:80` (tunnel mode) serves plain HTTP with `auto_https off` and no ACME. The host `ports:` mapping moves behind a `public-ports` profile or an env-driven bind (`${CADDY_HTTP_BIND:-}`), so tunnel mode publishes nothing.
   - Umami's site block follows the same switch, and Umami becomes optional (a profile) with the deploy check skipped when it is disabled (R14).
   - Files: `Caddyfile.prod`, `docker-compose.prod.yml`, `infra/cloudflared/*` (new), `deploy-prod.sh`.
2. **Scheme and client IP behind the tunnel** (R2, R3). Size M.
   - In tunnel mode Caddy trusts only the cloudflared container (`trusted_proxies static <compose subnet or cloudflared IP>`). It forwards the scheme Cloudflare saw, and sets `X-Forwarded-For` from `CF-Connecting-IP` (`header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}`), so the app still sees exactly one trusted proxy (Caddy) appending one real client address.
   - `DRF_NUM_PROXIES` stays 1 and `TRUSTED_PROXY_CIDRS` stays the Docker ranges: the contract "Caddy is the only proxy the app trusts" holds in both modes. Document the chain in `docs/deploy/tunnel.md` (new).
   - Tests: a Caddy config check in CI is out of scope (Caddy not in CI). Add `apps/core/tests/test_proxy_chain.py`: with `REMOTE_ADDR` in the trusted range and a single XFF value, the throttle identity and `get_client_ip` are that value; a forged second XFF entry from the client does not change it (extends today's spoofing test).
   - Files: `Caddyfile.prod`, `root/settings/production.py` (comments and env names only unless measurement says otherwise), tests (new).
3. **External Postgres via env** (R4). Size M.
   - The backend anchor reads `DB_HOST: ${DB_HOST:-db}`, `DB_PORT: ${DB_PORT:-5432}`, and `DB_SSLMODE` (new, default empty). `features/ops.py` adds `sslmode` to `DATABASES["default"]["OPTIONS"]` when `DB_SSLMODE` is set (base stays frozen; the module imports `DATABASES` from `..base` and updates it).
   - The bundled `db` moves behind a `bundled-db` profile. The `depends_on: db` entries become `required: false` (Compose ≥ 2.20) so services start without it. The deploy script brings the profile up when `DB_HOST=db`.
   - The connection budget is documented: `max_connections ≥ DB_POOL_MAX_SIZE x (gunicorn workers x SCALE_WEB + celery concurrency + beat) + headroom for the other projects`. A system check (`core.W002`) warns when `DB_POOL_MAX_SIZE` is 0 in production with an external host.
   - Backups work against `DB_HOST` (see P1-4).
   - Files: `docker-compose.prod.yml`, `root/settings/features/ops.py`, `apps/core/checks.py`, `backups/*`, `.env.example`, `deploy-prod.sh`.
4. **Refuse unsafe production config** (R5). Size S.
   - `deploy-prod.sh` adds `DJANGO_SECRET_KEY` (placeholder or shorter than 50 characters), `METRICS_PASSWORD` and `ALLOWED_HOSTS` (unset, or only the local defaults) to the refusal list; `ALLOW_INSECURE_DEFAULTS=1` keeps its one-run override.
   - New deploy checks in `apps/core/checks.py` (`--deploy` only, so tests and dev are unaffected): `core.E010` for a secret key that is a known placeholder, `core.W011` for `ALLOWED_HOSTS` with only local names.
   - The image build and the deploy script run `manage.py check --deploy --fail-level ERROR`.
   - Files: `deploy-prod.sh`, `apps/core/checks.py`, `Dockerfile`, tests `apps/core/tests/test_deploy_checks.py` (new).
5. **One env template per environment** (R6). Size S.
   - `.env.example` stays the dev template (unchanged behaviour). New `.env.production.example` lists every production variable, grouped (Django, proxy chain, database, Redis, storage, email, auth, monitoring, push, tunnel, backups), each with a one-line comment and no working secrets.
   - It includes G4's `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (C-INT-3, env half) and `ADMIN_ALLOW_CIDRS` (D-9).
   - A test parses `.env.production.example` and asserts that every `os.getenv("X")` in `root/settings/*.py` and `features/*.py` appears there, or in an allowlist of dev-only names. This keeps the template honest as groups add settings.
   - Files: `.env.example`, `.env.production.example` (new), `apps/core/tests/test_env_template.py` (new).

### P1 (operability)
1. **Structured JSON logs** (R7). Size M.
   - New `root/log_formatting.py::JsonFormatter` (stdlib only, no new dependency): one JSON object per line with `ts`, `level`, `logger`, `message`, `request_id`, `exc_info` (formatted) and every non-standard `extra` key. Values are JSON-safe via `default=str`, and output is truncated at 16 KB.
   - `LOG_FORMAT` env (`json` default in production, `text` available) in `features/ops.py`; `production.py` builds `LOGGING` from it.
   - Request id: honour `CF-Ray`, else `X-Request-ID`, else generate one. This needs a tiny middleware, but middleware is G6's (`apps/core/middleware/*`) and `MIDDLEWARE` is frozen in base, so G7 adds `root/request_id.py` (new, a G7 file) and inserts it from `production.py` only (`MIDDLEWARE = ["root.request_id.RequestIdMiddleware", *MIDDLEWARE]`), plus a logging filter that reads a contextvar. The response echoes `X-Request-ID`.
   - Gunicorn: `accesslog` off by default in JSON mode (Caddy and the app already log requests; env `GUNICORN_ACCESS_LOG=1` turns it back on), and `logconfig_dict` reuses the JSON formatter for `gunicorn.error`.
   - Celery: `worker_hijack_root_logger=False` is frozen (`root/celery.py`); it is a request if needed. Otherwise rely on `LOGGING` (celery uses Django's when hijack is off; verify).
   - Tests: `apps/core/tests/test_json_logging.py` (extra keys, exceptions, request id from header or generated, non-serialisable values).
2. **Honest, cheap health checks** (R8; takes over G6 A20). Size S.
   - Cache the pending-migrations result in-process for 60 s (and in the cache for 60 s across workers). The liveness payload stays exactly as today (G6's `test_production_readiness.py` pins it).
   - The readiness response keeps its shape; `checks` may gain `"broker": bool` (Redis broker ping, 1 s timeout) as an additive key.
   - Caddy's `health_uri` stays on liveness (a DB blip must not eject every replica).
   - D-9's matcher (`{$ADMIN_ALLOW_CIDRS:0.0.0.0/0}`) on `/metrics`, `/api/v1/health/ready/` and `/django-admin/*` lands here, default-open.
   - Files: `apps/core/views/health.py`, `apps/core/services/migration_health.py`, `Caddyfile.prod`, tests `apps/core/tests/test_health_endpoints.py` (new), `test_migration_health.py`.
3. **Deploy script: plan, back up, migrate, verify** (R9). Size M.
   - Order:
     1. Preflight (`check --deploy`, env refusals).
     2. `migrate --plan` printed and saved to the deploy log.
     3. If the plan is non-empty, a pre-migrate backup (`backup.sh pre-migrate`, kept separately).
     4. `migrate --noinput`.
     5. Workers.
     6. Rolling web.
     7. Smoke tests against Caddy's internal address (`docker compose exec caddy wget -qO- http://localhost/api/v1/health/ready/`) and, when `PUBLIC_BASE_URL` is set, through the public URL (tunnel).
   - A failed smoke test leaves the old replicas serving (today's behaviour) and prints the rollback recipe: re-deploy the previous `BACKEND_TAG`; migrations are reversible per the overview's policy (`migrate <app> <previous>`); restore from the pre-migrate backup as the last resort.
   - `docs/deploy/runbook.md` (new) holds first deploy, routine deploy, rollback, restore, rotating secrets and the owner checklist (D-1, D-2, D-4, D-6, D-8, D-9 CIDRs, adult rule, HSTS preload).
4. **Backups that survive the disk and the host** (R10). Size M.
   - `backup.sh` dumps `${POSTGRES_HOST}` (default `db`) with `pg_dump -Fc` and runs `pg_restore --list` as an integrity check.
   - `BACKUP_KEEP` default goes to 7 in `.env.production.example` (the dev template stays 1).
   - Optional off-site copy: when `BACKUP_REMOTE` (an S3-compatible URL, for example a Hetzner Object Storage bucket) and credentials are set, the existing backup container uploads the new archive with the AWS CLI or `mc`, both already used by the stack's images (verify which is in the backup image; add `mc` in `backups/Dockerfile` if not).
   - `make verify-backup` restores the latest dump into a throwaway database and runs `manage.py check` + `showmigrations` against it.
   - Files: `backups/**`, `makefile`, `docs/backups.md`.
5. **Sentry hygiene** (R11). Size S.
   - `before_send` and `before_breadcrumb` scrub `/reset-password/<uid>/<token>`, `/verify-email/…`, `/confirm-email-change/…` and the API forms of them to `…/<redacted>`, and drop `Authorization`, `Cookie` and `Set-Cookie`.
   - `release` defaults to the image's `GIT_SHA` (CI passes `--build-arg GIT_SHA`, and the Dockerfile sets `ENV`).
   - `profiles_sample_rate` default 0.0, `traces_sample_rate` 0.05, both env-overridable.
   - Tests on the scrubber functions (pure functions, no Sentry network).
6. **HSTS as a setting** (R12). Size S. `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS` and `SECURE_HSTS_PRELOAD` read env, with today's values (1 year, True, True) as defaults so nothing changes. Caddy's header reads the same env. ⚑ CONFIRM: preload/includeSubDomains on a domain shared with other projects.
7. **Fit the shared VPS** (R14). Size S.
   - Memory limits and replica count come from env, defaulting to today's values. The runbook adds a table of the defaults' total, and a "small box" profile (web x1, celery concurrency 1).
   - Umami becomes optional (`analytics` profile; the deploy check runs only when enabled).

### P2
1. Image hygiene (R13): pin `python:3.12-slim@sha256:…`, `ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1`, `COPY --chown`, and `.dockerignore` excludes `docs/`, `**/tests/` (check that nothing imports test helpers at runtime first: `apps/animes/tests/catalog_fixtures.py` is used by management commands? verify), `monitoring/`, `infra/`. Size S.
2. A `docker compose -f docker-compose.prod.yml config` lint step in CI (`deploy.yml`, before build). Size S.
3. Uptime: a public `GET /api/v1/health/` monitor through Cloudflare (owner's account; documented, not built). Size S.

### Out of scope
Kubernetes, horizontal scaling across hosts (`infra/terraform` stays as is), a managed Redis, PgBouncer, CDN
configuration inside Cloudflare (owner's dashboard), new Python dependencies (request them from the integrator; P1-1
needs none), application features, catalog-layer changes, and anything in `root/settings/base.py`.

## File ownership
G7 may change (all exclusive to G7 during the fan-out):
- **Settings:** `root/settings/production.py`; `root/settings/features/ops.py`
- **Python (root):** new `root/log_formatting.py`, `root/request_id.py`; `root/gunicorn_tuning.py`, `root/wsgi.py`; `gunicorn.conf.py`
- **Health and checks:** `apps/core/urls.py`, `apps/core/views/health.py`, `apps/core/services/migration_health.py`, `apps/core/checks.py`
- **Tests:** `apps/core/tests/{test_production_settings,test_health_redirects,test_migration_health}.py`; new `apps/core/tests/{test_proxy_chain,test_deploy_checks,test_env_template,test_json_logging,test_health_endpoints}.py`; only the `SETTINGS_ENV` dict of `apps/core/tests/test_settings_split.py` (if production gains a required variable)
- **Images and stacks:** `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `docker-compose.yml`, `Caddyfile.prod`, `Caddyfile`
- **Deploy and env:** `deploy-prod.sh`, `.env.example`, new `.env.production.example`, `makefile`, `.github/workflows/deploy.yml`
- **Infra and scripts:** `backups/**`, `infra/**` (new `infra/cloudflared/`), `scripts/run_with_migration_check.sh` and new `scripts/deploy/*`, `monitoring/**`
- **Frontend build:** `frontend/Dockerfile`, `frontend/nginx.conf`
- **Docs:** `docs/backups.md`, new `docs/deploy/*`

Must not touch:
- `root/settings/base.py`, `celery_schedule.py`, `jazzmin.py`, `development.py`, `test.py`; `root/{urls,celery,asgi,storage_backends}.py`
- `apps/core/middleware/*` (G6), `apps/core/utils.py` (frozen)
- `apps/admin_api/tests/test_production_readiness.py` (G6; keep the liveness payload it pins)
- `pyproject.toml`/`uv.lock` (request dependencies), `.github/workflows/ci.yml`
- Every app module outside the list above, and `frontend/src/**`

## Cross-group contracts
**Provides (frozen once merged):**
- `GET /api/v1/health/` and `GET /api/v1/health/ready/` keep their paths, status codes and current keys (`status`,
  `maintenance_mode`, `service_available`, `version`, `checks`, plus maintenance `detail`/`retry_after`). New keys are
  additive only.
- The proxy contract: the app trusts exactly one proxy hop (Caddy) in both deploy modes. `get_client_ip` and DRF
  throttles keep working unchanged, so G1's throttles, G5's view counting and G6's audit IP need no change.
- `LOG_FORMAT`, `X-Request-ID` echo, and the `request_id` field in every log line. Groups keep logging through
  `apps.shared.logger` with `extra={...}`. Nothing else is needed for structured output.
- `.env.production.example` is the single list of production variables, and only G7 edits it. A group that adds an
  `os.getenv` in its `features/*.py` lists the name, default and meaning in its own spec (section "Env vars added")
  and its merge commit message. G7 merges last, rebases onto all six, and adds every such name. Its
  `test_env_template` gate fails until the template is complete.

**Consumes:** G4's VAPID variable names (C-INT-3); G6's maintenance-mode helper (`is_maintenance_mode_enabled`, read
by the health views); the overview's migration policy (reversible, no merge migrations) for the rollback recipe.

**Requests:**
- **Integrator:** (1) none for dependencies if P1-1 stays stdlib-only. (2) `root/celery.py`: only if Celery's root
  logger hijack drops the JSON handler (verify first). (3) After the fan-out, fold `features/ops.py` into `base.py`
  with the other feature modules.
- **G6:** none. A20 (readiness migration graph) moved to G7, and G6 drops that bullet from its P1-5. D-9 and R5
  (Caddy IP gate) are G7's because G7 owns `Caddyfile.prod`.
- **G4:** none. The VAPID env lines land in G7's template and prod compose.

## Acceptance criteria and test plan
Checklist:
- [ ] With `CADDY_SITE_ADDRESS=:80` and the `tunnel` profile, `docker compose -f docker-compose.prod.yml config` shows no host ports on any service, and Caddy starts without ACME.
- [ ] Through the tunnel: `curl -sI https://<domain>/api/v1/health/` → 200, no redirect loop; `/login` page loads; the WebSocket at `/ws/notifications/` upgrades.
- [ ] Two clients behind different public IPs get separate login throttle buckets (a test with forged/trusted headers plus a manual check: 6 failed logins from phone A do not block phone B).
- [ ] `DB_HOST=<external>` without the `bundled-db` profile: web, celery and beat start, migrate, and pass readiness. `DB_SSLMODE=require` reaches the connection (`SHOW ssl` or `pg_stat_ssl`).
- [ ] `deploy-prod.sh` refuses `DJANGO_SECRET_KEY=change_me_in_production`, a missing `ALLOWED_HOSTS`, and `METRICS_PASSWORD=change_me`; `ALLOW_INSECURE_DEFAULTS=1` lets one run through with a warning.
- [ ] `manage.py check --deploy` on production settings with a placeholder secret → `core.E010`.
- [ ] Every `os.getenv` name in `root/settings/**` appears in `.env.production.example` or the dev-only allowlist (`test_env_template.py`).
- [ ] With `LOG_FORMAT=json`, one request produces JSON lines carrying the same `request_id` (from `CF-Ray` when present), and `extra` keys appear as fields. A logged exception has `exc_info` and no raw newlines.
- [ ] 100 readiness hits within a minute run the migration graph at most once per process (mock asserts call count).
- [ ] The deploy prints `migrate --plan`, takes a pre-migrate backup when the plan is non-empty, and the backup restores with `make verify-backup`.
- [ ] With `BACKUP_REMOTE` set, the archive appears in the bucket; with it unset, nothing is uploaded and nothing fails.
- [ ] Sentry scrubbing: an event whose URL is `/reset-password/abc/def` reaches `before_send` and leaves with `/reset-password/<redacted>`; `Authorization` never appears.
- [ ] HSTS headers are byte-identical to today with no env set.

Backend tests (pytest): the new files listed under File ownership, plus extending `test_production_settings.py`
(LOG_FORMAT switch, HSTS env defaults, `sslmode` only when set) and `test_migration_health.py` (cache).

Manual QA on a staging run of the box (owner present, not tonight): first deploy with the tunnel, external
Postgres and a fresh `.env.production`; then a second deploy that carries one migration (a group's), and check the
plan, the backup, migrate and the roll. Open the site on a phone over mobile data (a different IP from the desktop)
and check that the throttles are per device.

Gates: `ruff check`, `ruff format --check`, `makemigrations --check --dry-run` (no migrations), `pytest -n auto`,
the mypy count must not rise (overview section 13), `docker compose -f docker-compose.prod.yml config -q` for each
profile combination (`tunnel`, `public-ports`, `bundled-db`, `analytics`), `bash -n deploy-prod.sh backups/shell/*.sh`,
and `shellcheck` if it is available. The frontend gates are unchanged (G7 touches only `frontend/Dockerfile` and
`nginx.conf`).

## Migration plan
None. G7 adds no models. Migration readiness is process: the deploy plan/backup/migrate order (P1-3), and the
overview's policy that every fan-out migration is reversible and batched. G7 adds a gate script
`scripts/deploy/check_migrations_reversible.sh` that, on a scratch database, applies all migrations, then migrates
each app touched since `revamp/base` back to its `revamp/base` leaf and forward again. It runs at the end of the
fan-out, after G6 merges, and for G7's own rebase.

## Risks and open questions
- **R-a** The Caddy/cloudflared header behaviour (`trusted_proxies`, `CF-Connecting-IP`, `X-Forwarded-Proto`) is from documentation, not measured here. The first staging deploy must confirm it with a request-echo endpoint (temporary) before the throttles are trusted.
- **R-b** `depends_on.required: false` needs Docker Compose ≥ 2.20 on the VPS (unverified). The fallback is two compose override files (`docker-compose.bundled-db.yml`).
- **R-c** JSON logs change what `docker logs` looks like for anyone used to the text format; `LOG_FORMAT=text` keeps the old one.
- **R-d** External Postgres shared with other projects: a noisy neighbour can exhaust `max_connections`. The pool cap and the documented budget limit our share; the owner sets the server-side limit (`ALTER ROLE … CONNECTION LIMIT`).
- **Q1 ⚑** HSTS preload and includeSubDomains on a shared domain: keep (today) or turn off before the first deploy?
- **Q2 ⚑** Off-site backup target (Hetzner Object Storage, Storage Box, or none for now)?
- **Q3** Does the owner want Caddy kept at all behind the tunnel? Keeping it is the plan: it holds the routing, media proxying, CSP and SPA fallback, and cloudflared alone cannot do those.
