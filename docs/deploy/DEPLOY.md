# aniShows deploy hand-off (for the Infra Architect)

Target: oddava's shared Hetzner VPS (8 GB / 4 cores, ~15 other containers), behind Cloudflare
Tunnel, domain `anishows.com`, with the bundled or an external/shared Postgres. Nothing here has
been deployed. Every step below was run locally in a production-mode dry run (see "Verified").

## What you need to provide

| Item | Notes |
|---|---|
| Docker Engine ≥ 25, Compose ≥ 2.20 | `depends_on.required: false` needs 2.20 |
| A Cloudflare Tunnel | Remotely managed: copy its token. Public hostname `anishows.com` (+ `www` if wanted) → service `http://caddy:80` |
| GHCR read access | `docker login ghcr.io` with a `read:packages` PAT (images `ghcr.io/oddava/anishows-{backend,frontend}`) |
| `.env` | From `.env.production.example`; fill every `<...>`, `chmod 600` |
| Optional: external Postgres 15+ | Role + database + `pg_trgm`; TLS (`DB_SSLMODE=require`); a connection limit (runbook) |
| Optional: off-site bucket | Hetzner Object Storage or a Storage Box, via `BACKUP_REMOTE` + `RCLONE_CONFIG_*` |

## Compose layout

`docker-compose.prod.yml` publishes **no host ports**. `deploy-prod.sh` adds profiles and
override files from `.env`:

| `.env` | Effect |
|---|---|
| `CADDY_MODE=tunnel` | Caddy on `:80` (plain HTTP, no ACME); trusts `CF-Connecting-IP` only from the `edge` network (`EDGE_SUBNET`, default `10.250.250.240/29`, cloudflared + Caddy only; change it if it overlaps a host network) |
| `TUNNEL_TOKEN=…` | `tunnel` profile: our own cloudflared (pinned `2026.10.0@sha256:9b49…`), healthchecked with `cloudflared tunnel ready` |
| `TUNNEL_EXTERNAL=1` + `COMPOSE_EXTRA_FILES="infra/compose/shared-tunnel-network.yml"` + `TUNNEL_NETWORK=<net>` | reuse an existing cloudflared container: Caddy joins `<net>` as `anishows-caddy` |
| `TUNNEL_EXTERNAL=1` + `COMPOSE_EXTRA_FILES="infra/compose/loopback-port.yml"` | cloudflared on the host: Caddy on `127.0.0.1:${CADDY_LOOPBACK_PORT:-8080}` |
| `DB_HOST=db` (default) | `bundled-db` profile (Postgres 18, volume `<project>_db_data`) |
| `DB_HOST=<host>` + `DB_SSLMODE=require` | external Postgres; no db container; backups dump that host |
| `UMAMI_DOMAIN` set (or `ANALYTICS_ENABLED=1`) | `analytics` profile (Umami); off by default in the template |
| `CADDY_MODE=public` | the old layout: `infra/compose/public-ports.yml` publishes 80/443, Caddy runs ACME |

Services: `web` (gunicorn + uvicorn workers; HTTP and WebSockets), `celery`, `beat`, `redis`,
`minio` (media, served read-only by Caddy under `/media/`), `createbuckets`, `caddy`, `backup`
(daily 03:00 cron), plus the optional `db`, `cloudflared`, `umami`, `umami_db`. Compose project
name = directory name, unless `COMPOSE_PROJECT_NAME` is set. Every container's logs rotate
(5 × 10 MB). Memory limits are env-driven; the runbook has a shared-host profile of about 3 GB.

## Deploy

```bash
git clone <repo> aniShows && cd aniShows
cp .env.production.example .env && chmod 600 .env && $EDITOR .env
docker login ghcr.io
./deploy-prod.sh            # refuses placeholder secrets / bad ALLOWED_HOSTS before touching anything
scripts/deploy/compose.sh exec web python manage.py createsuperuser
```

**Every manual compose command goes through `scripts/deploy/compose.sh`** (same `.env` parsing,
profiles, override files and derived `CADDY_*` as the deploy). A bare `docker compose -f
docker-compose.prod.yml up` that recreates Caddy would bring it up in public mode.

Then run the four checks in [tunnel.md](tunnel.md#verify-on-the-box-risk-r-a-header-behaviour-is-from-documentation)
(no redirect loop, `https` seen by Django, per-client throttles, `client_ip` in Caddy's log).
Cloudflare: SSL/TLS mode **Full**, "Always Use HTTPS" on. Uptime: a Cloudflare (or external)
monitor on `GET https://anishows.com/api/v1/health/` (always 200 while the process is up;
`/api/v1/health/ready/` is the dependency check and sits behind `ADMIN_ALLOW_CIDRS`).

CI (`.github/workflows/deploy.yml`) still targets the old host (`EC2_*` secrets) and calls the same
script. Point those secrets at the new box (and set `CADDY_MODE=tunnel` in its `.env`) when you
switch over.

## Env, grouped (full list: `.env.production.example`)

- **Must set:** `DJANGO_SECRET_KEY` (≥ 50 chars), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`,
  `CSRF_TRUSTED_ORIGINS`, `DOMAIN_NAME`, `FRONTEND_URL`, `DB_PASSWORD`, `REDIS_PASSWORD`,
  `AWS_SECRET_ACCESS_KEY` (MinIO root), `METRICS_PASSWORD` (≥ 12, or empty to disable `/metrics`),
  `RESEND_API_KEY`, `TUNNEL_TOKEN` (tunnel mode, in-stack).
- **Edge:** `CADDY_MODE`, `TUNNEL_EXTERNAL`, `COMPOSE_EXTRA_FILES`, `TUNNEL_NETWORK`,
  `CADDY_TRUSTED_PROXIES`, `ADMIN_ALLOW_CIDRS` (space-separated, quoted), `PUBLIC_BASE_URL`
  (post-deploy smoke through Cloudflare), HSTS `SECURE_HSTS_*`.
- **Database:** `DB_HOST/PORT/NAME/USER/PASSWORD`, `DB_SSLMODE`, `DB_SSLROOTCERT`, `DB_POOL_MAX_SIZE`.
- **Footprint:** `SCALE_WEB`, `GUNICORN_WORKERS`, `CELERY_CONCURRENCY`, `*_MEMORY_LIMIT`, `REDIS_MAXMEMORY`.
- **Ops:** `LOG_FORMAT` (json), `SENTRY_DSN` (+ sample rates), `BACKUP_KEEP`, `BACKUP_REMOTE`,
  `RCLONE_CONFIG_*`, `BACKUP_REMOTE_KEEP_DAYS`.
- **Push (G4):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

`.env` is parsed by `scripts/deploy/env.sh` (not sourced) with Compose's rules: quote values with
spaces; a `$` must be inside single quotes (it is refused otherwise, since Compose would interpolate it).
Optional overrides: `infra/compose/db-ca.yml` (CA for `DB_SSLMODE=verify-full`), `loopback-port.yml`,
`shared-tunnel-network.yml`.

## Day 2

[runbook.md](runbook.md): routine deploy, rollback (the deploy prints a concrete recipe), restore,
secret rotation, connection budget, owner checklist. [../backups.md](../backups.md): off-site
copies and `make prod-verify-backup`.

## Verified locally (production-mode dry run, tunnel mode, no host ports)

- `docker compose config -q`: 10 profile × override combinations plus the two tunnel overrides.
- Image build (runs `check --deploy` at build); `deploy-prod.sh` end to end with local images:
  refusals, plan, pre-migrate backup, migrate, rolling web (both replicas replaced), frontend copy,
  Caddy, smoke tests. A failing first attempt printed the rollback recipe (that run found the
  `ALLOWED_HOSTS` probe bug, now fixed).
- Through Caddy, as cloudflared would send it: `X-Request-ID` = `CF-Ray`; HSTS unchanged;
  `X-Forwarded-Proto: https` → 200, plain → 301, health exempt; login 5/min per client (A: 5×401
  then 429, B: 401; a forged `X-Forwarded-For` does not escape); D-9 gate 403 outside, 200 inside.
- External Postgres with TLS only (`hostnossl … reject`), `DB_SSLMODE=require`: migrate, web,
  celery and beat run; `pg_stat_ssl` shows TLSv1.3 on every app connection; the backup container
  dumps it too.
- Backups: pre-migrate dump, off-site copy through an rclone remote with `rclone check` = 0
  differences, no upload when unset, a corrupt dump caught, `verify_backup.sh` restores and runs the app.
- Not exercised locally: public mode with real 80/443 and ACME (ports are taken on this machine;
  the Caddyfile was validated with `caddy adapt` in both modes), a real Cloudflare tunnel, a real
  frontend build in the stack (a stub image stood in; the frontend gates ran separately).
