#!/usr/bin/env bash
#
# Prove a backup restores: load its database dump into a throwaway Postgres on
# the production compose network, then run the app's checks against it
# (`manage.py check`, `showmigrations --plan`, a row count). Nothing touches
# the live database or the media bucket (only the dump is loaded; the media
# archive is just checksummed with the rest), so this works with an
# external/shared Postgres too (no CREATEDB rights needed). Run on the server
# from the repo root:
#
#   scripts/deploy/verify_backup.sh                 # newest backup in backups-data/
#   scripts/deploy/verify_backup.sh 20261116_030000 # or a timestamp / directory name
#
# Env: COMPOSE_PROJECT_NAME, VERIFY_PG_IMAGE (default postgres:18-alpine; use
# the major version of the server you would restore to, e.g. postgres:16-alpine
# for an external Postgres 16: pg_dump 18 output may need a recent server).

set -euo pipefail

# shellcheck source=scripts/deploy/env.sh
source scripts/deploy/env.sh
load_deployed_state
load_env_file .env
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}"
NETWORK="${VERIFY_NETWORK:-${PROJECT}_default}"
PG_IMAGE="${VERIFY_PG_IMAGE:-postgres:18-alpine}"
# The stack's compose files and profiles, as the deploy uses them.
COMPOSE=(bash scripts/deploy/compose.sh)

die() { echo "Error: $*" >&2; exit 1; }
log() { echo "[verify-backup] $*"; }

# Backup directories are root-owned and private (mktemp -d), so read them
# through the backup service, which mounts backups-data at /backups.
in_backup() {
    "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint bash backup -c "$1" _ "${2:-}"
}

ref="${1:-}"
target="$(in_backup '
    if [ -z "$1" ]; then
        ls -1d /backups/[0-9]*_[0-9]*-*/ 2>/dev/null | sort | tail -n1
    elif [ -d "/backups/$1" ]; then
        echo "/backups/$1"
    else
        ls -1d /backups/"$1"-*/ 2>/dev/null | sort | tail -n1
    fi' "$ref" | tail -n1)"
target="${target%/}"
[ -n "$target" ] || die "no backup found for '${ref:-latest}' in backups-data/"
log "backup: $target"
in_backup '
    set -e
    cd "$1"
    [ -f postgres.dump ] || { echo "no postgres.dump (media-only backup?)" >&2; exit 1; }
    if [ -f checksums.sha256 ]; then sha256sum -c -s checksums.sha256; fi
    pg_restore --list postgres.dump >/dev/null' "$target" || die "$target: missing, corrupt or checksum mismatch"
log "dump present, checksums ok, archive readable"

docker network inspect "$NETWORK" >/dev/null 2>&1 || die "network $NETWORK not found (is the stack up? set COMPOSE_PROJECT_NAME)"

name="anishows-verify-backup-$$"
password="verify-$(date +%s)-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log "starting throwaway Postgres $name ($PG_IMAGE)"
docker run -d --rm --name "$name" --network "$NETWORK" --memory 512m \
    --tmpfs /var/lib/postgresql \
    -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=verify \
    "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
    docker exec "$name" pg_isready -U postgres -d verify >/dev/null 2>&1 && break
    sleep 1
done
docker exec "$name" pg_isready -U postgres -d verify >/dev/null || die "throwaway Postgres did not start"

log "restoring $target/postgres.dump"
in_backup 'cat "$1/postgres.dump"' "$target" \
    | docker exec -i "$name" pg_restore -U postgres -d verify --no-owner --no-privileges --exit-on-error \
    || die "pg_restore failed"

log "running the app against the restored copy"
"${COMPOSE[@]}" run --rm --no-deps -T \
    -e DB_HOST="$name" -e DB_PORT=5432 -e DB_NAME=verify -e DB_USER=postgres \
    -e DB_PASSWORD="$password" -e DB_SSLMODE=disable -e DB_POOL_MAX_SIZE=0 \
    web sh -c '
        set -e
        python manage.py check
        echo "--- migrations not yet applied in this backup (empty = up to date):"
        python manage.py showmigrations --plan | grep "^\[ \]" || true
        python manage.py shell -c "from django.contrib.auth import get_user_model; print(\"users:\", get_user_model().objects.count())" \
            || echo "users: n/a (this backup predates the schema, e.g. a first-deploy pre-migrate dump)"
    ' || die "the app could not use the restored database"

log "OK: $target restores and the app can read it"
