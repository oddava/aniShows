# aniShows deploy hand-off (for the Infra Architect)

Target: oddava's shared Hetzner VPS (8 GB / 4 cores, ~15 other containers), behind the host's
**existing reverse proxy** (it owns 80/443 and the certificates), domain `anishows.com`, with the
bundled or an external/shared Postgres. Nothing here has been deployed.

## What you need to provide

| Item | Notes |
|---|---|
| Docker Engine ≥ 25, Compose ≥ 2.20 | `depends_on.required: false` needs 2.20 |
| The host's reverse proxy | A site for `anishows.com` (+ `www` if wanted) that forwards to `http://127.0.0.1:8080` (below) |
| GHCR read access | `docker login ghcr.io` with a `read:packages` PAT (images `ghcr.io/oddava/anishows-{backend,frontend}`) |
| `.env` | From `.env.production.example`; fill every `<...>`, `chmod 600` |
| Optional: external Postgres 15+ | Role + database + `pg_trgm`; TLS (`DB_SSLMODE=require`); a connection limit (runbook) |
| Optional: off-site bucket | Target still to be decided; `BACKUP_REMOTE` + `RCLONE_CONFIG_*` ([../backups.md](../backups.md)) |

## Edge: proxy mode (the default)

```
client ──https──▶ host reverse proxy ──http──▶ 127.0.0.1:8080 ─▶ Caddy (container) ──▶ web / minio / SPA
                  (TLS, certificates)          (docker-proxy; Caddy sees the
                                                 gateway of APP_SUBNET as the peer)
```

`CADDY_MODE=proxy` (the template's value and the code default): Caddy serves plain HTTP on `:80`
inside the stack, runs no ACME, and is published on the host's loopback only
(`infra/compose/proxy-port.yml`: `${CADDY_PROXY_BIND:-127.0.0.1}:${CADDY_PROXY_PORT:-8080}`).
The app network has a fixed subnet, `APP_SUBNET` (default `10.250.250.0/25`; change it if it
overlaps a host network), so both trust lists can name it exactly.

**Two trust lists, no defaults.** `deploy-prod.sh` refuses to start without them; Compose itself
refuses the file without `TRUSTED_PROXY_CIDRS`. Each entry of `TRUSTED_PROXY_CIDRS` must lie inside
`APP_SUBNET`; `CADDY_TRUSTED_PROXIES` refuses anything wider than /16 (IPv6 /64) or
`private_ranges`, and warns below /24 (every container on such a network could set the client IP):

| Variable | Who it trusts | Value for the default layout |
|---|---|---|
| `CADDY_TRUSTED_PROXIES` | Peers whose `X-Forwarded-For` / `X-Forwarded-Proto` Caddy believes: the host's proxy, as Caddy sees it | `"10.250.250.1/32 127.0.0.1/8 ::1/128"` (the Docker gateway of `APP_SUBNET`: a host process reaching the published port arrives from there) |
| `TRUSTED_PROXY_CIDRS` | Peers whose `X-Forwarded-For` Django believes: Caddy | `10.250.250.0/25` (`APP_SUBNET`) |

Caddy reads `X-Forwarded-For` right to left past trusted peers (`trusted_proxies_strict`), so an
address a client puts in the header itself is ignored, and sends Django exactly one entry: the real
client. The deploy checks the chain from the host (`https` from the proxy must reach Django
without a redirect), and `PUBLIC_BASE_URL` checks it end to end.

**The host proxy's site.** It must append the client to `X-Forwarded-For` (not pass the client's
header through as is) and send the original scheme and host. nginx:

```nginx
server {
    listen 443 ssl;  http2 on;
    server_name anishows.com www.anishows.com;
    # ssl_certificate ... (the host's existing certificates)
    client_max_body_size 12m;                 # Caddy caps bodies at 12 MB too
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;   # WebSockets (/ws/)
        proxy_set_header Connection        $connection_upgrade;  # map $http_upgrade → upgrade/close
        proxy_read_timeout 120s;
    }
}
```

A host Caddy: `anishows.com, www.anishows.com { reverse_proxy 127.0.0.1:8080 }` (it sets these
headers by default). Traefik: a file-provider router to `http://127.0.0.1:8080`.

**The proxy runs as a container instead.** Set `CADDY_PROXY_PUBLISH=0` (no host port),
`COMPOSE_EXTRA_FILES="infra/compose/shared-proxy-network.yml"` and `PROXY_NETWORK=<its network>`:
Caddy joins that network as `anishows-caddy`; point the proxy at `http://anishows-caddy:80`, and
set `CADDY_TRUSTED_PROXIES` to the proxy container's fixed address on that network (an
`ipv4_address` in its compose file) plus `127.0.0.1/8 ::1/128`.

**HSTS** is sent by Caddy (and Django) with `max-age` only by default: `includeSubDomains` and
`preload` are off (`SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD`), because they reach
every subdomain of a domain other projects may share. If the host proxy adds its own
`Strict-Transport-Security`, keep one of them.

**Operator routes** (`/django-admin/`, `/metrics`, `/api/v1/health/ready/`): `ADMIN_ALLOW_CIDRS`
(space-separated, quoted). Empty (the template) = closed to every client (403); only Caddy's own
loopback (deploy smoke tests) gets through. Wide-open values are refused unless
`ALLOW_WIDE_ADMIN_CIDRS=1`.

## Other edge modes (optional)

| `.env` | Effect |
|---|---|
| `CADDY_MODE=tunnel` + `TUNNEL_TOKEN=…` | Cloudflare Tunnel with our own cloudflared (`tunnel` profile, pinned `2026.10.0@sha256:9b49…`); Caddy trusts `CF-Connecting-IP` only from the `edge` network (`EDGE_SUBNET`, default `10.250.250.240/29`). See [tunnel.md](tunnel.md) |
| `CADDY_MODE=tunnel` + `TUNNEL_EXTERNAL=1` + `COMPOSE_EXTRA_FILES="infra/compose/shared-tunnel-network.yml"` (or `loopback-port.yml`) | reuse an existing cloudflared; `CADDY_TRUSTED_PROXIES` = its address (required) |
| `CADDY_MODE=public` + `CADDY_ACME_EMAIL` | Caddy owns 80/443 (`infra/compose/public-ports.yml`) and runs ACME; also serves `infra/caddy/sites-public.d/` |

## Compose layout

`docker-compose.prod.yml` publishes **no host ports**; `deploy-prod.sh` adds profiles and override
files from `.env`:

| `.env` | Effect |
|---|---|
| `CADDY_MODE=proxy` (default) | `infra/compose/proxy-port.yml`: Caddy on `127.0.0.1:8080` |
| `DB_HOST=db` (default) | `bundled-db` profile (Postgres 18, volume `<project>_db_data`) |
| `DB_HOST=<host>` + `DB_SSLMODE=require` | external Postgres; no db container; backups dump that host |
| `UMAMI_DOMAIN` set (or `ANALYTICS_ENABLED=1`) | `analytics` profile (Umami); off by default in the template |

Services: `web` (gunicorn + uvicorn workers; HTTP and WebSockets), `celery`, `beat`, `redis`,
`minio` (media, served read-only by Caddy under `/media/`), `createbuckets`, `caddy`, `backup`
(daily 03:00 cron), plus the optional `db`, `cloudflared`, `umami`, `umami_db`. Compose project
name = directory name, unless `COMPOSE_PROJECT_NAME` is set. Every container's logs rotate
(5 × 10 MB). Memory limits are env-driven; the runbook has the footprint.

## Deploy

```bash
git clone <repo> aniShows && cd aniShows
cp .env.production.example .env && chmod 600 .env && $EDITOR .env
docker login ghcr.io
./deploy-prod.sh            # refuses placeholder secrets, bad ALLOWED_HOSTS and an unconfigured edge first
scripts/deploy/compose.sh exec web python manage.py createsuperuser
```

**Every manual compose command goes through `scripts/deploy/compose.sh`** (same `.env` parsing,
profiles, override files and derived `CADDY_*` as the deploy; it warns when the edge is not
configured). A bare `docker compose -f docker-compose.prod.yml up` that recreates Caddy would
lose the mode's derived values.

Then check from outside: `curl -sI https://anishows.com/api/v1/genres/` answers without a
redirect; log in from two networks and see separate throttles; Caddy's access log shows the real
`client_ip`. Uptime: a monitor on `GET https://anishows.com/api/v1/health/` (always 200 while
the process is up; `/api/v1/health/ready/` is the dependency check and sits behind
`ADMIN_ALLOW_CIDRS`).

CI (`.github/workflows/deploy.yml`) still targets the old host (`EC2_*` secrets) and calls the same
script. Point those secrets at the new box when you switch over.

## Env, grouped (full list: `.env.production.example`)

- **Must set:** `DJANGO_SECRET_KEY` (≥ 50 chars), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`,
  `CSRF_TRUSTED_ORIGINS`, `DOMAIN_NAME`, `FRONTEND_URL`, `DB_PASSWORD`, `REDIS_PASSWORD`,
  `AWS_SECRET_ACCESS_KEY` (MinIO root), `METRICS_PASSWORD` (≥ 12, or empty to disable `/metrics`),
  `RESEND_API_KEY`, `TRUSTED_PROXY_CIDRS`, `CADDY_TRUSTED_PROXIES` (proxy mode).
- **Edge:** `CADDY_MODE`, `CADDY_PROXY_BIND`, `CADDY_PROXY_PORT`, `CADDY_PROXY_PUBLISH`,
  `PROXY_NETWORK`, `APP_SUBNET`, `ADMIN_ALLOW_CIDRS`, `PUBLIC_BASE_URL` (post-deploy smoke through
  the host's proxy), HSTS `SECURE_HSTS_*`; tunnel mode: `TUNNEL_TOKEN`, `TUNNEL_EXTERNAL`,
  `TUNNEL_NETWORK`, `EDGE_SUBNET`.
- **Database:** `DB_HOST/PORT/NAME/USER/PASSWORD`, `DB_SSLMODE`, `DB_SSLROOTCERT`, `DB_POOL_MAX_SIZE`.
- **Footprint:** `SCALE_WEB`, `GUNICORN_WORKERS`, `CELERY_CONCURRENCY`, `*_MEMORY_LIMIT`, `REDIS_MAXMEMORY`.
- **Ops:** `LOG_FORMAT` (json), `SENTRY_DSN` (+ sample rates), `BACKUP_KEEP`, `BACKUP_REMOTE`,
  `RCLONE_CONFIG_*`, `BACKUP_REMOTE_KEEP_DAYS`.
- **Push (G4):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

`.env` is parsed by `scripts/deploy/env.sh` (not sourced) with Compose's rules: quote values with
spaces; a `$` must be inside single quotes (it is refused otherwise, since Compose would interpolate it).
Optional overrides: `infra/compose/db-ca.yml` (CA for `DB_SSLMODE=verify-full`),
`shared-proxy-network.yml`, `loopback-port.yml`, `shared-tunnel-network.yml`.

## Day 2

[runbook.md](runbook.md): routine deploy, rollback (the deploy prints a concrete recipe), restore,
secret rotation, connection budget, owner checklist. [../backups.md](../backups.md): local backups,
`make prod-verify-backup`, and the optional off-site copy.

## Verified locally

- Release candidate (this branch): `Caddyfile.prod` validated with the pinned Caddy (2.11.2,
  `caddy adapt --validate`) in proxy, public and tunnel mode; the deploy script's refusals and
  derived values for proxy mode are covered by `apps/core/tests/test_deploy_checks.py` (fake
  docker). Proxy mode has not been run end to end against a real host proxy: run the outside
  checks above after the first deploy.
- Earlier production-mode dry run (G7, tunnel mode, no host ports): `docker compose config -q` for
  the profile × override combinations; image build (runs `check --deploy`); `deploy-prod.sh` end
  to end with local images (refusals, plan, pre-migrate backup, migrate, rolling web, frontend copy,
  Caddy, smoke tests, the rollback recipe on failure); `X-Forwarded-Proto: https` → 200, plain →
  301, health exempt; login 5/min per client with a forged `X-Forwarded-For` not escaping; the D-9
  gate; external Postgres with TLS only; backups (pre-migrate dump, `verify_backup.sh` restore).
