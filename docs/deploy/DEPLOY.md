# Deploying aniShows to the Hetzner VPS

Target: oddava's shared Hetzner VPS (8 GB / 4 cores, other projects' containers alongside),
behind the host's **existing reverse proxy** (it owns ports 80/443 and the certificates), domain
`anishows.com`, with the bundled Postgres (or an external one). The stack's own Caddy listens on
the host's loopback only; nothing of ours is published to the internet directly.

```
browser ──https──▶ host reverse proxy ──http──▶ 127.0.0.1:8080 ──▶ Caddy (container) ──▶ web / RustFS (media) / SPA
                   (TLS, certificates)          (docker-proxy: Caddy sees the
                                                 gateway of APP_SUBNET as the peer)
```

Steps 1–8 are a fresh install, in order. Day-2 operations are in [runbook.md](runbook.md);
backups in [../backups.md](../backups.md); every variable in `.env.production.example`.

## 1. What you need

| Item | Notes |
|---|---|
| Docker Engine ≥ 25, Compose ≥ 2.20 | `docker compose version` (`depends_on.required: false` needs 2.20). `git`, `curl`, `flock` (util-linux) and `make` (for the `make prod-*` shortcuts) on the host |
| A Linux user for the app | In the `docker` group; owns the checkout. The GitHub deploy logs in as this user |
| The host's reverse proxy | nginx or Caddy (examples in [host-proxy/](host-proxy/)); DNS for `anishows.com` (+ `www`) points at the VPS |
| GHCR read access | Images `ghcr.io/oddava/anishows-{backend,frontend}` are built by the Deploy workflow; the server needs `docker login ghcr.io` (step 2) unless the packages are public |
| About 3 GB of memory headroom | The lean default profile: [runbook.md](runbook.md#footprint-on-a-shared-8-gb--4-core-host) |
| The host's RustFS, provisioned by infra | Object storage is **not** part of this stack. Infra creates, once: the Docker network `anishows-s3` (internal only, RustFS attached as `rustfs:9000`), the bucket `anishows-media`, a bucket-scoped user `anishows` (read/write on that bucket only) and anonymous `GetObject` on `anishows-media/media/*` only. Step 4 lists the values; the deploy checks all of it (`manage.py s3_check`) before changing anything |
| Optional: an off-site backup target | Hetzner Storage Box or Backblaze B2 (step 7) |
| Optional: external Postgres 15+ | Role + database + `pg_trgm`; TLS; a connection limit ([runbook.md](runbook.md#first-deploy-new-host)) |

## 2. Prepare the server

As the app user (e.g. `anishows`; any path works, it becomes `VPS_APP_DIR`):

```bash
# Repo access. Private repo: a read-only deploy key for this server
#   ssh-keygen -t ed25519 -f ~/.ssh/anishows_repo -N '' -C anishows-vps
#   GitHub → repo Settings → Deploy keys → Add (read-only), then in ~/.ssh/config:
#     Host github.com
#       IdentityFile ~/.ssh/anishows_repo
sudo mkdir -p /srv/anishows && sudo chown "$USER": /srv/anishows
git clone git@github.com:oddava/aniShows.git /srv/anishows   # public repo: https://github.com/oddava/aniShows.git
cd /srv/anishows

# Registry: a classic PAT with only read:packages (stored in ~/.docker/config.json).
docker login ghcr.io -u <github-user>
```

The checkout is moved between releases with `git checkout --detach <commit>` by the deploy; do not
edit tracked files on the server (the deploy refuses to run over local edits). `.env` and
`backups-data/` are untracked and never touched by git.

## 3. The host proxy's site

Add a site for `anishows.com` (and `www`) that forwards to `http://127.0.0.1:8080`:

- nginx: [host-proxy/nginx.conf](host-proxy/nginx.conf) (`nginx -t && systemctl reload nginx`)
- Caddy: [host-proxy/Caddyfile](host-proxy/Caddyfile) (`caddy validate … && systemctl reload caddy`)

Both were validated with the real binaries and the nginx one was run end to end (below). What
matters in any proxy: it **appends** the client to `X-Forwarded-For` (never passes a client's own
header through), sends `X-Forwarded-Proto` with the scheme it saw, passes `Host`, and upgrades
WebSockets (`/ws/`). Until the stack runs, the site answers 502.

## 4. `.env`

```bash
cp .env.production.example .env && chmod 600 .env && $EDITOR .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # one per secret
```

Fill every `<...>`. The deploy refuses placeholders and wrong edge values before it changes
anything. For this host:

| Variable | Value |
|---|---|
| `DJANGO_SECRET_KEY` | 64+ random characters |
| `ALLOWED_HOSTS` | `anishows.com,www.anishows.com` |
| `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `DOMAIN_NAME`, `S3_PUBLIC_DOMAIN` | the template's `anishows.com` values |
| `CADDY_MODE` | `proxy` |
| `CADDY_TRUSTED_PROXIES` | `"10.250.250.1/32 127.0.0.1/8 ::1/128"` (the Docker gateway of `APP_SUBNET`: the host proxy arrives from there) |
| `TRUSTED_PROXY_CIDRS` | `10.250.250.0/25` (`APP_SUBNET`) |
| `APP_SUBNET` | leave unset (`10.250.250.0/25`) unless it overlaps a network on the host (`docker network inspect` / `ip route`); then change it and both trust lists with it |
| `ADMIN_ALLOW_CIDRS` | empty = `/django-admin/`, `/metrics`, readiness closed to everyone (403). To use the admin: your IP, e.g. `"203.0.113.10/32"` |
| `PUBLIC_BASE_URL` | `https://anishows.com` (the deploy smoke-tests through the host proxy) |
| `DB_PASSWORD`, `REDIS_PASSWORD`, `METRICS_PASSWORD` | random (`METRICS_PASSWORD` empty disables `/metrics`) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the `anishows` user's credentials, from infra (the secret is not yours to generate) |
| `AWS_STORAGE_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`, `AWS_S3_REGION_NAME`, `S3_PUBLIC_DOMAIN`, `S3_PUBLIC_USE_SSL`, `S3_NETWORK` | the template's values (`anishows-media`, `http://rustfs:9000`, `us-east-1`, `anishows.com`, `True`, `anishows-s3`) |
| `RESEND_API_KEY`, `DEFAULT_FROM_EMAIL` | from resend.com, with `anishows.com` verified there (sign-up, password-reset mail) |
| Optional | `GOOGLE_CLIENT_ID/SECRET`, `SENTRY_DSN`, `VAPID_*`, `MAL_CLIENT_ID`, `BACKUP_REMOTE` + `RCLONE_CONFIG_*` (step 7) |

`.env` is parsed by `scripts/deploy/env.sh`, not sourced, with Compose's rules: quote values with
spaces; a `$` or `\` only inside single quotes.

## 5. First deploy

The images come from the Deploy workflow, so the first deploy is a workflow run too:

1. Set up the GitHub side once ([Deploying from GitHub Actions](#deploying-from-github-actions)).
2. Actions → **Deploy (Hetzner VPS)** → Run workflow on `main`.

It runs CI, builds and pushes `sha-<commit>` images, then on the server checks out that commit
and runs `./deploy-prod.sh`: the refusals, `check --deploy`, the migration plan (and a database
backup first whenever migrations are planned), `migrate`, workers, web, the frontend files,
Caddy, and the smoke tests (liveness, readiness, the SPA, `https` through `127.0.0.1:8080`
without a redirect, then `PUBLIC_BASE_URL`). The workflow then checks
`https://anishows.com/api/v1/health/` from outside. Static files are collected in the image
build; nothing else is needed for them.

The same from a shell on the server (images already in GHCR for that commit):

```bash
cd /srv/anishows && git fetch && git checkout --detach <commit>
BACKEND_TAG=sha-<first 7 chars> FRONTEND_TAG=sha-<first 7 chars> ./deploy-prod.sh
```

The whole run is logged to `backups-data/deploy-logs/`. Every later manual compose command goes
through `scripts/deploy/compose.sh` (the same `.env` parsing, profiles and derived `CADDY_*`
values as the deploy); a bare `docker compose -f docker-compose.prod.yml up` that recreates
Caddy would lose them.

## 6. Admin account and the outside checks

```bash
scripts/deploy/compose.sh exec web python manage.py createsuperuser
```

The Django admin is at `https://anishows.com/django-admin/` from an address in
`ADMIN_ALLOW_CIDRS` only (change it in `.env`, then `./deploy-prod.sh` again).

From a machine **outside** the VPS:

```bash
curl -sI https://anishows.com/api/v1/health/                # 200
curl -sI https://anishows.com/api/v1/genres/                # 200, not 301/308 (no redirect loop)
curl -sI http://anishows.com/ | head -1                     # 301 to https (the host proxy)
curl -s -o /dev/null -w '%{http_code}\n' https://anishows.com/django-admin/   # 403 unless your IP is allowed
curl -s -o /dev/null -w '%{http_code}\n' https://anishows.com/metrics         # 403
# Login throttle is per client: from one address the 6th bad login in a minute is 429,
# and forging X-Forwarded-For does not escape it:
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Origin: https://anishows.com' -H 'Content-Type: application/json' -H "X-Forwarded-For: 198.51.100.$i" \
  -d '{"username":"nobody","password":"wrong"}' https://anishows.com/api/v1/auth/login/; done; echo
```

Then sign in through the site in a browser (the refresh cookie is `Secure; HttpOnly;
SameSite=Lax`), and on the server check Caddy's access log shows real client addresses:
`scripts/deploy/compose.sh exec caddy tail -n 3 /var/log/caddy/access.log` (`client_ip` is the
visitor; `remote_ip` is `10.250.250.1`, the host proxy). An uptime monitor goes on
`GET https://anishows.com/api/v1/health/`.

## 7. Backups

Local backups run in the `backup` container every night at 03:00 (`BACKUP_SCHEDULE`), keep
`BACKUP_KEEP` (7) daily/manual copies plus `BACKUP_KEEP_PRE_MIGRATE` (3) pre-migrate dumps, and
the container turns unhealthy after 26 h without a successful one. After the first one:

```bash
make prod-backup            # one now
make prod-verify-backup     # restore the newest into a throwaway Postgres and run the app against it
```

**Off-site copy (optional).** With `BACKUP_REMOTE` empty every run logs
`Off-site upload skipped: BACKUP_REMOTE is empty` and nothing else happens. To turn it on, add the
remote to `.env`, then `scripts/deploy/compose.sh up -d --no-deps backup` and
`make prod-offsite-list` (it must list, empty at first, without an error):

Hetzner Storage Box (SFTP; enable SSH support on the box first):

```env
BACKUP_REMOTE=offsite:anishows-backups
RCLONE_CONFIG_OFFSITE_TYPE=sftp
RCLONE_CONFIG_OFFSITE_HOST=uXXXXXX.your-storagebox.de
RCLONE_CONFIG_OFFSITE_USER=uXXXXXX
RCLONE_CONFIG_OFFSITE_PORT=23
# the output of: docker run --rm rclone/rclone obscure '<storage box password>'
RCLONE_CONFIG_OFFSITE_PASS=<obscured password>
```

Backblaze B2 (an application key limited to one bucket):

```env
BACKUP_REMOTE=offsite:<bucket>/anishows
RCLONE_CONFIG_OFFSITE_TYPE=b2
RCLONE_CONFIG_OFFSITE_ACCOUNT=<keyID>
RCLONE_CONFIG_OFFSITE_KEY=<applicationKey>
```

Each backup is then uploaded, checked against the local files, and remote copies older than
`BACKUP_REMOTE_KEEP_DAYS` (30) are deleted; only the dated directories the backup created are ever
touched. A failed upload keeps the local backup and fails the run (it shows in `compose logs
backup` and the container's health). Give the credentials access to that bucket/directory only,
and turn on bucket versioning or a Storage Box snapshot plan if available: a compromised host can
otherwise delete its own off-site copies. More: [../backups.md](../backups.md).

**Restore** (tested, see below): `scripts/deploy/restore.sh` / `make prod-restore`.

```bash
scripts/deploy/restore.sh latest                       # verify only: checksums + a test restore, changes nothing
scripts/deploy/restore.sh latest --yes                 # restore the newest daily/weekly/manual backup
scripts/deploy/restore.sh 20261116_030000 --yes        # a given one (timestamp or directory name)
scripts/deploy/restore.sh latest --from-offsite --yes  # a new host, or the local copies are gone
```

It stops web, celery and beat (the site answers 502 meanwhile; Caddy stays up), takes a
pre-restore snapshot of the live data, restores the dump into a staging database and swaps it in
by name (the old database stays as `rollback_<timestamp>`), restores media, runs `migrate`,
starts the app again (also when a step failed), clears the cache and waits for readiness. Drop
the `rollback_*` database when satisfied:
`scripts/deploy/compose.sh exec db psql -U <DB_USER> -d postgres -c 'DROP DATABASE "rollback_…"'`.
On an external Postgres the role needs CREATEDB for the swap ([../backups.md](../backups.md)).

## 8. Updates and rollback

**Deploy a new version:** Actions → Deploy (Hetzner VPS) → Run workflow on `main`. Nothing deploys
on push. One deploy runs at a time (the workflow's `deploy-production` concurrency group and the
server's `backups-data/.deploy.lock`); a running deploy is never cancelled.

**Rollback:**

- *Web did not come up:* nothing to do; the old replica keeps serving and the deploy fails.
- *The new release is bad:* run the workflow with **rollback_to** = the previous commit. Its
  7-character SHA is in `backups-data/deployed.env` as `PREVIOUS_BACKEND_TAG=sha-<7 chars>` (the
  release before the live one; `BACKEND_TAG` is the live one), or in the previous successful run of
  the Deploy workflow. CI and the build are skipped; that commit's images are already in GHCR.
  Without GitHub: the local-image recipe with `PREVIOUS_*_IMAGE_ID` ([runbook.md](runbook.md#rollback), step 2).
- *Its migrations must be undone too*, or anything else: the failed deploy prints a recipe with the
  concrete image ids and migration names; [runbook.md](runbook.md#rollback) has the steps,
  including restoring the pre-migrate dump.

### Deploying from GitHub Actions

`.github/workflows/deploy.yml` runs only by hand (`workflow_dispatch`). Set up once:

1. **A deploy key for the workflow** (on your PC):
   `ssh-keygen -t ed25519 -f anishows_deploy -N '' -C github-anishows-deploy`. Append
   `anishows_deploy.pub` to `~/.ssh/authorized_keys` of the app user on the VPS.
2. **The server's host key**, pinned (no trust-on-first-use): `ssh-keyscan -p <port> <host>`, and
   compare its fingerprint (`ssh-keygen -lf -`) with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
   run on the server.
3. **Secrets** (repo Settings → Environments → `production`, or repository secrets):

   | Secret | Value |
   |---|---|
   | `VPS_HOST` | the VPS hostname or IP |
   | `VPS_USER` | the app user (in the `docker` group) |
   | `VPS_SSH_KEY` | the private key `anishows_deploy` (whole file) |
   | `VPS_SSH_KNOWN_HOSTS` | the `ssh-keyscan` lines from step 2 |
   | `VPS_APP_DIR` | the checkout, e.g. `/srv/anishows` |
   | `VPS_SSH_PORT` | optional, default 22 |
   | `VITE_GOOGLE_CLIENT_ID`, `VITE_SENTRY_DSN`, `VITE_UMAMI_SCRIPT_URL`, `VITE_UMAMI_WEBSITE_ID` | optional, baked into the frontend build (Google sign-in needs the first) |

   The images are pushed with the workflow's own `GITHUB_TOKEN`; no registry secret is needed.
   Both the build job (it bakes in the `VITE_*` values) and the deploy job run in the
   `production` environment, so environment secrets reach both. Optional: required reviewers on
   `production` (a run then asks twice: before the build and before the deploy).
4. The server is ready (steps 2–4 above: checkout, `docker login ghcr.io`, `.env`, host proxy).

A run: CI on the commit → images `sha-<7>` and `latest` → SSH to `vps`, which pipes
`scripts/deploy/remote_deploy.sh` into `bash`: it refuses local edits to tracked files, takes the
deploy lock (a manual deploy or restore in progress makes it stop before the checkout moves),
fetches, checks out the commit (detached) and runs `deploy-prod.sh` with that commit's tags,
detached from the SSH session, streaming its output → the public health check. A failure names
the previous checkout to go back to. If the runner loses the connection, the deploy still
finishes on the server: its output is in `backups-data/deploy-logs/remote-<time>-<sha>.out` (and
`deploy-<time>.log`); check it there before running the workflow again.

## Edge reference

**Two trust lists, no defaults.** `deploy-prod.sh` refuses to start without them; Compose itself
refuses the file without `TRUSTED_PROXY_CIDRS`. Each entry of `TRUSTED_PROXY_CIDRS` must lie inside
`APP_SUBNET`; `CADDY_TRUSTED_PROXIES` refuses anything wider than /16 (IPv6 /64) or
`private_ranges`, and warns below /24:

| Variable | Who it trusts | Default layout |
|---|---|---|
| `CADDY_TRUSTED_PROXIES` | Peers whose `X-Forwarded-For` / `X-Forwarded-Proto` Caddy believes: the host proxy as Caddy sees it | `"10.250.250.1/32 127.0.0.1/8 ::1/128"` |
| `TRUSTED_PROXY_CIDRS` | Peers whose `X-Forwarded-For` Django believes: Caddy | `10.250.250.0/25` |

Caddy reads `X-Forwarded-For` right to left past trusted peers (`trusted_proxies_strict`), so an
address a client puts in the header is ignored, and sends Django exactly one entry: the client.

**The proxy runs as a container instead.** Set `CADDY_PROXY_PUBLISH=0` (no host port),
`COMPOSE_EXTRA_FILES="infra/compose/shared-proxy-network.yml"` and `PROXY_NETWORK=<its network>`:
Caddy joins that network as `anishows-caddy`; point the proxy at `http://anishows-caddy:80`, and
set `CADDY_TRUSTED_PROXIES` to the proxy container's fixed address on that network (an
`ipv4_address` in its compose file) plus `127.0.0.1/8 ::1/128`.

**HSTS** is sent by Caddy and Django with `max-age` only: `includeSubDomains` and `preload` are
off (`SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD`) because they reach every subdomain of
a domain other projects may share. If the host proxy adds its own header, keep one of them.

**Operator routes** (`/django-admin/`, `/metrics`, `/api/v1/health/ready/`): `ADMIN_ALLOW_CIDRS`
(space-separated, quoted). Empty = closed to every client (403); only Caddy's own loopback (the
deploy's smoke tests) gets through. Wide-open values are refused unless `ALLOW_WIDE_ADMIN_CIDRS=1`.

**Other modes (optional):** `CADDY_MODE=tunnel` + `TUNNEL_TOKEN` (Cloudflare Tunnel, see
[tunnel.md](tunnel.md)); `CADDY_MODE=public` + `CADDY_ACME_EMAIL` (Caddy owns 80/443 and runs ACME,
`infra/compose/public-ports.yml`).

## Compose layout

`docker-compose.prod.yml` publishes **no host ports**; `deploy-prod.sh` adds profiles and override
files from `.env`:

| `.env` | Effect |
|---|---|
| `CADDY_MODE=proxy` (default) | `infra/compose/proxy-port.yml`: Caddy on `127.0.0.1:8080` |
| `DB_HOST=db` (default) | `bundled-db` profile (Postgres 18, volume `<project>_db_data`) |
| `DB_HOST=<host>` + `DB_SSLMODE=require` | external Postgres; no db container; backups dump that host |
| `UMAMI_DOMAIN` set (or `ANALYTICS_ENABLED=1`) | `analytics` profile (Umami); off by default |

Services: `web` (gunicorn + uvicorn workers; HTTP and WebSockets), `celery`, `beat`, `redis`,
`caddy` (which also serves the media bucket read-only under `/media/`), `backup`,
plus the optional `db`, `cloudflared`, `umami`, `umami_db`. The media bucket is the host's
RustFS, reached as `http://rustfs:9000` over the external network `${S3_NETWORK:-anishows-s3}`
that `web`, `celery`, `beat`, `caddy` and `backup` join; Compose neither creates nor removes it.
Compose project name = directory name
(`anishows` for `/srv/anishows`) unless `COMPOSE_PROJECT_NAME` is set. Every container has a memory
limit and rotating logs (5 × 10 MB); every long-running service except celery, beat and the
optional Umami has a healthcheck (celery's and beat's would start a second Django process inside
the worker's memory limit).
Restart policy `unless-stopped` (`RESTART_POLICY`). Footprint and the roomier profile:
[runbook.md](runbook.md#footprint-on-a-shared-8-gb--4-core-host).

**Redis down:** the site keeps serving pages (built per request, uncached) and the API; login,
sign-up, password reset, verification mail and email change answer `503` with `Retry-After: 30`
until it is back, because their rate limits cannot be checked (they fail closed by design).

## Verified locally (2026-11-17, this branch)

The production stack ran in proxy mode with locally built prod images (`SKIP_PULL=1`) behind a
throwaway nginx on the host using [host-proxy/nginx.conf](host-proxy/nginx.conf) with a self-signed
certificate; test clients ran in containers on their own addresses, so the host proxy saw
distinct, non-loopback clients as it does in production. `deploy-prod.sh` passed end to end
(including its proxy-chain smoke test), then a second rolling deploy. Checked through the host
proxy (28 checks, all passed):

- real client IP: Caddy logs `remote_ip` 10.250.250.1 (the gateway) and `client_ip` = the test
  client; the login throttle counts per client (6th bad login 429 for client A, client B
  unaffected) and a forged `X-Forwarded-For` neither escapes it nor opens the admin;
- HTTPS: `/api/v1/genres/` 200 over https (no redirect), plain http → one 301 → 200, no loop;
  HSTS `max-age=31536000`; the refresh cookie `Secure; HttpOnly; SameSite=Lax`;
- `/django-admin/`, `/metrics` and readiness 403 with `ADMIN_ALLOW_CIDRS` empty;
- the SPA and its assets, Django static, a media object from the bucket (writes 405), liveness 200, a
  WebSocket upgrade (101);
- login with the site's `Origin` 200, from another origin 403; CORS preflight granted to the
  site with credentials, nothing for another origin;
- Redis stopped: login, sign-up, password reset 503 + `Retry-After: 30` + JSON; all 182 GET
  routes, as a guest and as staff, without a 500;
- backups: the off-site skip line; a real upload, listing, fetch and `restore.sh --from-offsite`
  (46 s, data rolled back, site healthy through the proxy); `prod-verify-backup`.

Also covered by tests: the deploy script's refusals and derived values (`test_deploy_checks.py`,
fake docker), the workflow's remote script (`test_remote_deploy.py`), the off-site upload and
fetch (`test_backup_offsite.py`). Earlier dry runs (G7) covered tunnel mode and an external
Postgres with TLS. Not verifiable locally: the real host proxy's certificates and DNS, Resend
mail delivery, Google sign-in and the GitHub workflow itself; check them on the first deploy.
