#!/usr/bin/env bash
set -Eeuo pipefail

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
TYPE="${1:-manual}" # manual, daily, weekly, pre-restore
LOCK_DIR="$BACKUP_DIR/.backup.lock"

DB_HOST="${POSTGRES_HOST:-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:?POSTGRES_DB is required}"
DB_USER="${POSTGRES_USER:?POSTGRES_USER is required}"
DB_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

INCLUDE_DB="${BACKUP_INCLUDE_DB:-1}"
INCLUDE_MEDIA="${BACKUP_INCLUDE_MEDIA:-1}"
SKIP_LOCK="${BACKUP_SKIP_LOCK:-0}"
OUTPUT_PATH_FILE="${BACKUP_OUTPUT_PATH_FILE:-}"
MEDIA_COMPRESS_LEVEL="${BACKUP_MEDIA_COMPRESS_LEVEL:-1}"
MEDIA_RSYNC_PASSES="${BACKUP_MEDIA_RSYNC_PASSES:-2}"

CURRENT_BACKUP_DIR=""
WORK_DIR=""
LOCK_ACQUIRED=0

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

cleanup() {
    if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
        rm -rf "$WORK_DIR"
    fi
    if [ "$LOCK_ACQUIRED" = "1" ] && [ -d "$LOCK_DIR" ]; then
        rmdir "$LOCK_DIR" 2>/dev/null || true
    fi
}
trap cleanup EXIT

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: Required command '$1' is not available." >&2
        exit 1
    fi
}

acquire_lock() {
    if [ "$SKIP_LOCK" = "1" ]; then
        return
    fi

    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "Error: Another backup/restore operation is currently running (lock: $LOCK_DIR)." >&2
        exit 1
    fi
    LOCK_ACQUIRED=1
}

assert_numeric_positive() {
    local value="$1"
    local name="$2"
    if ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
        echo "Error: $name must be a positive integer. Got '$value'." >&2
        exit 1
    fi
}

backup_db() {
    local out_file="$WORK_DIR/postgres.dump"
    log "Backing up PostgreSQL database '$DB_NAME' from $DB_HOST:$DB_PORT..."
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --format=custom \
        --no-owner \
        --no-privileges \
        --file "$out_file"
}

backup_media() {
    local out_file="$WORK_DIR/minio_data.tar.gz"
    local snapshot_dir="$WORK_DIR/minio_snapshot"
    local pass=1
    if [ ! -d /minio_data ]; then
        echo "Error: /minio_data directory not found in backup container." >&2
        exit 1
    fi
    mkdir -p "$snapshot_dir"

    log "Staging MinIO data snapshot (passes=$MEDIA_RSYNC_PASSES)..."
    while [ "$pass" -le "$MEDIA_RSYNC_PASSES" ]; do
        rsync \
            -a \
            --delete \
            --exclude=".minio.sys/" \
            /minio_data/ "$snapshot_dir/"
        local rsync_status=$?
        if [ "$rsync_status" -ne 0 ]; then
            if [ "$rsync_status" -ne 24 ]; then
                echo "Error: rsync failed while staging MinIO data (exit=$rsync_status)." >&2
                exit "$rsync_status"
            fi
            log "MinIO snapshot pass $pass completed with transient file changes (rsync exit 24); retrying if passes remain."
        fi
        pass=$((pass + 1))
    done

    log "Creating MinIO archive from staged snapshot..."
    GZIP="-${MEDIA_COMPRESS_LEVEL}" tar -czf "$out_file" -C "$snapshot_dir" .
}

write_manifest() {
    local created_at db_sha db_size media_sha media_size
    created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    db_sha="none"
    db_size="0"
    media_sha="none"
    media_size="0"

    if [ "$INCLUDE_DB" = "1" ] && [ -f "$WORK_DIR/postgres.dump" ]; then
        db_sha="$(sha256sum "$WORK_DIR/postgres.dump" | awk '{print $1}')"
        db_size="$(wc -c <"$WORK_DIR/postgres.dump" | tr -d '[:space:]')"
    fi
    if [ "$INCLUDE_MEDIA" = "1" ] && [ -f "$WORK_DIR/minio_data.tar.gz" ]; then
        media_sha="$(sha256sum "$WORK_DIR/minio_data.tar.gz" | awk '{print $1}')"
        media_size="$(wc -c <"$WORK_DIR/minio_data.tar.gz" | tr -d '[:space:]')"
    fi

    cat >"$WORK_DIR/backup_manifest.env" <<EOF
BACKUP_VERSION=2
TIMESTAMP=$TIMESTAMP
TYPE=$TYPE
CREATED_AT_UTC=$created_at
HOSTNAME=$(hostname 2>/dev/null || echo unknown)
DB_DUMP_FILE=postgres.dump
DB_DUMP_SHA256=$db_sha
DB_DUMP_SIZE_BYTES=$db_size
MINIO_ARCHIVE_FILE=minio_data.tar.gz
MINIO_ARCHIVE_SHA256=$media_sha
MINIO_ARCHIVE_SIZE_BYTES=$media_size
POSTGRES_HOST=$DB_HOST
POSTGRES_PORT=$DB_PORT
POSTGRES_DB=$DB_NAME
POSTGRES_USER=$DB_USER
EOF

    : >"$WORK_DIR/checksums.sha256"
    if [ "$INCLUDE_DB" = "1" ] && [ -f "$WORK_DIR/postgres.dump" ]; then
        (cd "$WORK_DIR" && sha256sum "postgres.dump" >>"checksums.sha256")
    fi
    if [ "$INCLUDE_MEDIA" = "1" ] && [ -f "$WORK_DIR/minio_data.tar.gz" ]; then
        (cd "$WORK_DIR" && sha256sum "minio_data.tar.gz" >>"checksums.sha256")
    fi
}

prune_previous_backups() {
    log "Removing previous backups and keeping only $(basename "$CURRENT_BACKUP_DIR")..."
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d ! -path "$CURRENT_BACKUP_DIR" ! -name ".*" -exec rm -rf {} +
}

main() {
    require_command pg_dump
    require_command tar
    require_command rsync
    require_command sha256sum
    require_command mktemp
    require_command find

    if [ "$INCLUDE_DB" != "1" ] && [ "$INCLUDE_MEDIA" != "1" ]; then
        echo "Error: At least one of BACKUP_INCLUDE_DB or BACKUP_INCLUDE_MEDIA must be 1." >&2
        exit 1
    fi

    if ! [[ "$MEDIA_COMPRESS_LEVEL" =~ ^[1-9]$ ]]; then
        echo "Error: BACKUP_MEDIA_COMPRESS_LEVEL must be 1..9. Got '$MEDIA_COMPRESS_LEVEL'." >&2
        exit 1
    fi
    assert_numeric_positive "$MEDIA_RSYNC_PASSES" "BACKUP_MEDIA_RSYNC_PASSES"

    mkdir -p "$BACKUP_DIR"
    acquire_lock

    log "Starting backup (type=$TYPE)..."
    WORK_DIR="$(mktemp -d "$BACKUP_DIR/.tmp-backup-${TIMESTAMP}-${TYPE}.XXXXXX")"
    CURRENT_BACKUP_DIR="$BACKUP_DIR/${TIMESTAMP}-${TYPE}"

    if [ "$INCLUDE_DB" = "1" ]; then
        backup_db
    fi

    if [ "$INCLUDE_MEDIA" = "1" ]; then
        backup_media
    fi

    write_manifest

    mv "$WORK_DIR" "$CURRENT_BACKUP_DIR"
    WORK_DIR=""

    log "Backup completed successfully at $CURRENT_BACKUP_DIR"
    if [ -n "$OUTPUT_PATH_FILE" ]; then
        printf '%s\n' "$CURRENT_BACKUP_DIR" >"$OUTPUT_PATH_FILE"
    fi
    prune_previous_backups
}

main "$@"
