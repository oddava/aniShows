#!/usr/bin/env bash
set -Eeuo pipefail
# Bundles hold a full DB dump and the source server's secrets.
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
EXPORT_DIR="${BACKUP_EXPORT_DIR:-$BACKUP_DIR/exports}"
IMPORTED_ENV_DIR="${BACKUP_IMPORTED_ENV_DIR:-$BACKUP_DIR/imported-env}"
INPUT_FILE="${1:-}"

IMPORT_VERIFY_SHA="${IMPORT_VERIFY_SHA:-1}"
IMPORT_OVERWRITE="${IMPORT_OVERWRITE:-0}"

WORK_DIR=""
ARCHIVE_PATH=""
ROOT_DIR=""
IMPORTED_BACKUP_DIR=""
DEST_BACKUP_PATH=""

usage() {
    cat <<EOF
Usage: $0 <BUNDLE_FILE>

Examples:
  $0 my-backup.portable.tar.gz
  $0 /backups/exports/my-backup.portable.tar.gz
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

resolve_archive() {
    if [ -f "$INPUT_FILE" ]; then
        ARCHIVE_PATH="$INPUT_FILE"
    elif [ -f "$EXPORT_DIR/$INPUT_FILE" ]; then
        ARCHIVE_PATH="$EXPORT_DIR/$INPUT_FILE"
    else
        die "Bundle file '$INPUT_FILE' not found."
    fi
}

verify_checksum_if_present() {
    local sha_file actual expected
    if [ "$IMPORT_VERIFY_SHA" != "1" ]; then
        return
    fi

    sha_file="$ARCHIVE_PATH.sha256"
    if [ ! -f "$sha_file" ]; then
        log "No checksum file found for bundle. Skipping SHA validation."
        return
    fi

    expected="$(tr -d '[:space:]' <"$sha_file")"
    actual="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
    if [ "$expected" != "$actual" ]; then
        die "Bundle SHA256 mismatch. Expected $expected, got $actual."
    fi
    log "Bundle checksum verified."
}

extract_bundle() {
    local first_entry
    tar -tzf "$ARCHIVE_PATH" >/dev/null

    WORK_DIR="$(mktemp -d "$BACKUP_DIR/.tmp-import.XXXXXX")"
    tar -xzf "$ARCHIVE_PATH" -C "$WORK_DIR"

    first_entry="$(tar -tzf "$ARCHIVE_PATH" | head -n1)"
    ROOT_DIR="${first_entry%%/*}"
    if [ -z "$ROOT_DIR" ] || [ ! -d "$WORK_DIR/$ROOT_DIR" ]; then
        die "Could not resolve bundle root directory."
    fi
}

resolve_backup_payload() {
    IMPORTED_BACKUP_DIR="$(find "$WORK_DIR/$ROOT_DIR" -mindepth 1 -maxdepth 1 -type d ! -name ".*" | head -n1)"
    if [ -z "$IMPORTED_BACKUP_DIR" ] || [ ! -d "$IMPORTED_BACKUP_DIR" ]; then
        die "No backup directory found inside bundle."
    fi
    if [ ! -f "$IMPORTED_BACKUP_DIR/backup_manifest.env" ] && [ ! -f "$IMPORTED_BACKUP_DIR/db_dump.sql.gz" ] && [ ! -f "$IMPORTED_BACKUP_DIR/postgres.dump" ]; then
        die "Bundle payload does not look like an aniShows backup."
    fi
}

import_backup_dir() {
    local base_name
    base_name="$(basename "$IMPORTED_BACKUP_DIR")"
    # The -imported suffix keeps backup rotation from pruning it before it
    # is restored.
    case "$base_name" in
        *-imported*) ;;
        *) base_name="${base_name}-imported" ;;
    esac
    DEST_BACKUP_PATH="$BACKUP_DIR/$base_name"

    if [ -e "$DEST_BACKUP_PATH" ]; then
        if [ "$IMPORT_OVERWRITE" = "1" ]; then
            rm -rf "$DEST_BACKUP_PATH"
        else
            DEST_BACKUP_PATH="$BACKUP_DIR/${base_name}-imported-$(date +%Y%m%d_%H%M%S)"
        fi
    fi

    mv "$IMPORTED_BACKUP_DIR" "$DEST_BACKUP_PATH"
}

import_env_template_if_present() {
    local env_template target
    env_template="$WORK_DIR/$ROOT_DIR/migration.env.template"
    if [ ! -f "$env_template" ]; then
        return
    fi
    mkdir -p "$IMPORTED_ENV_DIR"
    target="$IMPORTED_ENV_DIR/$(basename "$DEST_BACKUP_PATH").env.template"
    cp "$env_template" "$target"
    log "Environment template imported to: $target"
}

main() {
    require_command tar
    require_command sha256sum
    require_command mktemp
    require_command find

    if [ -z "$INPUT_FILE" ]; then
        usage
        echo ""
        echo "Available exports:"
        ls -1 "$EXPORT_DIR" 2>/dev/null || true
        exit 1
    fi

    resolve_archive
    verify_checksum_if_present
    extract_bundle
    resolve_backup_payload
    import_backup_dir
    import_env_template_if_present

    log "Import complete."
    echo "Imported backup: $DEST_BACKUP_PATH"
    echo "Next steps:"
    echo "  make verify-backup TIMESTAMP=$(basename "$DEST_BACKUP_PATH")"
    echo "  make restore TIMESTAMP=$(basename "$DEST_BACKUP_PATH") FORCE=1"
}

main "$@"
