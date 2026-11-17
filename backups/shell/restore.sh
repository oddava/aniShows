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
# libpq treats an empty PGSSLROOTCERT as a path; unset means its default.
[ -n "${PGSSLROOTCERT:-}" ] || unset PGSSLROOTCERT
DB_ADMIN_DB="${POSTGRES_ADMIN_DB:-postgres}"
RUN_TS="$(date +%Y%m%d_%H%M%S)"

ASSUME_YES="${RESTORE_ASSUME_YES:-0}"
CHECK_ONLY="${RESTORE_CHECK_ONLY:-0}"
SKIP_DB_VERIFY="${RESTORE_SKIP_DB_VERIFY:-0}"
SKIP_SNAPSHOT="${RESTORE_SKIP_SNAPSHOT:-0}"
SKIP_DB="${RESTORE_SKIP_DB:-0}"
SKIP_MEDIA="${RESTORE_SKIP_MEDIA:-0}"


TARGET_DIR=""
DB_FILE=""
DB_FORMAT=""
MEDIA_FILE=""
# 1 when MEDIA_FILE is an old backup's minio_data.tar.gz (a MinIO data directory).
MEDIA_LEGACY=0
MEDIA_TMP=""

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

Media is restored into the S3 bucket AWS_STORAGE_BUCKET_NAME (only that bucket)
with rclone sync: objects the backup does not hold are deleted from it.
RESTORE_ALLOW_EMPTY_MEDIA=1 allows restoring an archive with no files.
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
    if [ -n "$MEDIA_TMP" ] && [ -d "$MEDIA_TMP" ]; then
        rm -rf "$MEDIA_TMP"
    fi
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

# The same flock as backup.sh (lock.sh): held until this script exits, and
# inherited by the pre-restore snapshot it runs with BACKUP_SKIP_LOCK=1.
# shellcheck source=backups/shell/lock.sh
source "$(dirname "${BASH_SOURCE[0]}")/lock.sh"
# s3_media_env: the rclone remote for the media bucket.
# shellcheck source=backups/shell/s3.sh
source "$(dirname "${BASH_SOURCE[0]}")/s3.sh"

acquire_lock() {
    acquire_backup_lock "${BACKUP_LOCK_WAIT_SECONDS:-0}"
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

# manifest_value KEY: the value of KEY in the backup's manifest, or "".
# Read with grep, never sourced: a backup may come from another server.
manifest_value() {
    [ -f "$TARGET_DIR/backup_manifest.env" ] || return 0
    grep -m1 "^$1=" "$TARGET_DIR/backup_manifest.env" | cut -d= -f2- | tr -d '[:cntrl:]' || true
}

# The media archive of this backup: the manifest's name (MEDIA_ARCHIVE_FILE,
# or MINIO_ARCHIVE_FILE in backups made before the bucket moved to RustFS),
# else whichever of media_data.tar.gz / minio_data.tar.gz is there.
find_media_archive() {
    local name key
    for key in MEDIA_ARCHIVE_FILE MINIO_ARCHIVE_FILE; do
        name="$(manifest_value "$key")"
        if [[ "$name" =~ ^[A-Za-z0-9._-]+\.tar\.gz$ ]] && [ -f "$TARGET_DIR/$name" ]; then
            echo "$name"
            return 0
        fi
    done
    for name in media_data.tar.gz minio_data.tar.gz; do
        if [ -f "$TARGET_DIR/$name" ]; then
            echo "$name"
            return 0
        fi
    done
    return 1
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
        local media_name
        media_name="$(find_media_archive)" \
            || die "No media archive found in '$TARGET_DIR' (media_data.tar.gz, or minio_data.tar.gz in an older backup)."
        MEDIA_FILE="$TARGET_DIR/$media_name"
        if [ "$media_name" = minio_data.tar.gz ]; then
            MEDIA_LEGACY=1
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
    # Local only (BACKUP_REMOTE=): an unreachable remote must not block a
    # restore, and the snapshot of the data being replaced must never become
    # the newest off-site backup.
    BACKUP_REMOTE= \
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
    local src
    require_command rclone
    s3_media_env || die "The media bucket is not configured."

    log "Validating media archive..."
    tar -tzf "$MEDIA_FILE" >/dev/null

    MEDIA_TMP="$(mktemp -d "$BACKUP_DIR/.tmp-media-restore.XXXXXX")"
    log "Unpacking $(basename "$MEDIA_FILE")..."
    tar -xzf "$MEDIA_FILE" -C "$MEDIA_TMP"
    src="$MEDIA_TMP"

    if [ "$MEDIA_LEGACY" = "1" ]; then
        # Backups before the move to RustFS archived MinIO's data directory:
        # <bucket>/<object>/xl.meta, not the objects themselves.
        src="$MEDIA_TMP/$AWS_STORAGE_BUCKET_NAME"
        [ -d "$src" ] || die "$(basename "$MEDIA_FILE") is a MinIO data directory without a '$AWS_STORAGE_BUCKET_NAME' bucket; nothing to restore. Restore the database only with --skip-media."
        if [ -n "$(find "$src" -name xl.meta -print -quit)" ]; then
            die "$(basename "$MEDIA_FILE") holds MinIO's internal object layout (xl.meta), which cannot be copied into S3 as it is. Restore the database only (--skip-media) and re-upload the media from another source, or start MinIO on this data directory and copy the bucket out with rclone."
        fi
        log "Legacy MinIO archive: restoring the files of bucket '$AWS_STORAGE_BUCKET_NAME'."
    fi

    # sync deletes what the source lacks: an empty source would empty the bucket.
    if [ -z "$(find "$src" -type f -print -quit)" ] && [ "${RESTORE_ALLOW_EMPTY_MEDIA:-0}" != "1" ]; then
        die "The media archive holds no files; refusing to empty the bucket (RESTORE_ALLOW_EMPTY_MEDIA=1 to do it anyway)."
    fi

    log "Restoring media into s3src:$AWS_STORAGE_BUCKET_NAME ($AWS_S3_ENDPOINT_URL)..."
    rclone sync "$src" "s3src:$AWS_STORAGE_BUCKET_NAME" \
        || die "rclone could not write the media bucket (is the anishows-s3 network attached to this container? are the AWS_* values right?)."
    rm -rf "$MEDIA_TMP"
    MEDIA_TMP=""
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
    if [ "$SKIP_MEDIA" != "1" ] && [ "$CHECK_ONLY" != "1" ]; then
        # Before anything is changed: the snapshot and the restore both need it.
        require_command rclone
        s3_media_env || die "The media bucket is not configured."
    fi
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

# Sourced by the tests (functions only); run as a script otherwise.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    main "$@"
fi
