#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INPUT_REF="${1:-}"
shift || true

DB_HOST="${POSTGRES_HOST:-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:?POSTGRES_DB is required}"
DB_USER="${POSTGRES_USER:?POSTGRES_USER is required}"
DB_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
DB_ADMIN_DB="${POSTGRES_ADMIN_DB:-postgres}"
RUN_TS="$(date +%Y%m%d_%H%M%S)"

ASSUME_YES="${RESTORE_ASSUME_YES:-0}"
CHECK_ONLY="${RESTORE_CHECK_ONLY:-0}"
SKIP_DB_VERIFY="${RESTORE_SKIP_DB_VERIFY:-0}"
SKIP_SNAPSHOT="${RESTORE_SKIP_SNAPSHOT:-0}"
SKIP_DB="${RESTORE_SKIP_DB:-0}"
SKIP_MEDIA="${RESTORE_SKIP_MEDIA:-0}"

LOCK_DIR="$BACKUP_DIR/.backup.lock"
LOCK_ACQUIRED=0

TARGET_DIR=""
DB_FILE=""
DB_FORMAT=""
MEDIA_FILE=""

VERIFY_DB_NAME=""
APPLY_DB_NAME=""
ROLLBACK_DB_NAME=""
SNAPSHOT_PATH=""

usage() {
    cat <<EOF
Usage: $0 <TIMESTAMP_OR_BACKUP_DIR> [options]

Options:
  --yes             Proceed without interactive protection (required for apply).
  --check           Validate backup and perform DB test-restore only (no production changes).
  --skip-db-verify  Skip temporary DB test-restore validation.
  --skip-snapshot   Skip automatic pre-restore safety snapshot.
  --skip-db         Restore media only.
  --skip-media      Restore database only.
EOF
}

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

die() {
    echo "Error: $*" >&2
    if [ -n "$SNAPSHOT_PATH" ]; then
        echo "Rollback hint: restore snapshot '$SNAPSHOT_PATH' with:" >&2
        echo "  /app/shell/restore.sh $(basename "$SNAPSHOT_PATH") --yes --skip-snapshot" >&2
    fi
    exit 1
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "Required command '$1' is not available."
    fi
}

require_db_identifier() {
    local value="$1"
    local label="$2"
    if ! [[ "$value" =~ ^[A-Za-z0-9_]+$ ]]; then
        die "$label contains unsupported characters for safe restore operations: '$value'. Use letters, numbers, and underscores only."
    fi
}

cleanup() {
    if [ -n "$VERIFY_DB_NAME" ]; then
        PGPASSWORD="$DB_PASSWORD" psql \
            -v ON_ERROR_STOP=0 \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_ADMIN_DB" \
            -c "DROP DATABASE IF EXISTS \"$VERIFY_DB_NAME\" WITH (FORCE);" >/dev/null 2>&1 || true
    fi
    if [ -n "$APPLY_DB_NAME" ]; then
        PGPASSWORD="$DB_PASSWORD" psql \
            -v ON_ERROR_STOP=0 \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_ADMIN_DB" \
            -c "DROP DATABASE IF EXISTS \"$APPLY_DB_NAME\" WITH (FORCE);" >/dev/null 2>&1 || true
    fi
    if [ "$LOCK_ACQUIRED" = "1" ] && [ -d "$LOCK_DIR" ]; then
        rm -rf "$LOCK_DIR"
    fi
}
trap cleanup EXIT

parse_args() {
    if [ -z "$INPUT_REF" ]; then
        usage
        echo ""
        echo "Available backups:"
        ls -1 "$BACKUP_DIR" 2>/dev/null || true
        exit 1
    fi

    while [ $# -gt 0 ]; do
        case "$1" in
        --yes)
            ASSUME_YES=1
            ;;
        --check)
            CHECK_ONLY=1
            ;;
        --skip-db-verify)
            SKIP_DB_VERIFY=1
            ;;
        --skip-snapshot)
            SKIP_SNAPSHOT=1
            ;;
        --skip-db)
            SKIP_DB=1
            ;;
        --skip-media)
            SKIP_MEDIA=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "Unknown option '$1'."
            ;;
        esac
        shift
    done

    if [ "$SKIP_DB" = "1" ] && [ "$SKIP_MEDIA" = "1" ]; then
        die "Cannot skip both DB and media restores."
    fi
}

acquire_lock() {
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        if ! reclaim_stale_lock; then
            die "Another backup/restore operation is currently running (lock: $LOCK_DIR)."
        fi
    fi
    LOCK_ACQUIRED=1
    printf '%s %s\n' "$$" "$(hostname 2>/dev/null || echo unknown)" >"$LOCK_DIR/owner"
}

# Same rule as backup.sh: take over a lock whose owner is gone.
reclaim_stale_lock() {
    local owner_pid owner_host
    read -r owner_pid owner_host <"$LOCK_DIR/owner" 2>/dev/null || return 1
    if [ "$owner_host" = "$(hostname 2>/dev/null || echo unknown)" ] && kill -0 "$owner_pid" 2>/dev/null; then
        return 1
    fi
    echo "Warning: removing stale lock left by PID $owner_pid on $owner_host." >&2
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null
}

resolve_backup_dir() {
    if [ -d "$BACKUP_DIR/$INPUT_REF" ]; then
        TARGET_DIR="$BACKUP_DIR/$INPUT_REF"
    else
        TARGET_DIR="$(find "$BACKUP_DIR" -maxdepth 1 -type d -name "${INPUT_REF}-*" | sort | tail -n 1)"
    fi

    if [ -z "$TARGET_DIR" ] || [ ! -d "$TARGET_DIR" ]; then
        die "Backup with reference '$INPUT_REF' not found."
    fi
}

load_artifacts() {
    if [ "$SKIP_DB" != "1" ]; then
        if [ -f "$TARGET_DIR/postgres.dump" ]; then
            DB_FILE="$TARGET_DIR/postgres.dump"
            DB_FORMAT="custom"
        elif [ -f "$TARGET_DIR/db_dump.sql.gz" ]; then
            DB_FILE="$TARGET_DIR/db_dump.sql.gz"
            DB_FORMAT="legacy-sql-gz"
        else
            die "No database dump found in '$TARGET_DIR'. Expected postgres.dump or db_dump.sql.gz."
        fi
    fi

    if [ "$SKIP_MEDIA" != "1" ]; then
        if [ -f "$TARGET_DIR/minio_data.tar.gz" ]; then
            MEDIA_FILE="$TARGET_DIR/minio_data.tar.gz"
        else
            die "No media archive found in '$TARGET_DIR' (minio_data.tar.gz)."
        fi
    fi
}

verify_checksums_if_present() {
    if [ -f "$TARGET_DIR/checksums.sha256" ]; then
        log "Validating backup checksums..."
        (cd "$TARGET_DIR" && sha256sum -c checksums.sha256)
    else
        log "No checksums file found. Running compatibility validation."
        if [ -n "$DB_FILE" ] && [ "$DB_FORMAT" = "legacy-sql-gz" ]; then
            gunzip -t "$DB_FILE"
        fi
        if [ -n "$MEDIA_FILE" ]; then
            tar -tzf "$MEDIA_FILE" >/dev/null
        fi
    fi
}

create_database() {
    local db_name="$1"
    PGPASSWORD="$DB_PASSWORD" psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_ADMIN_DB" \
        -c "DROP DATABASE IF EXISTS \"$db_name\" WITH (FORCE);"
    PGPASSWORD="$DB_PASSWORD" psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_ADMIN_DB" \
        -c "CREATE DATABASE \"$db_name\" OWNER \"$DB_USER\";"
}

restore_db_to_database() {
    local target_db="$1"
    if [ "$DB_FORMAT" = "custom" ]; then
        PGPASSWORD="$DB_PASSWORD" pg_restore \
            --exit-on-error \
            --single-transaction \
            --clean \
            --if-exists \
            --no-owner \
            --no-privileges \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$target_db" \
            "$DB_FILE"
    else
        gunzip -c "$DB_FILE" | PGPASSWORD="$DB_PASSWORD" psql \
            -v ON_ERROR_STOP=1 \
            --single-transaction \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$target_db"
    fi
}

smoke_check_database() {
    local target_db="$1"
    PGPASSWORD="$DB_PASSWORD" psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$target_db" \
        -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" >/dev/null
}

verify_restore_in_temp_db() {
    local rand_suffix
    rand_suffix="$(printf '%04d' "$((RANDOM % 10000))")"
    VERIFY_DB_NAME="restore_verify_${RUN_TS}_${rand_suffix}"
    VERIFY_DB_NAME="${VERIFY_DB_NAME:0:63}"
    require_db_identifier "$VERIFY_DB_NAME" "Temporary verify DB name"

    log "Test-restoring backup into temporary database '$VERIFY_DB_NAME'..."
    create_database "$VERIFY_DB_NAME"
    restore_db_to_database "$VERIFY_DB_NAME"
    smoke_check_database "$VERIFY_DB_NAME"

    PGPASSWORD="$DB_PASSWORD" psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_ADMIN_DB" \
        -c "DROP DATABASE IF EXISTS \"$VERIFY_DB_NAME\" WITH (FORCE);"
    VERIFY_DB_NAME=""
}

take_pre_restore_snapshot() {
    local snapshot_path_file include_db include_media
    snapshot_path_file="$(mktemp)"
    include_db=1
    include_media=1
    if [ "$SKIP_DB" = "1" ]; then
        include_db=0
    fi
    if [ "$SKIP_MEDIA" = "1" ]; then
        include_media=0
    fi

    log "Creating automatic pre-restore snapshot for rollback safety..."
    BACKUP_SKIP_LOCK=1 \
    BACKUP_INCLUDE_DB="$include_db" \
    BACKUP_INCLUDE_MEDIA="$include_media" \
    BACKUP_OUTPUT_PATH_FILE="$snapshot_path_file" \
    /app/shell/backup.sh pre-restore

    SNAPSHOT_PATH="$(cat "$snapshot_path_file" 2>/dev/null || true)"
    rm -f "$snapshot_path_file"
    if [ -z "$SNAPSHOT_PATH" ]; then
        die "Failed to capture pre-restore snapshot path."
    fi
    log "Pre-restore snapshot created at $SNAPSHOT_PATH"
}

swap_in_restored_database() {
    local rand_suffix
    rand_suffix="$(printf '%04d' "$((RANDOM % 10000))")"
    APPLY_DB_NAME="restore_apply_${RUN_TS}_${rand_suffix}"
    APPLY_DB_NAME="${APPLY_DB_NAME:0:63}"
    ROLLBACK_DB_NAME="rollback_${RUN_TS}_${rand_suffix}"
    ROLLBACK_DB_NAME="${ROLLBACK_DB_NAME:0:63}"

    require_db_identifier "$DB_NAME" "POSTGRES_DB"
    require_db_identifier "$APPLY_DB_NAME" "Apply DB name"
    require_db_identifier "$ROLLBACK_DB_NAME" "Rollback DB name"

    log "Restoring backup into staging database '$APPLY_DB_NAME'..."
    create_database "$APPLY_DB_NAME"
    restore_db_to_database "$APPLY_DB_NAME"
    smoke_check_database "$APPLY_DB_NAME"

    log "Swapping restored DB into production name '$DB_NAME'..."
    PGPASSWORD="$DB_PASSWORD" psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_ADMIN_DB" \
        <<EOF
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN ('$DB_NAME', '$APPLY_DB_NAME')
  AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS "$ROLLBACK_DB_NAME" WITH (FORCE);
ALTER DATABASE "$DB_NAME" RENAME TO "$ROLLBACK_DB_NAME";
ALTER DATABASE "$APPLY_DB_NAME" RENAME TO "$DB_NAME";
EOF

    APPLY_DB_NAME=""
    log "Database swap completed. Rollback DB kept as '$ROLLBACK_DB_NAME'."
}

restore_media() {
    if [ ! -d /minio_data ]; then
        die "/minio_data directory not found in backup container."
    fi

    log "Validating media archive..."
    tar -tzf "$MEDIA_FILE" >/dev/null

    log "Restoring MinIO data..."
    # Backups exclude .minio.sys (MinIO's own format and bucket policies), so
    # keep the live one rather than leave MinIO without it.
    find /minio_data -mindepth 1 -maxdepth 1 ! -name .minio.sys -exec rm -rf {} +
    tar -xzf "$MEDIA_FILE" -C /minio_data
}

main() {
    require_command psql
    require_command pg_restore
    require_command gunzip
    require_command tar
    require_command sha256sum
    require_command mktemp

    require_db_identifier "$DB_NAME" "POSTGRES_DB"
    require_db_identifier "$DB_USER" "POSTGRES_USER"
    if [ "$DB_ADMIN_DB" = "$DB_NAME" ]; then
        die "POSTGRES_ADMIN_DB must not be the same as POSTGRES_DB for swap-restore operations."
    fi

    parse_args "$@"
    acquire_lock
    resolve_backup_dir
    load_artifacts

    log "Preparing restore from $TARGET_DIR"
    verify_checksums_if_present

    if [ "$SKIP_DB" != "1" ] && [ "$SKIP_DB_VERIFY" != "1" ]; then
        verify_restore_in_temp_db
    fi

    if [ "$CHECK_ONLY" = "1" ]; then
        log "Backup verification finished successfully (check mode)."
        exit 0
    fi

    if [ "$ASSUME_YES" != "1" ]; then
        die "Refusing to apply restore without --yes."
    fi

    if [ "$SKIP_SNAPSHOT" != "1" ]; then
        take_pre_restore_snapshot
    else
        log "Skipping pre-restore snapshot (--skip-snapshot)."
    fi

    if [ "$SKIP_DB" != "1" ]; then
        swap_in_restored_database
    fi

    if [ "$SKIP_MEDIA" != "1" ]; then
        restore_media
    fi

    log "Restore completed successfully from $(basename "$TARGET_DIR")."
    if [ -n "$ROLLBACK_DB_NAME" ]; then
        log "Rollback DB retained: $ROLLBACK_DB_NAME"
    fi
    if [ -n "$SNAPSHOT_PATH" ]; then
        log "Pre-restore snapshot available: $SNAPSHOT_PATH"
    fi
}

main "$@"
