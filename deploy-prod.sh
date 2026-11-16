#!/usr/bin/env bash
#
# Production deploy (run on the server from the repo root; CI calls it over SSH).
#   1. preflight: .env refusals, compose config, pull images
#   2. core services, `manage.py check --deploy`, AniList smoke query
#   3. `migrate --plan` (saved to the deploy log); if anything is planned, a
#      database backup first (pre-migrate); then `migrate`
#   4. workers, then web replicas rolled one at a time (no downtime)
#   5. frontend files, cache clear, Caddy (and cloudflared in tunnel mode)
#   6. smoke tests through Caddy, and through PUBLIC_BASE_URL when set
# A failure after the migrations prints the rollback recipe.
#
# Modes (CADDY_MODE in .env, docs/deploy/DEPLOY.md):
#   proxy (default)  an existing reverse proxy on the host terminates TLS and
#                    forwards to Caddy on 127.0.0.1:CADDY_PROXY_PORT (8080)
#   public           Caddy publishes 80/443 and runs ACME
#   tunnel           Cloudflare Tunnel; nothing is published on the host
# The edge must be configured explicitly (scripts/deploy/env.sh,
# edge_config_problems): TRUSTED_PROXY_CIDRS always, CADDY_TRUSTED_PROXIES in
# proxy mode, and no wide-open ADMIN_ALLOW_CIDRS (unless
# ALLOW_WIDE_ADMIN_CIDRS=1). The deploy refuses to start otherwise.
#
# Env (from .env or the shell; the shell wins): SCALE_WEB (default 1),
# BACKEND_TAG / FRONTEND_TAG (default latest), DB_HOST (default db = bundled
# Postgres), ANALYTICS_ENABLED (auto: on when UMAMI_DOMAIN is set),
# TUNNEL_TOKEN, TUNNEL_EXTERNAL=1 (cloudflared runs outside this stack),
# COMPOSE_EXTRA_FILES (space-separated override files), PUBLIC_BASE_URL,
# SKIP_ANILIST_SMOKE=1, SKIP_PRE_MIGRATE_BACKUP=1, SKIP_PULL=1 (local images:
# dry runs, air-gapped hosts), ALLOW_INSECURE_DEFAULTS=1
# (one run past the secret refusals), PRUNE_IMAGES (default 1: only images
# labelled app.anishows.component). Every variable: .env.production.example.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo -e "\n${BLUE}==> $*${NC}"; }
ok()   { echo -e "${GREEN}    $*${NC}"; }
warn() { echo -e "${YELLOW}    $*${NC}"; }
die()  { echo -e "${RED}    $*${NC}"; exit 1; }

# -----------------------------------------------------------------------------
# Deploy log: everything below, .env errors included, is also written to
# backups-data/deploy-logs/ (DEPLOY_LOG_DIR from the shell only).
# -----------------------------------------------------------------------------
DEPLOY_TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${DEPLOY_LOG_DIR:-backups-data/deploy-logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-${DEPLOY_TS}.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "Deploy log: $LOG_FILE"

# One deploy at a time (CI and an operator, or two operators): two rolling
# restarts, prunes or state writes must never interleave.
mkdir -p backups-data
if command -v flock >/dev/null 2>&1; then
    exec 8>>backups-data/.deploy.lock
    flock -n 8 || die "another deploy-prod.sh is running on this host (backups-data/.deploy.lock)"
else
    warn "flock not found: concurrent deploys are not prevented"
fi

# .env parsing and everything CADDY_MODE decides (profiles, override files,
# Caddy's site address / trusted peers / HSTS) live in scripts/deploy/env.sh,
# shared with scripts/deploy/compose.sh so manual commands match the deploy.
# Image tags: shell > the deployed release (backups-data/deployed.env) >
# .env > latest. So a config-only re-run (secret rotation) keeps the live
# release, even after a rollback; deploy another one with BACKEND_TAG/
# FRONTEND_TAG in the shell (CI passes sha-<commit>).
# shellcheck source=scripts/deploy/env.sh
source scripts/deploy/env.sh
tag_source="shell"
[ -n "${BACKEND_TAG:-}" ] || tag_source=""
# The release that is live now (the rollback target and what the prune keeps).
STATE_BACKEND_TAG="$(state_value BACKEND_TAG)"
STATE_FRONTEND_TAG="$(state_value FRONTEND_TAG)"
STATE_BACKEND_ID="$(state_value BACKEND_IMAGE_ID)"
STATE_FRONTEND_ID="$(state_value FRONTEND_IMAGE_ID)"
STATE_PREVIOUS_BACKEND_ID="$(state_value PREVIOUS_BACKEND_IMAGE_ID)"
STATE_PREVIOUS_FRONTEND_ID="$(state_value PREVIOUS_FRONTEND_IMAGE_ID)"
load_deployed_state
[ -n "$tag_source" ] || { [ -n "${BACKEND_TAG:-}" ] && tag_source="deployed.env"; }
load_env_file .env
[ -n "$tag_source" ] || tag_source=".env/default"
BACKEND_TAG="${BACKEND_TAG:-latest}"
FRONTEND_TAG="${FRONTEND_TAG:-latest}"
export BACKEND_TAG FRONTEND_TAG

command -v docker >/dev/null || die "docker is not installed"

# -----------------------------------------------------------------------------
# Mode, profiles and compose files (scripts/deploy/env.sh)
# -----------------------------------------------------------------------------
resolve_deploy_mode
if [ "$TUNNEL_IN_STACK" = 1 ] && is_placeholder_value "${TUNNEL_TOKEN:-}"; then
    die "CADDY_MODE=tunnel needs a real TUNNEL_TOKEN (or TUNNEL_EXTERNAL=1 when cloudflared runs outside this stack)"
fi
if [ "$CADDY_MODE" = public ] && [ "$DOMAIN" != localhost ]; then
    if is_placeholder_value "${CADDY_ACME_EMAIL:-}" || [[ "${CADDY_ACME_EMAIL}" == *.local || "${CADDY_ACME_EMAIL}" == *@example.* ]]; then
        die "Public mode needs a real CADDY_ACME_EMAIL for certificate registration"
    fi
fi
# Trusted peers and the operator gate: no permissive defaults, and no
# ALLOW_INSECURE_DEFAULTS escape (a wrong value here is silent at runtime:
# one throttle bucket for everyone, a redirect loop, or an open admin).
mapfile -t edge_problems < <(edge_config_problems)
if [ "${#edge_problems[@]}" -gt 0 ]; then
    echo -e "${RED}    Refusing to deploy: the edge is not configured:${NC}"
    printf '      - %s\n' "${edge_problems[@]}"
    die "Set them in .env (see .env.production.example and docs/deploy/DEPLOY.md)."
fi
while IFS= read -r edge_warning; do
    [ -n "$edge_warning" ] && warn "$edge_warning"
done < <(edge_config_warnings)
if [ "$ADMIN_ALLOW_CIDRS" = 100::/64 ]; then
    warn "ADMIN_ALLOW_CIDRS is empty: /django-admin, /metrics and readiness answer 403 to every client."
fi

PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}"
FRONTEND_IMAGE="ghcr.io/oddava/anishows-frontend:${FRONTEND_TAG}"
FRONTEND_VOLUME="${PROJECT}_frontend_dist"
SCALE_WEB="${SCALE_WEB:-1}"
[[ "$SCALE_WEB" =~ ^[1-9][0-9]*$ ]] || die "SCALE_WEB must be a positive integer"

echo "Mode: ${CADDY_MODE}  domain: ${DOMAIN}  database: ${DB_HOST}  profiles: ${COMPOSE_PROFILES:-none}"
echo "Release: backend=${BACKEND_TAG} frontend=${FRONTEND_TAG} (tags from ${tag_source}; live: ${STATE_BACKEND_TAG:-none}/${STATE_FRONTEND_TAG:-none})"
echo "Compose: ${COMPOSE[*]}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
service_ids() {
    docker ps -q \
        --filter "label=com.docker.compose.project=${PROJECT}" \
        --filter "label=com.docker.compose.service=$1"
}

container_status() {
    docker inspect --format '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}{{else}}stopped{{end}}' "$1" 2>/dev/null || echo missing
}

wait_ready() {
    local id="$1" name="$2" status
    for _ in $(seq 1 90); do
        status="$(container_status "$id")"
        case "$status" in
            healthy|running) return 0 ;;
            unhealthy|stopped|missing) break ;;
        esac
        sleep 2
    done
    echo -e "${RED}    ${name} ${id:0:12} not ready (status=${status})${NC}"
    docker logs --tail=80 "$id" 2>&1 || true
    return 1
}

# Replace web containers one by one: start a new one, wait for healthy, remove an old one.
roll_web() {
    local old_ids new_id before after
    mapfile -t old_ids < <(service_ids web)

    if [ "${#old_ids[@]}" -eq 0 ]; then
        "${COMPOSE[@]}" up -d --no-deps --scale "web=${SCALE_WEB}" web
    else
        for old in "${old_ids[@]}"; do
            mapfile -t before < <(service_ids web)
            "${COMPOSE[@]}" up -d --no-deps --no-recreate --scale "web=$(( ${#before[@]} + 1 ))" web
            mapfile -t after < <(service_ids web)
            new_id=""
            for id in "${after[@]}"; do
                [[ " ${before[*]} " == *" ${id} "* ]] || new_id="$id"
            done
            [ -n "$new_id" ] || die "could not find the new web container"
            wait_ready "$new_id" web || { docker rm -f "$new_id" >/dev/null; die "new web container failed; old ones still serving"; }
            # SIGTERM first so gunicorn finishes in-flight requests
            # (graceful_timeout is 30s); rm -f alone sends SIGKILL.
            docker stop -t 35 "$old" >/dev/null || true
            docker rm -f "$old" >/dev/null
            ok "replaced web ${old:0:12} -> ${new_id:0:12}"
        done
        "${COMPOSE[@]}" up -d --no-deps --no-recreate --scale "web=${SCALE_WEB}" web
    fi

    for id in $(service_ids web); do wait_ready "$id" web || die "web replica unhealthy"; done
}

# -----------------------------------------------------------------------------
# Refuse unsafe production configuration (before anything changes)
# -----------------------------------------------------------------------------
# docker-compose.prod.yml still has well-known fallbacks for some secrets, and
# the templates ship placeholders. A server running on them is open (the
# secret key signs sessions, password resets and JWTs; the Umami secret signs
# dashboard logins). ALLOW_INSECURE_DEFAULTS=1 overrides this for one run.
insecure=()
secret_vars=(DB_PASSWORD REDIS_PASSWORD AWS_SECRET_ACCESS_KEY)
[ "$ANALYTICS" = 1 ] && secret_vars+=(UMAMI_DB_PASSWORD UMAMI_APP_SECRET)
for var in "${secret_vars[@]}"; do
    is_placeholder_value "${!var:-}" && insecure+=("$var")
done

secret_key="${DJANGO_SECRET_KEY:-}"
if is_placeholder_value "$secret_key" || [ "${#secret_key}" -lt 50 ]; then
    insecure+=("DJANGO_SECRET_KEY (placeholder or shorter than 50 characters)")
fi

# An empty METRICS_PASSWORD disables /metrics (the view refuses to serve); a
# placeholder or short one would serve it to anyone who guesses.
metrics_password="${METRICS_PASSWORD:-}"
if [ -z "$metrics_password" ]; then
    warn "METRICS_PASSWORD is empty: /metrics stays disabled."
elif is_placeholder_value "$metrics_password" || [ "${#metrics_password}" -lt 12 ]; then
    insecure+=("METRICS_PASSWORD (placeholder or shorter than 12 characters)")
fi

# ALLOWED_HOSTS falls back to local names in base.py, which turns every
# request for the real domain into a 400 at runtime instead of a failed deploy.
allowed_hosts="${ALLOWED_HOSTS:-}"
public_host_listed=0
real_host_listed=0
IFS=',' read -r -a host_list <<<"$allowed_hosts"
for host in "${host_list[@]}"; do
    host="${host// /}"
    case "${host,,}" in
        ""|localhost|127.0.0.1|web|"[::1]"|::1|0.0.0.0) ;;
        "*") insecure+=("ALLOWED_HOSTS (a bare '*' accepts any Host header)") ;;
        *) real_host_listed=1 ;;
    esac
    [ "${host,,}" = "${DOMAIN,,}" ] && public_host_listed=1
done
if [ "$real_host_listed" = 0 ]; then
    insecure+=("ALLOWED_HOSTS (unset or only local names)")
elif [ "$DOMAIN" != localhost ] && [ "$public_host_listed" = 0 ]; then
    insecure+=("ALLOWED_HOSTS (does not list DOMAIN_NAME's host ${DOMAIN})")
fi

if [ "${#insecure[@]}" -gt 0 ]; then
    if [ "${ALLOW_INSECURE_DEFAULTS:-0}" = 1 ]; then
        warn "Deploying with default/insecure values (ALLOW_INSECURE_DEFAULTS=1):"
        printf '      - %s\n' "${insecure[@]}"
    else
        echo -e "${RED}    Refusing to deploy with default/insecure values:${NC}"
        printf '      - %s\n' "${insecure[@]}"
        die "Set them in .env (see .env.production.example), or rerun once with ALLOW_INSECURE_DEFAULTS=1."
    fi
fi

if [ "$DB_HOST" != db ] && [ -z "${DB_SSLMODE:-}" ]; then
    warn "External database ${DB_HOST} without DB_SSLMODE: libpq's default (prefer) may connect unencrypted."
fi
if [ "$ANALYTICS" = 1 ] && [ -z "${UMAMI_PUBLIC_ORIGIN:-}" ]; then
    warn "UMAMI_PUBLIC_ORIGIN is unset; the CSP will block the Umami script."
fi

step "Compose configuration"
"${COMPOSE[@]}" config -q || die "docker compose rejected the configuration"
# The app network has a fixed subnet (APP_SUBNET) that both trust lists name.
# A network created before that (or with another APP_SUBNET) keeps its old
# subnet: then Caddy is outside TRUSTED_PROXY_CIDRS and the host proxy arrives
# from another gateway. Stop before anything changes.
existing_subnet="$(docker network inspect "${PROJECT}_default" --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null || true)"
existing_subnet="${existing_subnet%% }"
if [ -n "$existing_subnet" ] && [ "$existing_subnet" != "$APP_SUBNET" ]; then
    die "Network ${PROJECT}_default has subnet ${existing_subnet}, not APP_SUBNET ${APP_SUBNET}. In a maintenance window: scripts/deploy/compose.sh down (volumes are kept), then rerun the deploy; or set APP_SUBNET=${existing_subnet} and adjust both trust lists."
fi
ok "valid (${COMPOSE_PROFILES:-no profiles})"

# The image currently serving, for the rollback recipe.
PREVIOUS_WEB_IMAGE=""
current_web="$(service_ids web | head -n1)"
if [ -n "$current_web" ]; then
    PREVIOUS_WEB_IMAGE="$(docker inspect --format '{{.Image}}' "$current_web" 2>/dev/null || true)"
fi

if [ "${SKIP_PULL:-0}" = 1 ]; then
    step "Images: local only (SKIP_PULL=1)"
    docker image inspect "$FRONTEND_IMAGE" >/dev/null 2>&1 || die "$FRONTEND_IMAGE is not present locally"
else
    step "Pulling images"
    "${COMPOSE[@]}" pull --ignore-buildable
    docker pull "$FRONTEND_IMAGE"
fi
"${COMPOSE[@]}" build backup

# The images this deploy runs, by id, and the release to fall back to: the
# live one (what web runs now, else deployed.env), or, when this is a re-run
# of the live release, the one recorded before it.
image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
NEW_BACKEND_ID="$(image_id "ghcr.io/oddava/anishows-backend:${BACKEND_TAG}")"
NEW_FRONTEND_ID="$(image_id "$FRONTEND_IMAGE")"
ROLLBACK_BACKEND_ID=""
for candidate in "$PREVIOUS_WEB_IMAGE" "$STATE_BACKEND_ID" "$STATE_PREVIOUS_BACKEND_ID"; do
    if [ -n "$candidate" ] && [ "$candidate" != "$NEW_BACKEND_ID" ]; then
        ROLLBACK_BACKEND_ID="$candidate"
        break
    fi
done
ROLLBACK_FRONTEND_ID=""
for candidate in "$STATE_FRONTEND_ID" "$STATE_PREVIOUS_FRONTEND_ID"; do
    if [ -n "$candidate" ] && [ "$candidate" != "$NEW_FRONTEND_ID" ]; then
        ROLLBACK_FRONTEND_ID="$candidate"
        break
    fi
done

step "Core services"
core_services=(redis minio)
[ "$DB_HOST" = db ] && core_services+=(db)
"${COMPOSE[@]}" up -d --wait --no-deps "${core_services[@]}"
"${COMPOSE[@]}" up --no-deps --exit-code-from createbuckets createbuckets >/dev/null \
    || die "bucket setup failed"

step "Configuration check"
# Before any schema change. Warnings (e.g. core.W001: no Safe Browsing key)
# are printed; only errors (e.g. core.E010: placeholder secret key) stop it.
"${COMPOSE[@]}" run --rm --no-deps web python manage.py check --deploy --fail-level ERROR \
    || die "manage.py check --deploy reported errors"
if [ "${SKIP_ANILIST_SMOKE:-0}" != 1 ]; then
    # Every AniList query the new code sends, once: fails only if AniList rejects one.
    "${COMPOSE[@]}" run --rm --no-deps web python manage.py anilist_smoke \
        || die "AniList rejected a catalog query (see above); the catalog sync would not work"
fi

step "Migration plan"
PLAN_FILE="$LOG_DIR/deploy-${DEPLOY_TS}-migrate-plan.txt"
"${COMPOSE[@]}" run --rm --no-deps web python manage.py migrate --plan >"$PLAN_FILE" \
    || { cat "$PLAN_FILE"; die "migrate --plan failed (database unreachable?)"; }
cat "$PLAN_FILE"
PRE_MIGRATE_BACKUP=""
PLAN_HAS_CHANGES=1
if grep -q "No planned migration operations" "$PLAN_FILE"; then
    PLAN_HAS_CHANGES=0
    ok "no migrations to apply"
else
    if [ "${SKIP_PRE_MIGRATE_BACKUP:-0}" = 1 ]; then
        warn "SKIP_PRE_MIGRATE_BACKUP=1: migrating without a fresh backup"
    else
        step "Pre-migrate backup (database only)"
        # Local only (an off-site hiccup must not block a deploy; the nightly
        # backup goes off-site), and it waits out a running nightly backup.
        "${COMPOSE[@]}" run --rm --no-deps -T \
            -e BACKUP_INCLUDE_MEDIA=0 -e BACKUP_REMOTE= -e BACKUP_LOCK_WAIT_SECONDS=1800 \
            -e BACKUP_OUTPUT_PATH_FILE=/backups/.last-pre-migrate \
            --entrypoint /app/shell/backup.sh backup pre-migrate \
            || die "pre-migrate backup failed; nothing was migrated"
        PRE_MIGRATE_BACKUP="$(cat backups-data/.last-pre-migrate 2>/dev/null || echo "backups-data/<latest>-pre-migrate")"
        ok "backup: ${PRE_MIGRATE_BACKUP}"
    fi
fi

# From here on, a failure may leave a changed schema: print how to roll back.
# MIGRATE_STARTED: the plan was non-empty and migrate has started (it may have
# applied part of the plan), so the schema steps apply.
MIGRATE_STARTED=0
print_rollback() {
    echo -e "\n${RED}==> Deploy failed at or after the migration step. Rollback recipe:${NC}"
    echo "    The old web replicas keep serving if the rolling restart failed."
    echo "    This attempt: BACKEND_TAG=${BACKEND_TAG} FRONTEND_TAG=${FRONTEND_TAG}. ${DEPLOYED_STATE_FILE} still"
    echo "    names the last successful release (${STATE_BACKEND_TAG:-none}/${STATE_FRONTEND_TAG:-none}), and"
    echo "    scripts/deploy/compose.sh uses it: pass BACKEND_TAG=${BACKEND_TAG} to reach the new code."
    local n=1
    if [ "$MIGRATE_STARTED" = 1 ]; then
        echo "    This deploy changed the schema (${PLAN_FILE}). If the old code cannot"
        echo "    run on it, do step 1 first, then step 2."
        echo "    ${n}. Undo this deploy's migrations with the NEW image (it has the files;"
        echo "       all are reversible), app by app, back to the migration before the plan:"
        echo "       BACKEND_TAG=${BACKEND_TAG} scripts/deploy/compose.sh run --rm --no-deps web python manage.py migrate <app> <previous_migration>"
        n=$((n + 1))
    else
        echo "    No schema change in this deploy: re-deploying the previous release is enough."
    fi
    if [ -n "$ROLLBACK_BACKEND_ID" ]; then
        local frontend_tag="$FRONTEND_TAG"
        echo "    ${n}. Re-deploy the previous release from its local images (no pull):"
        echo "       docker tag ${ROLLBACK_BACKEND_ID} ghcr.io/oddava/anishows-backend:rollback"
        if [ -n "$ROLLBACK_FRONTEND_ID" ]; then
            echo "       docker tag ${ROLLBACK_FRONTEND_ID} ghcr.io/oddava/anishows-frontend:rollback"
            frontend_tag=rollback
        fi
        echo "       BACKEND_TAG=rollback FRONTEND_TAG=${frontend_tag} SKIP_PULL=1 SKIP_ANILIST_SMOKE=1 ./deploy-prod.sh"
    else
        echo "    ${n}. No previous release is recorded on this host: re-deploy it by tag,"
        echo "       BACKEND_TAG=sha-<previous> FRONTEND_TAG=sha-<previous> ./deploy-prod.sh"
    fi
    n=$((n + 1))
    if [ "$MIGRATE_STARTED" = 1 ]; then
        echo "    ${n}. Last resort (data damage), restore the pre-migrate dump:"
        echo "       scripts/deploy/compose.sh stop web celery beat && scripts/deploy/compose.sh exec backup /app/shell/restore.sh $(basename "${PRE_MIGRATE_BACKUP:-<name>}") --yes --skip-media"
    fi
    echo "    Runbook: docs/deploy/runbook.md (Rollback). Log: ${LOG_FILE}"
}
on_exit() {
    local status=$?
    if [ "$status" -ne 0 ] && [ "${ROLLBACK_HINTS:-0}" = 1 ]; then
        print_rollback
    fi
}
trap on_exit EXIT
ROLLBACK_HINTS=1

step "Migrations"
# Set before the command: a plan of several migrations can apply some and fail.
MIGRATE_STARTED="$PLAN_HAS_CHANGES"
"${COMPOSE[@]}" run --rm --no-deps web python manage.py migrate --noinput
ok "migrations applied"

step "Workers and backups"
"${COMPOSE[@]}" up -d --no-deps celery beat backup
if [ "$ANALYTICS" = 1 ]; then
    "${COMPOSE[@]}" up -d --wait --no-deps umami_db
    "${COMPOSE[@]}" up -d --no-deps umami
fi

step "Web (rolling, ${SCALE_WEB} replicas)"
roll_web

# Only now that the new web and workers serve: drop containers whose service
# is gone (old daphne / celery workers, the Jikan stack removed in D1).
"${COMPOSE[@]}" up -d --no-deps --no-recreate --remove-orphans "${core_services[@]}"
leftover_volumes="$(docker volume ls -q | grep -E "^${PROJECT}_jikan_(mongodb|typesense)_data$" || true)"
if [ -n "$leftover_volumes" ]; then
    warn "Jikan data volumes are no longer used; remove them to free disk:"
    echo "    docker volume rm ${leftover_volumes//$'\n'/ }"
fi

step "Frontend: ${FRONTEND_IMAGE}"
# After the backend, and copied over the old build instead of wiping it: open
# tabs still load their old hashed chunks, and index.html (copied last) never
# points at assets that are not there yet. Chunks unused for a week go.
# Labelled as compose's own volume, so compose does not warn about it.
docker volume create \
    --label "com.docker.compose.project=${PROJECT}" \
    --label com.docker.compose.volume=frontend_dist \
    "$FRONTEND_VOLUME" >/dev/null
docker run --rm -v "${FRONTEND_VOLUME}:/srv/frontend" "$FRONTEND_IMAGE" sh -c '
    set -e
    mkdir -p /srv/frontend/assets
    cp -r /app/dist/assets/. /srv/frontend/assets/
    find /app/dist -mindepth 1 -maxdepth 1 ! -name assets ! -name index.html -exec cp -r {} /srv/frontend/ \;
    cp /app/dist/index.html /srv/frontend/index.html
    find /srv/frontend/assets -type f -mtime +7 -delete
    test -f /srv/frontend/index.html'
ok "frontend files deployed"

step "Clearing application cache"
"${COMPOSE[@]}" exec -T web python manage.py shell -c "from django.core.cache import cache; cache.clear()" \
    && ok "cache cleared" || warn "cache clear failed (continuing)"

step "Caddy (${CADDY_MODE} mode)"
"${COMPOSE[@]}" up -d --no-deps caddy
wait_ready "$(service_ids caddy | head -n1)" caddy || die "caddy is not healthy"
# Caddyfile.prod is a single-file bind mount: `git pull` replaces the file
# (a new inode), and the container keeps seeing the old one, so a reload
# alone would serve the old config. Recreate Caddy when they differ (a second
# or two of 502s); otherwise a graceful reload is enough.
host_sum="$(sha256sum Caddyfile.prod | cut -d' ' -f1)"
live_sum="$("${COMPOSE[@]}" exec -T caddy sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1 || true)"
if [ "$host_sum" != "$live_sum" ]; then
    warn "Caddyfile.prod changed: recreating Caddy so it sees the new file"
    "${COMPOSE[@]}" up -d --no-deps --force-recreate caddy
    wait_ready "$(service_ids caddy | head -n1)" caddy || die "caddy is not healthy after the recreate"
fi
"${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force \
    || { "${COMPOSE[@]}" logs --tail=50 caddy; die "caddy reload failed"; }
if [ "$TUNNEL_IN_STACK" = 1 ]; then
    "${COMPOSE[@]}" up -d --no-deps cloudflared
    wait_ready "$(service_ids cloudflared | head -n1)" cloudflared \
        || die "cloudflared is not connected (check TUNNEL_TOKEN and the tunnel in Cloudflare)"
    ok "tunnel connected"
fi

# -----------------------------------------------------------------------------
# Smoke tests
# -----------------------------------------------------------------------------
step "Smoke tests (through Caddy)"
if [ "$CADDY_MODE" != public ]; then
    # Inside the Caddy container, as the host's proxy or cloudflared would
    # send it (Host = the domain, https). Loopback passes the D-9 gate.
    fetch() {
        "${COMPOSE[@]}" exec -T caddy wget -q -O - -T 10 \
            --header "Host: ${DOMAIN}" --header "X-Forwarded-Proto: https" \
            "http://127.0.0.1$1"
    }
else
    # Public mode: the real listener on this host, without trusting DNS.
    fetch() {
        local url="http://localhost:80"
        local -a curl_args=(curl -fsS --retry 3 --retry-delay 2 --max-redirs 5)
        if [ "$DOMAIN" != localhost ] && [ "$DOMAIN" != 127.0.0.1 ]; then
            url="http://${DOMAIN}"
            curl_args+=(-L --resolve "${DOMAIN}:80:127.0.0.1" --resolve "${DOMAIN}:443:127.0.0.1")
        fi
        "${curl_args[@]}" "${url}$1"
    }
fi
# A just-reloaded Caddy may need a moment for its upstream health checks.
fetch_retry() {
    local attempt
    for attempt in 1 2 3 4 5 6; do
        if fetch "$1"; then return 0; fi
        sleep "$attempt"
    done
    return 1
}
fetch_retry /api/v1/health/ | grep -q '"status"' || die "API liveness check failed"
ok "liveness"
# Readiness straight from a web replica: through Caddy it is behind the D-9
# gate, and host traffic reaches Caddy from the Docker gateway, not loopback.
"${COMPOSE[@]}" exec -T web curl -fsS http://localhost:8000/api/v1/health/ready/ \
    | grep -q '"database": *true' || die "readiness check failed (database, cache or migrations)"
ok "readiness"
html="$(fetch_retry / || true)"
echo "$html" | grep -q 'id="root"' || die "homepage did not return the SPA"
asset="$(echo "$html" | grep -oE '/assets/[^" ]+\.js' | head -n1 || true)"
if [ -n "$asset" ]; then
    fetch "$asset" >/dev/null || die "frontend asset ${asset} not reachable"
fi
ok "frontend served"

# The health paths are exempt from SECURE_SSL_REDIRECT and "/" is served by
# Caddy alone, so neither can show Django's scheme loop. This route can: it
# must answer without a redirect (2xx/4xx, or 503 in maintenance mode).
NON_EXEMPT_ROUTE="/api/v1/genres/"
acceptable_status() { [[ "$1" =~ ^(2[0-9][0-9]|4[0-9][0-9]|503)$ ]]; }
if [ "$CADDY_MODE" = tunnel ]; then
    # As cloudflared sends it. With the in-stack cloudflared, from the edge
    # network itself (a throwaway container on it, Caddy's image for its
    # wget), so a wrong EDGE_SUBNET / CADDY_TRUSTED_PROXIES fails here;
    # otherwise from Caddy's loopback. wget -S prints the first status line.
    probe=("${COMPOSE[@]}" exec -T caddy wget)
    target="http://127.0.0.1${NON_EXEMPT_ROUTE}"
    if [ "$TUNNEL_IN_STACK" = 1 ]; then
        caddy_image="$(docker inspect --format '{{.Config.Image}}' "$(service_ids caddy | head -n1)")"
        probe=(docker run --rm --network "${PROJECT}_edge" --entrypoint wget "$caddy_image")
        target="http://caddy${NON_EXEMPT_ROUTE}"
    fi
    status="$("${probe[@]}" -S -q -O /dev/null -T 10 \
        --header "Host: ${DOMAIN}" --header "X-Forwarded-Proto: https" \
        --header "CF-Connecting-IP: 192.0.2.10" \
        "$target" 2>&1 | grep -m1 -oE 'HTTP/[0-9.]+ [0-9]{3}' | grep -oE '[0-9]{3}$' || true)"
    acceptable_status "$status" \
        || die "Django answered ${NON_EXEMPT_ROUTE} with '${status:-no response}' for an https request from the tunnel: the trusted-peer / X-Forwarded-Proto chain is broken (EDGE_SUBNET, CADDY_TRUSTED_PROXIES; docs/deploy/tunnel.md)"
    ok "scheme chain (https from the tunnel seen by Django)"
fi
if [ "$CADDY_MODE" = proxy ] && [ "${CADDY_PROXY_PUBLISH:-1}" != 0 ]; then
    # As the host's reverse proxy sends it, through the published loopback
    # port (Caddy sees the Docker gateway as the peer). A missing gateway in
    # CADDY_TRUSTED_PROXIES makes Caddy reset X-Forwarded-Proto to http, and
    # Django answers with a redirect: caught here, not by users.
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
        -H "Host: ${DOMAIN}" -H "X-Forwarded-Proto: https" -H "X-Forwarded-For: 192.0.2.10" \
        "http://${CADDY_PROXY_BIND:-127.0.0.1}:${CADDY_PROXY_PORT:-8080}${NON_EXEMPT_ROUTE}" || true)"
    acceptable_status "$status" \
        || die "Django answered ${NON_EXEMPT_ROUTE} with '${status:-no response}' for an https request from the host's proxy: CADDY_TRUSTED_PROXIES must list the Docker gateway of APP_SUBNET (docs/deploy/DEPLOY.md)"
    ok "scheme chain (https from the host's proxy seen by Django)"
fi

if [ -n "${PUBLIC_BASE_URL:-}" ]; then
    step "Smoke tests (public: ${PUBLIC_BASE_URL})"
    public="${PUBLIC_BASE_URL%/}"
    public_status() { curl -sS -o /dev/null -w '%{http_code}' --retry 3 --retry-delay 3 "${public}$1"; }
    code="$(public_status /api/v1/health/)" || die "public URL unreachable"
    [ "$code" = 200 ] || die "public liveness returned HTTP ${code} (see docs/deploy/tunnel.md)"
    # No redirect followed: a 301/308 here is the redirect loop (R2).
    code="$(public_status "$NON_EXEMPT_ROUTE")" || die "public URL unreachable"
    acceptable_status "$code" \
        || die "public ${NON_EXEMPT_ROUTE} returned HTTP ${code}: a 301/308 means Django does not see https (redirect loop; docs/deploy/tunnel.md)"
    curl -fsS -o /dev/null --max-redirs 3 -L "${public}/" || die "public homepage failed (or redirects in a loop)"
    ok "public URL serves the API (no redirect) and the SPA"
fi

ROLLBACK_HINTS=0

# The release now live: manual commands (scripts/deploy/compose.sh, verify,
# a config-only re-run, the next rollback recipe) run exactly these images.
# The previous release moves only when the images actually changed (a
# same-tag re-run must not forget the real previous release).
prev_backend_id="$STATE_PREVIOUS_BACKEND_ID"
[ "$NEW_BACKEND_ID" != "$STATE_BACKEND_ID" ] && prev_backend_id="${ROLLBACK_BACKEND_ID}"
prev_frontend_id="$STATE_PREVIOUS_FRONTEND_ID"
[ "$NEW_FRONTEND_ID" != "$STATE_FRONTEND_ID" ] && prev_frontend_id="${ROLLBACK_FRONTEND_ID}"
state_tmp="${DEPLOYED_STATE_FILE}.tmp.$$"
{
    echo "# Written by deploy-prod.sh after a successful deploy; do not edit."
    echo "BACKEND_TAG=${BACKEND_TAG}"
    echo "FRONTEND_TAG=${FRONTEND_TAG}"
    echo "BACKEND_IMAGE_ID=${NEW_BACKEND_ID}"
    echo "FRONTEND_IMAGE_ID=${NEW_FRONTEND_ID}"
    echo "PREVIOUS_BACKEND_IMAGE_ID=${prev_backend_id}"
    echo "PREVIOUS_FRONTEND_IMAGE_ID=${prev_frontend_id}"
    echo "DEPLOYED_AT=${DEPLOY_TS}"
} >"$state_tmp"
mv -f "$state_tmp" "$DEPLOYED_STATE_FILE"
ok "release recorded in ${DEPLOYED_STATE_FILE}"

if grep -q "0060_adult_flag_from_anilist" "$PLAN_FILE"; then
    # anime.0060 seeded is_adult; the (new) worker now re-reads AniList's
    # isAdult for the whole catalog (about one request per 50 titles,
    # rate-limited). A one-off container of the new image queues it.
    step "AniList adult-flag sync"
    "${COMPOSE[@]}" run --rm --no-deps -T web python manage.py sync_adult_flags --enqueue \
        || die "The release is live, but the adult-flag sync could not be queued. Run: scripts/deploy/compose.sh run --rm --no-deps web python manage.py sync_adult_flags --enqueue"
    ok "AniList adult-flag sync queued"
fi

if [ "${PRUNE_IMAGES:-1}" = 1 ]; then
    step "Pruning old images (this project's only; current and previous kept)"
    KEEP_REFS="ghcr.io/oddava/anishows-backend:${BACKEND_TAG} ${FRONTEND_IMAGE}" \
        KEEP_IDS="${NEW_BACKEND_ID} ${NEW_FRONTEND_ID} ${prev_backend_id} ${prev_frontend_id} ${PREVIOUS_WEB_IMAGE}" \
        bash scripts/deploy/prune_images.sh || warn "image prune failed (continuing)"
fi

echo -e "\n${GREEN}Deployment complete.${NC}"
"${COMPOSE[@]}" ps
