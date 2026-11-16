# Production runbook

Everything runs from the repo root on the server. `deploy-prod.sh` is the only deploy path; CI
(`.github/workflows/deploy.yml`) calls it over SSH after the images are pushed. Edge modes and the
proxy chain: [tunnel.md](tunnel.md). Backups: [../backups.md](../backups.md). Every variable:
`.env.production.example`.

**Manual compose commands: always `scripts/deploy/compose.sh …`** (short form below: `PROD`).
It reads `.env` exactly as the deploy does and adds the mode's override files, profiles and the
derived `CADDY_*` values. A bare `docker compose -f docker-compose.prod.yml up …` that touches
Caddy recreates it with public-mode defaults: behind the tunnel that is a redirect loop and one
client IP for everyone. Prefer `--no-deps` for single services.

## What a deploy does

1. Refuses unsafe `.env` values before touching anything: a placeholder or short `DJANGO_SECRET_KEY`,
   `METRICS_PASSWORD`, `DB_PASSWORD`, `REDIS_PASSWORD`, `AWS_SECRET_ACCESS_KEY` (the MinIO root
   password), and the Umami secrets when analytics is on. Also `ALLOWED_HOSTS` that is unset,
   local-only, `*`, or missing `DOMAIN_NAME`'s host, and tunnel mode without a token.
   `ALLOW_INSECURE_DEFAULTS=1` lets one run through with a warning.
2. `docker compose config` for the chosen mode, pull images, start redis/minio (and the bundled db).
3. `manage.py check --deploy --fail-level ERROR` (e.g. `core.E010` stops it), then the AniList
   smoke query.
4. `migrate --plan`, saved to `backups-data/deploy-logs/deploy-<ts>-migrate-plan.txt`. If anything
   is planned, a database-only `pre-migrate` backup first (`BACKUP_KEEP_PRE_MIGRATE`, default 3).
5. `migrate`, then workers, then web replicas replaced one at a time (a new replica must be healthy
   before an old one gets SIGTERM).
6. Frontend files copied over the old build (old chunks stay a week), cache clear, Caddy reload,
   cloudflared.
7. Smoke tests: liveness and the SPA through Caddy, readiness from a web replica, then
   `PUBLIC_BASE_URL` through Cloudflare (a 301/308 on `/api/v1/health/` fails it: a redirect loop).

The whole run is logged to `backups-data/deploy-logs/deploy-<ts>.log`.

**Releases.** After a successful deploy, `backups-data/deployed.env` records the image tags
that are live (and the previous ones). `scripts/deploy/compose.sh`, `make prod-verify-backup`
and the rollback recipe use them, so manual commands never run a stale `:latest`. Old images of
this project are pruned after each deploy, keeping the current and previous release and anything
a container uses (`scripts/deploy/prune_images.sh`; `PRUNE_IMAGES=0` turns it off).

**Backup health.** Every scheduled run logs to `$PROD logs backup`. The container turns
*unhealthy* (`$PROD ps`) when no daily/manual backup has succeeded for 26 h
(`BACKUP_MAX_AGE_HOURS`). Point your uptime/alerting at that, or check it after each deploy.

## First deploy (new host)

1. Docker Engine ≥ 25 with Compose ≥ 2.20 (`depends_on.required: false`): `docker compose version`.
2. `git clone` the repo; `cp .env.production.example .env && chmod 600 .env`; fill every `<...>`.
   Generate secrets with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
3. Pick the database:
   - bundled: keep `DB_HOST=db` (the `bundled-db` profile starts Postgres 18 in the stack);
   - external/shared: set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
     `DB_SSLMODE=require` (or `verify-full` + `DB_SSLROOTCERT` mounted into the containers), and
     size the connection budget (below). Create the role and database first:
     `CREATE ROLE anishows LOGIN PASSWORD '…' CONNECTION LIMIT 60; CREATE DATABASE anishows_db OWNER anishows;`
     For `verify-full`, put the server's CA on the host and set `DB_CA_FILE`, `DB_SSLROOTCERT=/etc/anishows/db-ca.pem`
     and `COMPOSE_EXTRA_FILES="infra/compose/db-ca.yml"` (it mounts the CA into web, celery, beat and backup).
     The app needs the `pg_trgm` extension (its migrations create it). On a managed server
     without superuser, run `CREATE EXTENSION pg_trgm;` as an admin first.
4. Pick the edge (tunnel.md): `CADDY_MODE=tunnel` + `TUNNEL_TOKEN`, or a shared/host cloudflared.
   In the Cloudflare dashboard, set SSL/TLS to **Full (strict)** and enable "Always Use HTTPS".
   **Public mode behind Cloudflare's proxy** (orange cloud, no tunnel) needs Caddy to trust
   Cloudflare's edge, or every visitor shares the PoP's IP (one throttle bucket per PoP, D-9 useless):
   set `CADDY_TRUSTED_PROXIES` to Cloudflare's ranges (https://www.cloudflare.com/ips/, space-separated,
   plus `127.0.0.1/8 ::1/128`) and block 80/443 from other sources at the firewall. Simpler: use
   DNS-only records in public mode, or the tunnel.
5. `docker login ghcr.io` (a PAT with `read:packages`), then `./deploy-prod.sh`.
6. Create the first admin: `$PROD exec web python manage.py createsuperuser`.
7. Run the R-a checks in tunnel.md (no loop, per-client throttles), then `make prod-verify-backup`
   after the first nightly backup.

## Routine deploy

Push to `main` (CI), or on the server: `git pull --ff-only && ./deploy-prod.sh`. Pin a release with
`BACKEND_TAG=sha-<7 chars> FRONTEND_TAG=sha-<7 chars> ./deploy-prod.sh`.

## Rollback

A failure after the migration step prints a recipe with the concrete names. In general:

1. **Web roll failed:** nothing to do. The old replicas keep serving (the new one is removed).
2. **New code is bad, schema is fine:** re-deploy the previous image. The deploy prints its id:
   `docker tag <id> ghcr.io/oddava/anishows-backend:rollback && BACKEND_TAG=rollback SKIP_PULL=1 SKIP_ANILIST_SMOKE=1 ./deploy-prod.sh`
   (`SKIP_PULL=1`: the `rollback` tag exists only on this host.)
   (or `BACKEND_TAG=sha-<previous>`).
3. **The old code cannot run on the new schema:** undo this deploy's migrations with the *new*
   image (it has the migration files; every fan-out migration is reversible by policy), then do step 2:
   `$PROD run --rm --no-deps web python manage.py migrate <app> <migration before the plan>`.
   The plan file lists exactly which migrations were applied.
4. **Last resort, data damage:** restore the pre-migrate dump. Stop web/celery/beat first:
   `$PROD stop web celery beat && $PROD exec backup /app/shell/restore.sh <ts>-pre-migrate --yes --skip-media`.
   With the bundled db, restore swaps databases and keeps the old one as `rollback_*`. On an external
   server the role needs CREATEDB for that; otherwise restore with `pg_restore --clean` as the owner.

## Restore drill and verification

`make prod-verify-backup [TIMESTAMP=…]` restores a dump into a throwaway Postgres on the compose
network and runs `check`, `showmigrations` and a row count against it. It never touches the live
database. Run it after the first backup, and monthly.

## Rotating secrets

| Secret | How |
|---|---|
| `DJANGO_SECRET_KEY` | Change in `.env`, `./deploy-prod.sh`. Logs everyone out and invalidates reset/verify links and JWTs. |
| A value with `$` or `\` | `.env` refuses them outside single quotes (Compose would expand them). Quoting an existing value that Compose had been expanding changes its effective value: for `DJANGO_SECRET_KEY` that logs everyone out, for a DB/Redis password it must match the server's. |
| `DB_PASSWORD` (bundled) | `$PROD exec db psql -U <user> -c "ALTER ROLE <user> PASSWORD '…'"`, then `.env`, deploy. |
| `REDIS_PASSWORD` | `.env`, then `$PROD up -d --no-deps redis` and deploy (the cache and queued tasks are lost). |
| `AWS_SECRET_ACCESS_KEY` (MinIO root) | `.env`, `$PROD up -d --no-deps minio`, deploy. |
| `METRICS_PASSWORD` | `.env`, deploy; update the Prometheus scrape config. |
| `TUNNEL_TOKEN` | Cloudflare dashboard → tunnel → refresh token, `.env`, `$PROD up -d --no-deps cloudflared`. |
| `RCLONE_CONFIG_*` | `.env`, `$PROD up -d --no-deps backup` (the cron env file is rebuilt at start). |

## Footprint on a shared 8 GB / 4-core host

The limits are caps, not reservations. Measured idle in the dry run with one gunicorn worker: web
~190 MB per replica, celery ~175 MB, beat ~115 MB, minio ~110 MB, Postgres ~45–70 MB, backup ~45 MB,
Caddy ~15 MB, Redis ~6 MB. Each extra gunicorn worker adds roughly 100–120 MB.

| Service | Default limit | Shared-host profile | Variable |
|---|---|---|---|
| web × `SCALE_WEB` (+1 during a roll) | 768M × 2 | 512M × 2, `GUNICORN_WORKERS=2` | `WEB_MEMORY_LIMIT` |
| celery | 1G (concurrency 2) | 640M, `CELERY_CONCURRENCY=1` | `CELERY_MEMORY_LIMIT` |
| beat | 256M | 192M | `BEAT_MEMORY_LIMIT` |
| db (bundled only) | 1G | 0 with an external DB, else 768M | `DB_MEMORY_LIMIT` |
| redis | 512M (`maxmemory` 256mb) | 256M, `REDIS_MAXMEMORY=128mb` | `REDIS_MEMORY_LIMIT` |
| minio | 256M | 256M | `MINIO_MEMORY_LIMIT` |
| caddy | 256M | 128M | `CADDY_MEMORY_LIMIT` |
| cloudflared (tunnel profile) | 128M | 128M | `CLOUDFLARED_MEMORY_LIMIT` |
| backup | 256M | 256M | `BACKUP_MEMORY_LIMIT` |
| umami + umami_db (analytics) | 512M + 256M | off | `UMAMI_*_MEMORY_LIMIT` |
| **Total (bundled db, no analytics)** | **≈ 5.2 GB** (6.0 GB during a roll) | **≈ 3.0 GB** (3.5 GB during a roll; ≈ 2.3 GB with an external DB) | |

Container logs rotate at 5 × 10 MB per container (`LOG_MAX_SIZE`, `LOG_MAX_FILE`).
`docker image prune` after a deploy only removes images labelled `app.anishows.component`
(`PRUNE_IMAGES=0` turns it off), so other projects' images are never touched.

## Database connection budget (external/shared Postgres)

Each process holds at most `DB_POOL_MAX_SIZE` connections (psycopg pool, default 5 in compose):

```
connections ≤ DB_POOL_MAX_SIZE × (GUNICORN_WORKERS × (SCALE_WEB + 1) + CELERY_CONCURRENCY + 2)
              (+1 replica during a roll; +2 for the celery parent and beat)
```

With the template (`DB_POOL_MAX_SIZE=5`, `GUNICORN_WORKERS=2`, `SCALE_WEB=2`, `CELERY_CONCURRENCY=2`):
5 × (2 × 3 + 2 + 2) = 50, plus about 10 for migrations, backups and `manage.py` runs, so cap our
share on the server at 60: `ALTER ROLE anishows CONNECTION LIMIT 60`. The shared-host profile
(`CELERY_CONCURRENCY=1`) needs 45 + 10.
`core.W002` (`check --deploy`) warns when an external host runs without the pool. With the bundled
db the same budget applies against Postgres' `max_connections` (100).

## Owner checklist (decisions before the first deploy)

| # | Decision | Where |
|---|---|---|
| G7 Q1 ⚑ | HSTS `includeSubDomains` + `preload` on anishows.com: they cover every subdomain, and preload is hard to undo. Default: on (unchanged). | `SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD` |
| G7 Q2 ⚑ | Off-site backup target: Hetzner Object Storage (S3), a Storage Box (SFTP), or none. | `BACKUP_REMOTE`, `RCLONE_CONFIG_*` |
| D-9 ⚑ | Real CIDRs for `/metrics`, readiness, `/django-admin/`. Default: open. | `ADMIN_ALLOW_CIDRS` |
| D-1 | Session auth flag (G1). | G1 settings |
| D-2, D-4, D-6 | Adult direct links, email defaults, deleted users' forum posts. | specs 2, 4, 5 |
| D-8 | Drop the `django_celery_beat` tables at first deploy? | manual SQL after the deploy |
| adult rule | `ADULT_RULE` legacy → anilist? | integrator |
