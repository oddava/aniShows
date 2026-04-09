#!/bin/bash
#
# Production deployment script for anishows using GHCR
# Deploys both frontend (from GHCR image -> Docker volume) and backend services
# Also handles Caddy reload, migrations, static files, and cleanup

set -e

if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
FRONTEND_IMAGE="ghcr.io/oddava/anishows-frontend:latest"
FRONTEND_VOLUME="anishows_frontend_dist"
SCALE_WEB="${SCALE_WEB:-2}"
SCALE_DAPHNE="${SCALE_DAPHNE:-2}"
SCALE_CELERY="${SCALE_CELERY:-1}"
SCALE_CELERY_PRIORITY="${SCALE_CELERY_PRIORITY:-1}"
SCALE_CELERY_IMAGES="${SCALE_CELERY_IMAGES:-1}"
SCALE_CELERY_ANALYTICS="${SCALE_CELERY_ANALYTICS:-1}"
DOMAIN_NAME_RAW="${DOMAIN_NAME:-localhost}"
FRONTEND_HOST="${DOMAIN_NAME_RAW#http://}"
FRONTEND_HOST="${FRONTEND_HOST#https://}"
FRONTEND_HOST="${FRONTEND_HOST%%,*}"
FRONTEND_HOST="${FRONTEND_HOST%% *}"
FRONTEND_HOST="${FRONTEND_HOST%%/*}"
FRONTEND_HOST="${FRONTEND_HOST%%:*}"
[ -z "$FRONTEND_HOST" ] && FRONTEND_HOST="localhost"

FRONTEND_BASE_URL="http://localhost:80"
FRONTEND_CURL=(curl -fsS --retry 3 --retry-delay 2)
if [ "$FRONTEND_HOST" != "localhost" ] && [ "$FRONTEND_HOST" != "127.0.0.1" ]; then
    FRONTEND_BASE_URL="http://${FRONTEND_HOST}"
    FRONTEND_CURL+=(-L --resolve "${FRONTEND_HOST}:80:127.0.0.1" --resolve "${FRONTEND_HOST}:443:127.0.0.1")
fi

array_contains() {
    local needle="$1"
    shift
    local item
    for item in "$@"; do
        if [ "$item" = "$needle" ]; then
            return 0
        fi
    done
    return 1
}

container_readiness() {
    docker inspect --format '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}{{else}}stopped{{end}}' "$1" 2>/dev/null || echo "missing"
}

wait_for_container_ready() {
    local container_id="$1"
    local service_name="$2"
    local timeout_seconds="${3:-180}"
    local status

    for _ in $(seq 1 "$timeout_seconds"); do
        status="$(container_readiness "$container_id")"
        case "$status" in
            healthy|running)
                return 0
                ;;
            unhealthy|stopped|missing|dead|exited)
                break
                ;;
        esac
        sleep 1
    done

    echo -e "${RED}  ${service_name} container ${container_id} did not become ready.${NC}"
    return 1
}

wait_for_service_replicas_ready() {
    local service_name="$1"
    local expected_count="$2"
    local timeout_seconds="${3:-180}"
    local ids=()
    local ready_count
    local status

    for _ in $(seq 1 "$timeout_seconds"); do
        mapfile -t ids < <($COMPOSE_CMD ps -q "$service_name")
        if [ "${#ids[@]}" -ne "$expected_count" ]; then
            sleep 2
            continue
        fi

        ready_count=0
        for container_id in "${ids[@]}"; do
            status="$(container_readiness "$container_id")"
            case "$status" in
                healthy|running)
                    ready_count=$((ready_count + 1))
                    ;;
            esac
        done

        if [ "$ready_count" -eq "$expected_count" ]; then
            return 0
        fi

        sleep 2
    done

    echo -e "${RED}  ${service_name} did not reach ${expected_count} ready replicas in time.${NC}"
    $COMPOSE_CMD ps "$service_name" || true
    $COMPOSE_CMD logs --tail=50 "$service_name" || true
    return 1
}

validate_jikan_catalog() {
    echo -e "${BLUE}  Validating Jikan catalog readiness...${NC}"

    local validation_output
    if ! validation_output="$($COMPOSE_CMD exec -T jikan sh -lc '
season_now_count="$(wget -qO- "http://127.0.0.1:8080/v4/seasons/now?page=1&limit=25" | grep -o "\"mal_id\":" | wc -l | tr -d " ")"
top_airing_count="$(wget -qO- "http://127.0.0.1:8080/v4/top/anime?filter=airing&page=1&limit=25" | grep -o "\"mal_id\":" | wc -l | tr -d " ")"

echo "seasons_now_count=${season_now_count}"
echo "top_airing_count=${top_airing_count}"

if [ "${season_now_count}" -lt 6 ] && [ "${top_airing_count}" -lt 6 ]; then
    exit 1
fi
' 2>&1)"; then
        echo -e "${RED}  Jikan catalog validation failed.${NC}"
        if [ -n "$validation_output" ]; then
            echo "$validation_output"
        fi
        return 1
    fi

    echo "$validation_output"
    echo -e "${GREEN}  Jikan catalog readiness looks valid.${NC}"
}

hydrate_jikan_catalog() {
    echo -e "${YELLOW}  Jikan catalog is under-populated. Running bootstrap indexers...${NC}"
    $COMPOSE_CMD exec -T jikan php artisan indexer:genres
    $COMPOSE_CMD exec -T jikan php artisan indexer:common
    $COMPOSE_CMD exec -T jikan php artisan indexer:anime-current-season
    $COMPOSE_CMD exec -T jikan php artisan indexer:anime-schedule
}

rolling_refresh_service() {
    local service_name="$1"
    local desired_count="$2"
    local timeout_seconds="${3:-180}"
    local original_ids=()
    local current_ids=()
    local pre_ids=()
    local old_id
    local candidate_id=""
    local surge_target

    mapfile -t original_ids < <($COMPOSE_CMD ps -q "$service_name")

    if [ "${#original_ids[@]}" -eq 0 ]; then
        echo -e "${BLUE}  Bootstrapping ${service_name} to ${desired_count} replicas...${NC}"
        $COMPOSE_CMD up -d --no-deps --no-recreate --scale "${service_name}=${desired_count}" "$service_name"
        wait_for_service_replicas_ready "$service_name" "$desired_count" "$timeout_seconds"
        return 0
    fi

    for old_id in "${original_ids[@]}"; do
        if ! docker inspect "$old_id" >/dev/null 2>&1; then
            continue
        fi

        mapfile -t pre_ids < <($COMPOSE_CMD ps -q "$service_name")
        surge_target=$((${#pre_ids[@]} + 1))
        candidate_id=""

        echo -e "${BLUE}  Launching replacement for ${service_name} container ${old_id:0:12}...${NC}"
        $COMPOSE_CMD up -d --no-deps --no-recreate --scale "${service_name}=${surge_target}" "$service_name"

        for _ in $(seq 1 "$timeout_seconds"); do
            mapfile -t current_ids < <($COMPOSE_CMD ps -q "$service_name")
            for container_id in "${current_ids[@]}"; do
                if ! array_contains "$container_id" "${pre_ids[@]}"; then
                    candidate_id="$container_id"
                    break
                fi
            done

            if [ -n "$candidate_id" ]; then
                break
            fi
            sleep 1
        done

        if [ -z "$candidate_id" ]; then
            echo -e "${RED}  Failed to identify new ${service_name} container during rollout.${NC}"
            $COMPOSE_CMD logs --tail=50 "$service_name" || true
            return 1
        fi

        wait_for_container_ready "$candidate_id" "$service_name" "$timeout_seconds"

        echo -e "${BLUE}  Removing old ${service_name} container ${old_id:0:12}...${NC}"
        docker rm -f "$old_id" >/dev/null
        wait_for_service_replicas_ready "$service_name" "${#pre_ids[@]}" "$timeout_seconds"
    done

    $COMPOSE_CMD up -d --no-deps --no-recreate --scale "${service_name}=${desired_count}" "$service_name"
    wait_for_service_replicas_ready "$service_name" "$desired_count" "$timeout_seconds"
}

echo -e "${BLUE}Starting full deployment (frontend + backend)...${NC}"
echo ""

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed${NC}"
    exit 1
fi

# =========================================================================
# FRONTEND DEPLOYMENT
# =========================================================================
echo -e "${BLUE}Step 1: Deploying frontend...${NC}"

echo -e "${BLUE}  Pulling latest frontend image from GHCR...${NC}"
if docker pull $FRONTEND_IMAGE; then
    echo -e "${GREEN}  Frontend image pulled!${NC}"
else
    echo -e "${YELLOW}  Failed to pull frontend image (may need: docker login ghcr.io)${NC}"
    echo -e "${YELLOW}  Skipping frontend deployment, continuing with backend...${NC}"
    SKIP_FRONTEND=true
fi

if [ "$SKIP_FRONTEND" != "true" ]; then
    echo -e "${BLUE}  Deploying new frontend files...${NC}"
    # Clean out old files and copy new ones
    docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend $FRONTEND_IMAGE sh -c '
        rm -rf /srv/frontend/* &&
        cp -r /app/dist/* /srv/frontend/ &&
        echo DONE
    '

    echo -e "${BLUE}  Verifying frontend assets...${NC}"
    if docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend alpine:latest test -f /srv/frontend/index.html; then
        echo -e "${GREEN}  Frontend deployed successfully!${NC}"
    else
        echo -e "${RED}  Frontend deployment failed - index.html not found!${NC}"
    fi
fi
echo ""

# =========================================================================
# BACKEND DEPLOYMENT
# =========================================================================
echo -e "${BLUE}Step 2: Pulling latest backend images from GHCR...${NC}"
$COMPOSE_CMD pull web celery celery_priority celery_images celery_analytics beat daphne
echo -e "${GREEN}Backend images pulled!${NC}"
echo ""

# =========================================================================
# PULL THIRD-PARTY SERVICE IMAGES
# =========================================================================
echo -e "${BLUE}Step 2a: Pulling third-party service images...${NC}"
$COMPOSE_CMD pull umami jikan jikan_mongodb jikan_typesense || true
echo -e "${GREEN}Third-party service images pulled!${NC}"
echo ""

# =========================================================================
# BUILD LOCAL-ONLY SERVICES
# =========================================================================
echo -e "${BLUE}Step 2b: Building local infrastructure images...${NC}"
$COMPOSE_CMD build backup
echo -e "${GREEN}Local infrastructure images built!${NC}"
echo ""

# =========================================================================
# RUN MIGRATIONS BEFORE RESTARTING (new code must handle old+new schema)
# =========================================================================
echo -e "${BLUE}Step 3: Running database migrations (before restart)...${NC}"
# Ensure core infra is up before running migrations and backups
$COMPOSE_CMD up -d --no-deps db redis minio
echo -e "${BLUE}  Waiting for database to be ready...${NC}"
for i in $(seq 1 30); do
    if $COMPOSE_CMD exec -T db pg_isready -U "${DB_USER:-postgres}" -d "${DB_NAME:-anishows_db}" >/dev/null 2>&1; then
        echo -e "${GREEN}  Database is ready!${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}  Database failed to become ready after 30 attempts!${NC}"
        $COMPOSE_CMD logs --tail=20 db
        exit 1
    fi
    sleep 2
done

# Run migrations using compose run with --no-deps to avoid recreating other services
$COMPOSE_CMD run --rm --no-deps -e DB_USE_PGBOUNCER=False -e DB_HOST="${PGBOUNCER_DB_HOST:-db}" -e DB_PORT="5432" web python manage.py migrate --noinput
echo -e "${GREEN}Migrations complete!${NC}"
echo ""

# Start self-hosted Jikan infrastructure before rolling app services that depend on it.
echo -e "${BLUE}Step 3a: Starting self-hosted Jikan services...${NC}"
$COMPOSE_CMD up -d jikan_mongodb jikan_typesense jikan
echo -e "${BLUE}  Waiting for Jikan API to start...${NC}"
for i in $(seq 1 30); do
    if $COMPOSE_CMD ps --status running jikan | grep -q "jikan"; then
        echo -e "${GREEN}  Jikan API is running!${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}  Jikan failed to start after 30 attempts!${NC}"
        $COMPOSE_CMD logs --tail=50 jikan_mongodb jikan_typesense jikan || true
        exit 1
    fi
    sleep 2
done
if ! validate_jikan_catalog; then
    hydrate_jikan_catalog
    if ! validate_jikan_catalog; then
        $COMPOSE_CMD logs --tail=50 jikan_mongodb jikan_typesense jikan || true
        exit 1
    fi
fi
echo ""

# Start PgBouncer now that DB is ready (web and workers connect through it)
$COMPOSE_CMD up -d --no-deps pgbouncer
echo -e "${BLUE}  Waiting for PgBouncer to be healthy...${NC}"
for i in $(seq 1 15); do
    if $COMPOSE_CMD exec -T pgbouncer pg_isready -h localhost -p "${DB_PGBOUNCER_PORT:-6432}" -U "${DB_USER:-postgres}" >/dev/null 2>&1; then
        echo -e "${GREEN}  PgBouncer is ready!${NC}"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo -e "${RED}  PgBouncer failed to become ready after 15 attempts!${NC}"
        $COMPOSE_CMD logs --tail=20 pgbouncer
        exit 1
    fi
    sleep 2
done
echo ""

# =========================================================================
# RESTART SERVICES (rolling restart for zero-downtime)
# =========================================================================
echo -e "${BLUE}Step 4: Restarting services...${NC}"
$COMPOSE_CMD up -d --no-deps backup
$COMPOSE_CMD up -d umami_db
echo -e "${BLUE}  Waiting for Umami database to be healthy...${NC}"
for i in $(seq 1 20); do
    if $COMPOSE_CMD exec -T umami_db pg_isready -U "${UMAMI_DB_USER:-umami}" -d "${UMAMI_DB_NAME:-umami}" >/dev/null 2>&1; then
        echo -e "${GREEN}  Umami database is ready!${NC}"
        break
    fi
    if [ "$i" -eq 20 ]; then
        echo -e "${RED}  Umami database failed to become ready after 20 attempts!${NC}"
        $COMPOSE_CMD logs --tail=50 umami_db || true
        exit 1
    fi
    sleep 2
done

$COMPOSE_CMD up -d umami
echo -e "${BLUE}  Waiting for Umami to start...${NC}"
for i in $(seq 1 20); do
    if $COMPOSE_CMD ps --status running umami | grep -q "umami"; then
        echo -e "${GREEN}  Umami is running!${NC}"
        break
    fi
    if [ "$i" -eq 20 ]; then
        echo -e "${RED}  Umami failed to start after 20 attempts!${NC}"
        $COMPOSE_CMD logs --tail=50 umami || true
        exit 1
    fi
    sleep 2
done

# Restart workers first, then web (reverse proxy keeps serving old containers until healthy)
$COMPOSE_CMD up -d --no-deps \
  --scale celery=$SCALE_CELERY \
  --scale celery_priority=$SCALE_CELERY_PRIORITY \
  --scale celery_images=$SCALE_CELERY_IMAGES \
  --scale celery_analytics=$SCALE_CELERY_ANALYTICS \
  celery celery_priority celery_images celery_analytics beat
sleep 2
rolling_refresh_service web "$SCALE_WEB"
rolling_refresh_service daphne "$SCALE_DAPHNE"
echo -e "${GREEN}Web and Daphne replicas refreshed with rolling replacement!${NC}"
echo -e "${BLUE}  Scale profile: web=$SCALE_WEB daphne=$SCALE_DAPHNE celery=$SCALE_CELERY celery_priority=$SCALE_CELERY_PRIORITY celery_images=$SCALE_CELERY_IMAGES celery_analytics=$SCALE_CELERY_ANALYTICS${NC}"
echo ""

# =========================================================================
# CLEAR APPLICATION CACHE (not broker data)
# =========================================================================
echo -e "${BLUE}Step 5: Clearing application cache...${NC}"
# Use Django's cache.clear() via management shell instead of FLUSHALL
# This only clears the cache, preserving Celery broker state and pending tasks
if $COMPOSE_CMD exec -T web python -c "
from django.core.cache import cache
cache.clear()
print('Cache cleared successfully')
" 2>/dev/null; then
    echo -e "${GREEN}Application cache cleared!${NC}"
else
    echo -e "${YELLOW}Cache clear warning (service may still be starting)${NC}"
fi
echo ""

echo -e "${BLUE}Step 6: Ensuring Caddy is running...${NC}"
echo -e "${BLUE}  Verifying web and websocket upstream readiness...${NC}"
wait_for_service_replicas_ready web "$SCALE_WEB"
wait_for_service_replicas_ready daphne "$SCALE_DAPHNE"

$COMPOSE_CMD up -d --no-deps caddy

CADDY_RUNNING=false
for i in $(seq 1 10); do
    if $COMPOSE_CMD ps --status running caddy | grep -q "caddy"; then
        CADDY_RUNNING=true
        break
    fi
    sleep 2
done

if [ "$CADDY_RUNNING" != "true" ]; then
    echo -e "${RED}Caddy failed to start.${NC}"
    $COMPOSE_CMD logs --tail=50 caddy || true
    exit 1
fi

echo -e "${BLUE}  Reloading Caddy config...${NC}"
if $COMPOSE_CMD exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force; then
    echo -e "${GREEN}Caddy reloaded successfully!${NC}"
else
    echo -e "${RED}Caddy reload failed.${NC}"
    $COMPOSE_CMD logs --tail=50 caddy || true
    exit 1
fi

echo -e "${BLUE}  Verifying Caddy HTTP endpoint...${NC}"
if ! "${FRONTEND_CURL[@]}" "${FRONTEND_BASE_URL}/api/v1/health/" >/dev/null; then
    echo -e "${RED}Caddy endpoint health check failed.${NC}"
    echo -e "${YELLOW}  Probe URL: ${FRONTEND_BASE_URL}/api/v1/health/ (host=${FRONTEND_HOST})${NC}"
    $COMPOSE_CMD logs --tail=50 caddy || true
    exit 1
fi
echo -e "${BLUE}  Verifying Daphne websocket upstream health...${NC}"
DAPHNE_UPSTREAM_OK=false
for i in $(seq 1 12); do
if $COMPOSE_CMD exec -T daphne python -c "
import urllib.request
request = urllib.request.Request(
    'http://localhost:8001/api/v1/health/',
    headers={'Host': '${FRONTEND_HOST}'},
)
response = urllib.request.urlopen(request, timeout=5)
print(response.read().decode())
" 2>/dev/null; then
    DAPHNE_UPSTREAM_OK=true
    break
fi
echo -e "${YELLOW}  Daphne upstream check attempt $i failed, retrying in 3s...${NC}"
sleep 3
done

if [ "$DAPHNE_UPSTREAM_OK" != "true" ]; then
    echo -e "${RED}Daphne websocket upstream health check failed.${NC}"
    $COMPOSE_CMD ps daphne || true
    $COMPOSE_CMD logs --tail=80 daphne || true
    exit 1
fi
echo -e "${GREEN}Caddy is running and serving traffic.${NC}"
echo ""

# =========================================================================
# HEALTH CHECK
# =========================================================================
echo -e "${BLUE}Step 7: Verifying deployment health...${NC}"
sleep 5
HEALTH_OK=false
for i in 1 2 3; do
    if $COMPOSE_CMD exec -T web python -c "
import urllib.request
response = urllib.request.urlopen('http://localhost:8000/api/v1/health/', timeout=5)
print(response.read().decode())
" 2>/dev/null; then
        HEALTH_OK=true
        break
    fi
    echo -e "${YELLOW}  Health check attempt $i failed, retrying in 5s...${NC}"
    sleep 5
done

if [ "$HEALTH_OK" = true ]; then
    echo -e "${GREEN}Health check passed!${NC}"
else
    echo -e "${RED}Health check failed after 3 attempts!${NC}"
    echo -e "${YELLOW}Checking container logs...${NC}"
    $COMPOSE_CMD logs --tail=20 web
    exit 1
fi
echo ""

# =========================================================================
# FRONTEND SMOKE CHECK
# =========================================================================
echo -e "${BLUE}Step 8: Verifying frontend is servable...${NC}"
echo -e "${BLUE}  Frontend probe URL: ${FRONTEND_BASE_URL}/ (host=${FRONTEND_HOST})${NC}"
FRONTEND_HTML="$("${FRONTEND_CURL[@]}" "${FRONTEND_BASE_URL}/" || true)"

if [ -z "$FRONTEND_HTML" ]; then
    echo -e "${RED}Frontend health check failed: could not fetch homepage HTML.${NC}"
    FRONTEND_DEBUG_CURL=(curl -sS -o /tmp/frontend-health-body.$$ -w "%{http_code}" --retry 1)
    if [ "$FRONTEND_HOST" != "localhost" ] && [ "$FRONTEND_HOST" != "127.0.0.1" ]; then
        FRONTEND_DEBUG_CURL+=(-L --resolve "${FRONTEND_HOST}:80:127.0.0.1" --resolve "${FRONTEND_HOST}:443:127.0.0.1")
    fi
    FRONTEND_STATUS="$("${FRONTEND_DEBUG_CURL[@]}" "${FRONTEND_BASE_URL}/" || true)"
    echo -e "${YELLOW}  HTTP status: ${FRONTEND_STATUS:-unknown}${NC}"
    if [ -f /tmp/frontend-health-body.$$ ]; then
        echo -e "${YELLOW}  Response preview:${NC}"
        sed -n '1,8p' /tmp/frontend-health-body.$$ || true
        rm -f /tmp/frontend-health-body.$$
    fi
    exit 1
fi

if ! echo "$FRONTEND_HTML" | grep -q 'id="root"'; then
    echo -e "${RED}Frontend health check failed: root element not found in homepage HTML.${NC}"
    exit 1
fi

FRONTEND_ASSET_PATH="$(echo "$FRONTEND_HTML" | grep -oE '/assets/[^" ]+\.js' | head -n1)"
if [ -n "$FRONTEND_ASSET_PATH" ]; then
    if ! "${FRONTEND_CURL[@]}" "${FRONTEND_BASE_URL}${FRONTEND_ASSET_PATH}" >/dev/null; then
        echo -e "${RED}Frontend health check failed: asset ${FRONTEND_ASSET_PATH} is not reachable.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Frontend health warning: no /assets/*.js script found in index HTML.${NC}"
fi
echo -e "${GREEN}Frontend health check passed!${NC}"
echo ""

echo -e "${BLUE}Step 9: Pruning old images...${NC}"
docker image prune -f --filter "until=24h" --filter "label=org.opencontainers.image.source=https://github.com/oddava/anishows"
echo -e "${GREEN}Old images pruned!${NC}"
echo ""

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}Services status:${NC}"
$COMPOSE_CMD ps

echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo -e "   ${BLUE}View logs:${NC} $COMPOSE_CMD logs -f web"
echo -e "   ${BLUE}View all logs:${NC} $COMPOSE_CMD logs -f"
