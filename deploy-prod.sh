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
# Modes (CADDY_MODE in .env, docs/deploy/tunnel.md):
#   public (default)  Caddy publishes 80/443 and runs ACME
#   tunnel            Cloudflare Tunnel; nothing is published on the host
#
# Env (from .env or the shell; the shell wins): SCALE_WEB (default 2),
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
# .env: parsed, never sourced (a sourced file runs code, and a value with a
# space such as ADMIN_ALLOW_CIDRS would break it). Compose's rules: KEY=VALUE,
# optional quotes, "# comment" after an unquoted value, the shell env wins.
# -----------------------------------------------------------------------------
load_env_file() {
    local file="$1" line key val
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
        if ! [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            warn "ignoring a malformed line in $file"
            continue
        fi
        key="${BASH_REMATCH[2]}"
        val="${BASH_REMATCH[3]}"
        if [[ "$val" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]]; then
            val="${BASH_REMATCH[1]}"
        elif [[ "$val" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
            val="${BASH_REMATCH[1]}"
        else
            val="${val%%[[:space:]]#*}"
            val="${val%"${val##*[![:space:]]}"}"
        fi
        if [ -z "${!key+x}" ]; then
            export "$key=$val"
        fi
    done <"$file"
}
load_env_file .env

command -v docker >/dev/null || die "docker is not installed"

# -----------------------------------------------------------------------------
# Deploy log: everything below is also written to backups-data/deploy-logs/.
# -----------------------------------------------------------------------------
DEPLOY_TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${DEPLOY_LOG_DIR:-backups-data/deploy-logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-${DEPLOY_TS}.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "Deploy log: $LOG_FILE"

# -----------------------------------------------------------------------------
# Mode, profiles and compose files
# -----------------------------------------------------------------------------
CADDY_MODE="${CADDY_MODE:-public}"
case "$CADDY_MODE" in
    public|tunnel) ;;
    *) die "CADDY_MODE must be 'public' or 'tunnel' (got '$CADDY_MODE')" ;;
esac
export CADDY_MODE

DOMAIN="${DOMAIN_NAME:-localhost}"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%,*}"; DOMAIN="${DOMAIN%% *}"; DOMAIN="${DOMAIN%%/*}"; DOMAIN="${DOMAIN%%:*}"
[ -z "$DOMAIN" ] && DOMAIN=localhost

DB_HOST="${DB_HOST:-db}"
export DB_HOST

case "${ANALYTICS_ENABLED:-auto}" in
    auto) if [ -n "${UMAMI_DOMAIN:-}" ]; then ANALYTICS=1; else ANALYTICS=0; fi ;;
    1|true|yes|on) ANALYTICS=1 ;;
    *) ANALYTICS=0 ;;
esac

profiles=()
[ "$DB_HOST" = db ] && profiles+=(bundled-db)
[ "$ANALYTICS" = 1 ] && profiles+=(analytics)
TUNNEL_IN_STACK=0
if [ "$CADDY_MODE" = tunnel ] && [ "${TUNNEL_EXTERNAL:-0}" != 1 ]; then
    [ -n "${TUNNEL_TOKEN:-}" ] || die "CADDY_MODE=tunnel needs TUNNEL_TOKEN (or TUNNEL_EXTERNAL=1 when cloudflared runs outside this stack)"
    profiles+=(tunnel)
    TUNNEL_IN_STACK=1
fi
COMPOSE_PROFILES="$(IFS=,; echo "${profiles[*]-}")"
export COMPOSE_PROFILES

COMPOSE=(docker compose -f docker-compose.prod.yml)
[ "$CADDY_MODE" = public ] && COMPOSE+=(-f infra/compose/public-ports.yml)
for extra in ${COMPOSE_EXTRA_FILES:-}; do
    [ -f "$extra" ] || die "COMPOSE_EXTRA_FILES: $extra not found"
    COMPOSE+=(-f "$extra")
done

# Caddy's site addresses, trusted peers and HSTS follow the mode unless set.
if [ "$CADDY_MODE" = tunnel ]; then
    : "${CADDY_SITE_ADDRESS:=:80}"
    : "${CADDY_TRUSTED_PROXIES:=private_ranges}"
    if [ "$ANALYTICS" = 1 ]; then : "${CADDY_UMAMI_SITE_ADDRESS:=http://${UMAMI_DOMAIN:-umami.invalid}}"; fi
else
    : "${CADDY_SITE_ADDRESS:=$DOMAIN}"
    : "${CADDY_TRUSTED_PROXIES:=127.0.0.1/8 ::1/128}"
    if [ "$ANALYTICS" = 1 ]; then : "${CADDY_UMAMI_SITE_ADDRESS:=${UMAMI_DOMAIN:-http://umami.invalid}}"; fi
fi
: "${CADDY_UMAMI_SITE_ADDRESS:=http://umami.invalid}"

is_true() { case "${1,,}" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac; }
hsts_seconds="${SECURE_HSTS_SECONDS:-31536000}"
[[ "$hsts_seconds" =~ ^[0-9]+$ ]] || die "SECURE_HSTS_SECONDS must be a whole number of seconds"
hsts="max-age=${hsts_seconds}"
is_true "${SECURE_HSTS_INCLUDE_SUBDOMAINS:-True}" && hsts+="; includeSubDomains"
is_true "${SECURE_HSTS_PRELOAD:-True}" && hsts+="; preload"
: "${CADDY_HSTS_HEADER:=$hsts}"
export CADDY_SITE_ADDRESS CADDY_TRUSTED_PROXIES CADDY_UMAMI_SITE_ADDRESS CADDY_HSTS_HEADER

PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}"
FRONTEND_IMAGE="ghcr.io/oddava/anishows-frontend:${FRONTEND_TAG:-latest}"
FRONTEND_VOLUME="${PROJECT}_frontend_dist"
SCALE_WEB="${SCALE_WEB:-2}"
[[ "$SCALE_WEB" =~ ^[1-9][0-9]*$ ]] || die "SCALE_WEB must be a positive integer"

echo "Mode: ${CADDY_MODE}  domain: ${DOMAIN}  database: ${DB_HOST}  profiles: ${COMPOSE_PROFILES:-none}"
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
is_placeholder() {
    case "${1,,}" in
        ""|1|postgres|minioadmin|redispassword123|umami|admin|password|secret) return 0 ;;
        change_me*|change-me*|changeme*|replace*|django-insecure*|"<"*) return 0 ;;
        *) return 1 ;;
    esac
}
insecure=()
secret_vars=(DB_PASSWORD REDIS_PASSWORD AWS_SECRET_ACCESS_KEY)
[ "$ANALYTICS" = 1 ] && secret_vars+=(UMAMI_DB_PASSWORD UMAMI_APP_SECRET)
for var in "${secret_vars[@]}"; do
    is_placeholder "${!var:-}" && insecure+=("$var")
done

secret_key="${DJANGO_SECRET_KEY:-}"
if is_placeholder "$secret_key" || [ "${#secret_key}" -lt 50 ]; then
    insecure+=("DJANGO_SECRET_KEY (placeholder or shorter than 50 characters)")
fi

# An empty METRICS_PASSWORD disables /metrics (the view refuses to serve); a
# placeholder or short one would serve it to anyone who guesses.
metrics_password="${METRICS_PASSWORD:-}"
if [ -z "$metrics_password" ]; then
    warn "METRICS_PASSWORD is empty: /metrics stays disabled."
elif is_placeholder "$metrics_password" || [ "${#metrics_password}" -lt 12 ]; then
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
if grep -q "No planned migration operations" "$PLAN_FILE"; then
    ok "no migrations to apply"
else
    if [ "${SKIP_PRE_MIGRATE_BACKUP:-0}" = 1 ]; then
        warn "SKIP_PRE_MIGRATE_BACKUP=1: migrating without a fresh backup"
    else
        step "Pre-migrate backup (database only)"
        "${COMPOSE[@]}" run --rm --no-deps -T \
            -e BACKUP_INCLUDE_MEDIA=0 -e BACKUP_OUTPUT_PATH_FILE=/backups/.last-pre-migrate \
            --entrypoint /app/shell/backup.sh backup pre-migrate \
            || die "pre-migrate backup failed; nothing was migrated"
        PRE_MIGRATE_BACKUP="$(cat backups-data/.last-pre-migrate 2>/dev/null || echo "backups-data/<latest>-pre-migrate")"
        ok "backup: ${PRE_MIGRATE_BACKUP}"
    fi
fi

# From here on, a failure leaves a changed schema: print how to roll back.
MIGRATED=0
print_rollback() {
    echo -e "\n${RED}==> Deploy failed after the migration step. Rollback recipe:${NC}"
    echo "    The old web replicas keep serving if the rolling restart failed."
    if [ -n "$PREVIOUS_WEB_IMAGE" ]; then
        echo "    1. Previous backend image: ${PREVIOUS_WEB_IMAGE}"
        echo "       docker tag ${PREVIOUS_WEB_IMAGE} ghcr.io/oddava/anishows-backend:rollback"
        echo "       BACKEND_TAG=rollback SKIP_ANILIST_SMOKE=1 ./deploy-prod.sh"
    else
        echo "    1. Re-deploy the previous release: BACKEND_TAG=sha-<previous> ./deploy-prod.sh"
    fi
    if [ "$MIGRATED" = 1 ]; then
        echo "    2. If the old code cannot run on the new schema, first undo the migrations in"
        echo "       ${PLAN_FILE} with the NEW image (it has the files; all are reversible):"
        echo "       ${COMPOSE[*]} run --rm --no-deps web python manage.py migrate <app> <previous_migration>"
        echo "    3. Last resort, restore the database from the pre-migrate backup:"
        echo "       ${COMPOSE[*]} exec backup /app/shell/restore.sh $(basename "${PRE_MIGRATE_BACKUP:-<name>}") --yes --skip-media"
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
"${COMPOSE[@]}" run --rm --no-deps web python manage.py migrate --noinput
MIGRATED=1
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
if [ "$CADDY_MODE" = tunnel ]; then
    # Inside the Caddy container, as cloudflared would send it (Host = the
    # domain, Cloudflare's scheme). Loopback passes the D-9 gate.
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

if [ -n "${PUBLIC_BASE_URL:-}" ]; then
    step "Smoke tests (public: ${PUBLIC_BASE_URL})"
    public="${PUBLIC_BASE_URL%/}"
    # No redirect at all for the health path (a loop shows up as a 301 here).
    code="$(curl -sS -o /dev/null -w '%{http_code}' --retry 3 --retry-delay 3 "${public}/api/v1/health/")" \
        || die "public URL unreachable"
    [ "$code" = 200 ] || die "public liveness returned HTTP ${code} (a 301/308 means a redirect loop; see docs/deploy/tunnel.md)"
    curl -fsS -o /dev/null --max-redirs 3 -L "${public}/" || die "public homepage failed (or redirects in a loop)"
    ok "public URL serves the API and the SPA"
fi

ROLLBACK_HINTS=0

if [ "${PRUNE_IMAGES:-1}" = 1 ]; then
    step "Pruning old images (this project's only)"
    # A shared host: never touch other projects' images.
    docker image prune -f --filter "until=24h" --filter "label=app.anishows.component" >/dev/null || true
fi

echo -e "\n${GREEN}Deployment complete.${NC}"
"${COMPOSE[@]}" ps
