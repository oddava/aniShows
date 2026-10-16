#!/usr/bin/env bash
#
# Production deploy (run on the server from the repo root; CI calls it over SSH).
#   1. copy the new frontend build into the frontend_dist volume
#   2. pull backend images, run migrations
#   3. restart workers, roll web replicas one at a time (no downtime)
#   4. reload Caddy and smoke-test API + frontend
#
# Env (from .env or the shell): SCALE_WEB (default 2), BACKEND_TAG (default latest),
# FRONTEND_TAG (default latest).

set -euo pipefail

if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMPOSE=(docker compose -f docker-compose.prod.yml)
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}"
FRONTEND_IMAGE="ghcr.io/oddava/anishows-frontend:${FRONTEND_TAG:-latest}"
FRONTEND_VOLUME="${PROJECT}_frontend_dist"
SCALE_WEB="${SCALE_WEB:-2}"

DOMAIN="${DOMAIN_NAME:-localhost}"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%,*}"; DOMAIN="${DOMAIN%% *}"; DOMAIN="${DOMAIN%%/*}"; DOMAIN="${DOMAIN%%:*}"
[ -z "$DOMAIN" ] && DOMAIN=localhost
BASE_URL="http://localhost:80"
CURL=(curl -fsS --retry 3 --retry-delay 2)
if [ "$DOMAIN" != localhost ] && [ "$DOMAIN" != 127.0.0.1 ]; then
    BASE_URL="http://${DOMAIN}"
    CURL+=(-L --resolve "${DOMAIN}:80:127.0.0.1" --resolve "${DOMAIN}:443:127.0.0.1")
fi

step() { echo -e "\n${BLUE}==> $*${NC}"; }
ok()   { echo -e "${GREEN}    $*${NC}"; }
warn() { echo -e "${YELLOW}    $*${NC}"; }
die()  { echo -e "${RED}    $*${NC}"; exit 1; }

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

command -v docker >/dev/null || die "docker is not installed"

# Caddyfile.prod uses UMAMI_DOMAIN as a site address: empty, Caddy refuses
# the whole config and the deploy dies at the reload.
[ -n "${UMAMI_DOMAIN:-}" ] || die "UMAMI_DOMAIN must be set in .env (see .env.example)"
[ -n "${UMAMI_PUBLIC_ORIGIN:-}" ] || warn "UMAMI_PUBLIC_ORIGIN is unset; the CSP will block the Umami script."

# docker-compose.prod.yml still has well-known fallbacks for these secrets. They are
# public (the defaults of MinIO, Umami, ...), so a server running on them is
# open: the Umami secret signs dashboard logins, for one. Refuse to deploy
# until real values are in .env; ALLOW_INSECURE_DEFAULTS=1 overrides it for
# a single emergency run.
# Also catches the placeholders shipped in .env.example.
is_placeholder() {
    case "$1" in
        ""|1|postgres|minioadmin|redispassword123|umami|change_me|change-me|changeme) return 0 ;;
        *) return 1 ;;
    esac
}
insecure=()
for var in DB_PASSWORD REDIS_PASSWORD AWS_SECRET_ACCESS_KEY UMAMI_DB_PASSWORD UMAMI_APP_SECRET; do
    is_placeholder "${!var:-}" && insecure+=("$var")
done
if [ "${#insecure[@]}" -gt 0 ]; then
    if [ "${ALLOW_INSECURE_DEFAULTS:-0}" = 1 ]; then
        warn "Deploying with default/insecure values for: ${insecure[*]} (ALLOW_INSECURE_DEFAULTS=1)"
    else
        die "Refusing to deploy with default/insecure values for: ${insecure[*]}. Set them in .env (or rerun with ALLOW_INSECURE_DEFAULTS=1 once)."
    fi
fi

step "Frontend: ${FRONTEND_IMAGE}"
docker pull "$FRONTEND_IMAGE"
docker volume create "$FRONTEND_VOLUME" >/dev/null
docker run --rm -v "${FRONTEND_VOLUME}:/srv/frontend" "$FRONTEND_IMAGE" \
    sh -c 'rm -rf /srv/frontend/* && cp -r /app/dist/* /srv/frontend/'
docker run --rm -v "${FRONTEND_VOLUME}:/srv/frontend" alpine:3 test -f /srv/frontend/index.html \
    || die "frontend volume has no index.html"
ok "frontend files deployed"

step "Pulling images"
"${COMPOSE[@]}" pull web celery beat db pgbouncer redis minio createbuckets caddy umami_db umami \
    jikan jikan_mongodb jikan_typesense
"${COMPOSE[@]}" build backup

step "Core services (also removes old daphne / extra celery worker containers)"
"${COMPOSE[@]}" up -d --no-deps --remove-orphans db redis minio
"${COMPOSE[@]}" up -d --wait db pgbouncer redis minio
"${COMPOSE[@]}" up --no-deps --exit-code-from createbuckets createbuckets >/dev/null \
    || die "bucket setup failed"

step "Migrations"
"${COMPOSE[@]}" run --rm --no-deps -e DB_USE_PGBOUNCER=False -e DB_HOST=db -e DB_PORT=5432 \
    web python manage.py migrate --noinput
ok "migrations applied"

step "Self-hosted Jikan"
"${COMPOSE[@]}" up -d --wait jikan_mongodb
"${COMPOSE[@]}" up -d jikan_typesense jikan
jikan_ready() {
    "${COMPOSE[@]}" exec -T jikan sh -c '
        n1=$(wget -qO- "http://127.0.0.1:8080/v4/seasons/now?page=1&limit=25" | grep -o "\"mal_id\":" | wc -l)
        n2=$(wget -qO- "http://127.0.0.1:8080/v4/top/anime?filter=airing&page=1&limit=25" | grep -o "\"mal_id\":" | wc -l)
        echo "    seasons/now=${n1} top/airing=${n2}"
        [ "$n1" -ge 6 ] || [ "$n2" -ge 6 ]'
}
for _ in $(seq 1 30); do
    "${COMPOSE[@]}" exec -T jikan true 2>/dev/null && break
    sleep 2
done
if ! jikan_ready; then
    warn "Jikan catalog under-populated, running indexers"
    for indexer in indexer:genres indexer:common indexer:anime-current-season indexer:anime-schedule; do
        "${COMPOSE[@]}" exec -T jikan php artisan "$indexer"
    done
    jikan_ready || { "${COMPOSE[@]}" logs --tail=50 jikan; die "Jikan not ready"; }
fi
ok "Jikan ready"

step "Workers, backups, analytics"
"${COMPOSE[@]}" up -d --no-deps celery beat backup
"${COMPOSE[@]}" up -d --wait umami_db
"${COMPOSE[@]}" up -d --no-deps umami

step "Web (rolling, ${SCALE_WEB} replicas)"
roll_web

step "Clearing application cache"
"${COMPOSE[@]}" exec -T web python -c "from django.core.cache import cache; cache.clear()" \
    && ok "cache cleared" || warn "cache clear failed (continuing)"

step "Caddy"
"${COMPOSE[@]}" up -d --no-deps caddy
"${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force \
    || { "${COMPOSE[@]}" logs --tail=50 caddy; die "caddy reload failed"; }

step "Smoke tests (${BASE_URL})"
"${CURL[@]}" "${BASE_URL}/api/v1/health/" >/dev/null || die "API health check failed"
ok "API healthy"
html="$("${CURL[@]}" "${BASE_URL}/" || true)"
echo "$html" | grep -q 'id="root"' || die "homepage did not return the SPA"
asset="$(echo "$html" | grep -oE '/assets/[^" ]+\.js' | head -n1 || true)"
if [ -n "$asset" ]; then
    "${CURL[@]}" "${BASE_URL}${asset}" >/dev/null || die "frontend asset ${asset} not reachable"
fi
ok "frontend served"

step "Pruning old images"
docker image prune -f --filter "until=24h" >/dev/null

echo -e "\n${GREEN}Deployment complete.${NC}"
"${COMPOSE[@]}" ps
