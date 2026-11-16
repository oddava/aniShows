#!/usr/bin/env bash
set -Eeuo pipefail

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
TYPE="${1:-manual}" # manual, daily, weekly, pre-restore, pre-migrate
# Backups of each group (regular, pre-restore, pre-migrate) to keep, the new
# one included. Pre-migrate dumps (deploy-prod.sh, before a schema change) are
# rotated on their own, so daily backups never push them out.
KEEP="${BACKUP_KEEP:-1}"
KEEP_PRE_MIGRATE="${BACKUP_KEEP_PRE_MIGRATE:-3}"

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

# Optional off-site copy (rclone remote path, e.g. "offsite:anishows-backups").
# The remote is configured by RCLONE_CONFIG_<NAME>_* variables in .env (see
# docs/backups.md); unset = local only. Copies older than
# BACKUP_REMOTE_KEEP_DAYS are deleted from the remote.
REMOTE="${BACKUP_REMOTE:-}"
LOCK_WAIT_SECONDS="${BACKUP_LOCK_WAIT_SECONDS:-0}"
# Written after every successful scheduled/manual backup; healthcheck.sh reads it.
SUCCESS_MARKER="$BACKUP_DIR/.last-success"
# libpq treats an empty PGSSLROOTCERT as a path; unset means its default.
[ -n "${PGSSLROOTCERT:-}" ] || unset PGSSLROOTCERT
REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-30}"

CURRENT_BACKUP_DIR=""
WORK_DIR=""

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

cleanup() {
    if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
        rm -rf "$WORK_DIR"
    fi
}
trap cleanup EXIT

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: Required command '$1' is not available." >&2
        exit 1
    fi
}

# The lock lives in lock.sh (an flock shared with restore.sh across containers).
# shellcheck source=backups/shell/lock.sh
source "$(dirname "$0")/lock.sh"

acquire_lock() {
    if [ "$SKIP_LOCK" = "1" ]; then
        return
    fi
    # BACKUP_LOCK_WAIT_SECONDS > 0 waits for a running backup to finish
    # (deploy-prod.sh's pre-migrate dump vs the nightly) instead of failing.
    acquire_backup_lock "$LOCK_WAIT_SECONDS"
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
    # A truncated or corrupt archive fails here, not on the day of a restore.
    if ! pg_restore --list "$out_file" >/dev/null; then
        echo "Error: pg_restore cannot read the new dump ($out_file)." >&2
        exit 1
    fi
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
        # "|| ..." keeps set -e from aborting on exit 24 (files vanished
        # mid-copy), which is normal while MinIO is writing.
        local rsync_status=0
        rsync \
            -a \
            --delete \
            --exclude=".minio.sys/" \
            /minio_data/ "$snapshot_dir/" || rsync_status=$?
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

# Rotation only touches timestamped backups of the current run's group:
# regular (manual/daily/weekly) or pre-restore. A pre-restore snapshot must
# never remove the backup being restored, and exports/, imported-env/ and
# imported backups (named *-imported) are never rotated.
prune_previous_backups() {
    local group_pattern
    local keep="$KEEP"
    if [ "$TYPE" = "pre-restore" ]; then
        group_pattern='^[0-9]{8}_[0-9]{6}-pre-restore$'
    elif [ "$TYPE" = "pre-migrate" ]; then
        group_pattern='^[0-9]{8}_[0-9]{6}-pre-migrate$'
        keep="$KEEP_PRE_MIGRATE"
    else
        group_pattern='^[0-9]{8}_[0-9]{6}-(manual|daily|weekly)$'
    fi

    log "Keeping the newest $keep backup(s) of this kind..."
    local path name
    local -a group=()
    for path in "$BACKUP_DIR"/*/; do
        name="$(basename "$path")"
        if [[ "$name" =~ $group_pattern ]]; then
            group+=("$name")
        fi
    done
    if [ "${#group[@]}" -le "$keep" ]; then
        return
    fi
    # Names start with the timestamp, so a reverse sort is newest first.
    printf '%s\n' "${group[@]}" | sort -r | tail -n +"$((keep + 1))" | while IFS= read -r name; do
        log "Removing old backup $name"
        rm -rf "${BACKUP_DIR:?}/$name"
    done
}

# Copy the finished backup off this host. A failure leaves the local backup in
# place and makes the run fail, so cron mail / the deploy log shows it.
upload_offsite() {
    if [ -z "$REMOTE" ]; then
        return 0
    fi
    require_command rclone
    local name
    name="$(basename "$CURRENT_BACKUP_DIR")"
    log "Uploading $name to off-site remote $REMOTE..."
    if ! rclone copy --checksum --no-traverse "$CURRENT_BACKUP_DIR" "$REMOTE/$name"; then
        echo "Error: off-site upload to $REMOTE failed; the local backup is kept." >&2
        return 1
    fi
    if ! rclone check --one-way "$CURRENT_BACKUP_DIR" "$REMOTE/$name"; then
        echo "Error: off-site copy of $name does not match the local files." >&2
        return 1
    fi
    log "Off-site copy verified. Removing remote copies older than ${REMOTE_KEEP_DAYS} days..."
    # Only our own timestamped backup directories, never other data that
    # shares the bucket or path.
    # By the date in the name, and only directories this script created: other
    # data that shares the bucket or path is never touched.
    local cutoff dir old
    cutoff="$(date -u -d "@$(( $(date +%s) - REMOTE_KEEP_DAYS * 86400 ))" +%Y%m%d)"
    rclone lsf --dirs-only --max-depth 1 "$REMOTE" 2>/dev/null | while IFS= read -r dir; do
        old="${dir%/}"
        [[ "$old" =~ ^([0-9]{8})_[0-9]{6}-[a-z-]+$ ]] || continue
        if [[ "${BASH_REMATCH[1]}" < "$cutoff" ]]; then
            rclone purge "$REMOTE/$old" && log "Removed off-site copy $old" \
                || log "Warning: could not remove off-site copy $old"
        fi
    done
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
    assert_numeric_positive "$KEEP" "BACKUP_KEEP"
    assert_numeric_positive "$KEEP_PRE_MIGRATE" "BACKUP_KEEP_PRE_MIGRATE"
    assert_numeric_positive "$REMOTE_KEEP_DAYS" "BACKUP_REMOTE_KEEP_DAYS"
    [[ "$LOCK_WAIT_SECONDS" =~ ^[0-9]+$ ]] || { echo "Error: BACKUP_LOCK_WAIT_SECONDS must be a number." >&2; exit 1; }

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
    upload_offsite
    case "$TYPE" in
        manual|daily|weekly) date -u +%s >"$SUCCESS_MARKER" ;;
    esac
}

main "$@"
