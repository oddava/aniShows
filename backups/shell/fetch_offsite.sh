#!/usr/bin/env bash
#
# Bring an off-site backup back to this host (inside the backup container,
# which has rclone and the RCLONE_CONFIG_* variables):
#
#   /app/shell/fetch_offsite.sh                  # list the remote's backups
#   /app/shell/fetch_offsite.sh latest           # the newest daily/weekly/manual one
#   /app/shell/fetch_offsite.sh 20261116_030000  # or a timestamp / full name
#
# It downloads into /backups/<name> (via a temporary directory, so a partial
# download never looks like a backup), checks checksums.sha256 and prints the
# directory name for restore.sh. An existing local copy is left as it is.

set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
REMOTE="${BACKUP_REMOTE:-}"
REF="${1:-}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >&2; }
die() { echo "Error: $*" >&2; exit 1; }

[ -n "$REMOTE" ] || die "BACKUP_REMOTE is empty: no off-site copies are configured (docs/backups.md)."
command -v rclone >/dev/null 2>&1 || die "rclone is not installed in this container."

listing="$(rclone lsf --dirs-only --max-depth 1 "$REMOTE")" || die "could not list $REMOTE"
# Only the directories backup.sh creates, oldest first.
mapfile -t names < <(sed 's:/$::' <<<"$listing" | grep -E '^[0-9]{8}_[0-9]{6}-[a-z-]+$' | sort || true)

if [ -z "$REF" ]; then
    printf '%s\n' "${names[@]}"
    exit 0
fi

name=""
for candidate in "${names[@]}"; do
    case "$REF" in
        # Like the local "latest": a regular backup, never a pre-restore or
        # pre-migrate snapshot (partial, or the data a restore replaced).
        # Sorted, so the last match wins.
        latest) if [[ "$candidate" =~ -(daily|weekly|manual)$ ]]; then name="$candidate"; fi ;;
        *) if [ "$candidate" = "$REF" ] || [[ "$candidate" == "$REF"-* ]]; then name="$candidate"; fi ;;
    esac
done
[ -n "$name" ] || die "no off-site backup matches '$REF' in $REMOTE"

if [ -d "$BACKUP_DIR/$name" ]; then
    log "$name is already in $BACKUP_DIR; using the local copy."
    echo "$name"
    exit 0
fi

work="$(mktemp -d "$BACKUP_DIR/.tmp-fetch-${name}.XXXXXX")"
trap 'rm -rf "$work"' EXIT
log "Downloading $REMOTE/$name..."
rclone copy --checksum "$REMOTE/$name" "$work" || die "download of $name failed"
if [ -f "$work/checksums.sha256" ]; then
    (cd "$work" && sha256sum -c checksums.sha256 >/dev/null) || die "$name: checksum mismatch after download"
    log "Checksums match."
else
    log "Warning: $name has no checksums.sha256 (an older backup); restore.sh validates the archives."
fi
mv "$work" "$BACKUP_DIR/$name"
trap - EXIT
log "Fetched into $BACKUP_DIR/$name"
echo "$name"
