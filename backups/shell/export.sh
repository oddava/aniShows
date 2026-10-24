#!/usr/bin/env bash
set -Eeuo pipefail
# Bundles hold a full DB dump and the source server's secrets.
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
EXPORT_DIR="${BACKUP_EXPORT_DIR:-$BACKUP_DIR/exports}"
INPUT_REF="${1:-}"

EXPORT_INCLUDE_ENV_TEMPLATE="${EXPORT_INCLUDE_ENV_TEMPLATE:-1}"
EXPORT_NAME="${EXPORT_NAME:-}"
EXPORT_COMPRESS_LEVEL="${EXPORT_COMPRESS_LEVEL:-6}"

TARGET_DIR=""
TARGET_NAME=""
WORK_DIR=""
EXPORT_PATH=""
EXPORT_SHA_PATH=""

usage() {
    cat <<EOF
Usage: $0 <TIMESTAMP_OR_BACKUP_DIR>

Creates a portable archive in:
  $EXPORT_DIR
EOF
}

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

die() {
    echo "Error: $*" >&2
    exit 1
}

cleanup() {
    if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
        rm -rf "$WORK_DIR"
    fi
}
trap cleanup EXIT

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "Required command '$1' is not available."
    fi
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
    TARGET_NAME="$(basename "$TARGET_DIR")"
}

generate_env_template() {
    local out_file="$1"
    cat >"$out_file" <<EOF
# aniShows migration environment template
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Review values before use on the target server.

# Database
DB_NAME=${POSTGRES_DB:-anishows_db}
DB_USER=${POSTGRES_USER:-postgres}
DB_PASSWORD=${POSTGRES_PASSWORD:-change_me}
PGBOUNCER_DB_HOST=${POSTGRES_HOST:-db}

# Object storage / MinIO
AWS_STORAGE_BUCKET_NAME=${AWS_STORAGE_BUCKET_NAME:-anishows-media}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-minioadmin}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-minioadmin}

# App
DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY:-change_me}
ALLOWED_HOSTS=${ALLOWED_HOSTS:-localhost,127.0.0.1}
FRONTEND_URL=${FRONTEND_URL:-http://localhost:5173}
EOF
}

write_bundle_manifest() {
    local out_file="$1"
    cat >"$out_file" <<EOF
BUNDLE_VERSION=1
CREATED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SOURCE_BACKUP_NAME=$TARGET_NAME
SOURCE_BACKUP_PATH=$TARGET_DIR
INCLUDES_ENV_TEMPLATE=$EXPORT_INCLUDE_ENV_TEMPLATE
EOF
}

main() {
    require_command tar
    require_command gzip
    require_command sha256sum
    require_command mktemp
    require_command find

    if [ -z "$INPUT_REF" ]; then
        usage
        echo ""
        echo "Available backups:"
        ls -1 "$BACKUP_DIR" 2>/dev/null || true
        exit 1
    fi

    if ! [[ "$EXPORT_COMPRESS_LEVEL" =~ ^[1-9]$ ]]; then
        die "EXPORT_COMPRESS_LEVEL must be 1..9."
    fi

    resolve_backup_dir

    mkdir -p "$EXPORT_DIR"
    WORK_DIR="$(mktemp -d "$BACKUP_DIR/.tmp-export.XXXXXX")"
    local root_dir
    root_dir="anishows-export-${TARGET_NAME}-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$WORK_DIR/$root_dir"

    cp -a "$TARGET_DIR" "$WORK_DIR/$root_dir/"
    write_bundle_manifest "$WORK_DIR/$root_dir/bundle_manifest.env"

    if [ "$EXPORT_INCLUDE_ENV_TEMPLATE" = "1" ]; then
        generate_env_template "$WORK_DIR/$root_dir/migration.env.template"
    fi

    if [ -n "$EXPORT_NAME" ]; then
        EXPORT_PATH="$EXPORT_DIR/$EXPORT_NAME"
    else
        EXPORT_PATH="$EXPORT_DIR/${TARGET_NAME}.portable.tar.gz"
    fi
    EXPORT_SHA_PATH="$EXPORT_PATH.sha256"

    log "Creating portable export bundle: $EXPORT_PATH"
    GZIP="-${EXPORT_COMPRESS_LEVEL}" tar -czf "$EXPORT_PATH" -C "$WORK_DIR" "$root_dir"
    sha256sum "$EXPORT_PATH" | awk '{print $1}' >"$EXPORT_SHA_PATH"

    log "Export complete."
    echo "Bundle: $EXPORT_PATH"
    echo "SHA256: $EXPORT_SHA_PATH"
}

main "$@"
