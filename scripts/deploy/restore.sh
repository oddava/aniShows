#!/usr/bin/env bash
#
# Restore the production stack from a backup. Run on the server from the repo
# root (where .env is):
#
#   scripts/deploy/restore.sh latest --yes                    # newest daily/weekly/manual backup
#   scripts/deploy/restore.sh 20261116_030000 --yes           # a timestamp or a full directory name
#   scripts/deploy/restore.sh latest --from-offsite --yes     # download it from BACKUP_REMOTE first
#   scripts/deploy/restore.sh 20261116_030000 --db-only --yes # or --media-only
#   scripts/deploy/restore.sh latest                          # without --yes: verify only, change nothing
#
# Steps (docs/backups.md, "Restore in production"):
#   1. (--from-offsite) fetch the backup into backups-data/ and check its checksums
#   2. verify it: checksums, and a test restore into a temporary database
#   3. stop web, celery and beat (Caddy stays up and answers 502 meanwhile)
#   4. backups/shell/restore.sh: a pre-restore snapshot of the live data, the
#      dump restored into a staging database and swapped in by name (the old
#      database is kept as rollback_<timestamp>), then the media archive
#   5. migrate (the backup may predate this release's schema)
#   6. start web, celery and beat again (also when a step above failed), clear
#      the cache, and check readiness
#
# Holds the deploy lock: a restore never runs during a deploy.

set -euo pipefail

[ -f docker-compose.prod.yml ] || { echo "Run from the repo root (docker-compose.prod.yml not found)" >&2; exit 1; }

log() { echo "[restore] $*"; }
die() { echo "[restore] ERROR: $*" >&2; exit 1; }

usage() {
    sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

REF=""
FROM_OFFSITE=0
APPLY=0
SCOPE=()
while [ $# -gt 0 ]; do
    case "$1" in
        --yes) APPLY=1 ;;
        --from-offsite) FROM_OFFSITE=1 ;;
        --db-only) SCOPE=(--skip-media) ;;
        --media-only) SCOPE=(--skip-db) ;;
        -h|--help) usage 0 ;;
        -*) echo "Unknown option: $1" >&2; usage 2 ;;
        *) [ -z "$REF" ] || die "one backup at a time (got '$REF' and '$1')"; REF="$1" ;;
    esac
    shift
done
[ -n "$REF" ] || usage 2
[[ "$REF" =~ ^[A-Za-z0-9_.-]+$ ]] || die "backup reference may contain letters, digits, '_', '-' and '.' only"

# shellcheck source=scripts/deploy/env.sh
source scripts/deploy/env.sh
load_deployed_state
load_env_file .env
SCALE_WEB="${SCALE_WEB:-1}"
COMPOSE=(bash scripts/deploy/compose.sh)
APP_SERVICES=(web celery beat)

mkdir -p backups-data
if command -v flock >/dev/null 2>&1; then
    exec 8>>backups-data/.deploy.lock
    flock -n 8 || die "a deploy (or another restore) is running (backups-data/.deploy.lock)"
fi

in_backup() {
    # The backup container has the dump tools, rclone, and backups-data at /backups.
    "${COMPOSE[@]}" exec -T backup bash -c '. /app/cron.env 2>/dev/null || true; "$@"' _ "$@"
}

"${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx backup \
    || die "the backup service is not running (scripts/deploy/compose.sh up -d backup)"

# 1. The backup to use.
if [ "$FROM_OFFSITE" = 1 ]; then
    log "fetching '$REF' from the off-site copy"
    REF="$(in_backup /app/shell/fetch_offsite.sh "$REF" | tail -n1)"
    [ -n "$REF" ] || die "nothing fetched"
elif [ "$REF" = latest ]; then
    REF="$(in_backup bash -c 'ls -1d /backups/[0-9]*_[0-9]*-daily /backups/[0-9]*_[0-9]*-weekly /backups/[0-9]*_[0-9]*-manual 2>/dev/null | sort | tail -n1 | xargs -r basename')"
    [ -n "$REF" ] || die "no daily, weekly or manual backup in backups-data/"
fi
log "backup: $REF"

# 2. Verify before anything changes.
log "verifying (checksums, test restore into a temporary database)"
in_backup /app/shell/restore.sh "$REF" --check "${SCOPE[@]}" || die "verification failed; nothing was changed"

if [ "$APPLY" != 1 ]; then
    log "verified. Nothing was changed: re-run with --yes to restore '$REF' over the live data."
    exit 0
fi

# 3-6. Stop the app, restore, migrate, start it again whatever happens.
restart_app() {
    local status=$?
    trap - EXIT
    log "starting ${APP_SERVICES[*]}"
    "${COMPOSE[@]}" up -d --no-deps --scale "web=${SCALE_WEB}" "${APP_SERVICES[@]}" \
        || echo "[restore] ERROR: could not start the app; run: scripts/deploy/compose.sh up -d" >&2
    if [ "$status" -ne 0 ]; then
        echo "[restore] ERROR: the restore failed (exit $status); see the output above." >&2
        echo "[restore] restore.sh prints a rollback hint (its pre-restore snapshot) when it got that far." >&2
    fi
    exit "$status"
}
trap restart_app EXIT

log "stopping ${APP_SERVICES[*]} (the site answers 502 until they are back)"
"${COMPOSE[@]}" stop "${APP_SERVICES[@]}"

log "restoring '$REF'"
in_backup /app/shell/restore.sh "$REF" --yes --skip-db-verify "${SCOPE[@]}"

if [[ " ${SCOPE[*]} " != *" --skip-db "* ]]; then
    log "applying this release's migrations to the restored database"
    "${COMPOSE[@]}" run --rm --no-deps -T web python manage.py migrate --noinput
fi

trap - EXIT
"${COMPOSE[@]}" up -d --no-deps --scale "web=${SCALE_WEB}" "${APP_SERVICES[@]}"

log "waiting for web to be ready"
ready=0
for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T web curl -fsS http://localhost:8000/api/v1/health/ready/ 2>/dev/null \
        | grep -q '"database": *true'; then
        ready=1
        break
    fi
    sleep 3
done
[ "$ready" = 1 ] || die "web is not ready after the restore: scripts/deploy/compose.sh logs web"

# Cached pages and counters belong to the data that was replaced.
"${COMPOSE[@]}" exec -T web python manage.py shell -c "from django.core.cache import cache; cache.clear()" \
    && log "cache cleared" || log "warning: cache clear failed; cached pages expire on their own"

log "done: '$REF' is live. The replaced database is kept as rollback_<timestamp> (drop it when satisfied)."
