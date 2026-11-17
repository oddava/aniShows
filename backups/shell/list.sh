#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"

if [ ! -d "$BACKUP_DIR" ]; then
    echo "No backup directory found: $BACKUP_DIR"
    exit 0
fi

printf "%-34s %-20s %-12s %-10s\n" "BACKUP" "CREATED_UTC" "TYPE" "SIZE"
printf "%-34s %-20s %-12s %-10s\n" "------" "-----------" "----" "----"

found=0
while IFS= read -r dir; do
    found=1
    name="$(basename "$dir")"
    created="-"
    btype="-"
    size="$(du -sh "$dir" | awk '{print $1}')"
    manifest="$dir/backup_manifest.env"

    if [ -f "$manifest" ]; then
        created="$(grep -E '^CREATED_AT_UTC=' "$manifest" | head -n1 | cut -d'=' -f2- || true)"
        btype="$(grep -E '^TYPE=' "$manifest" | head -n1 | cut -d'=' -f2- || true)"
        [ -n "$created" ] || created="-"
        [ -n "$btype" ] || btype="-"
    else
        # Legacy folder naming convention: YYYYMMDD_HHMMSS-type
        if [[ "$name" == *-* ]]; then
            btype="${name##*-}"
        fi
    fi

    printf "%-34s %-20s %-12s %-10s\n" "$name" "$created" "$btype" "$size"
done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d ! -name ".*" | sort -r)

if [ "$found" -eq 0 ]; then
    echo "No backups found."
fi
